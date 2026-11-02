// Receiving and cancelling a purchase order, shared by the desktop dialog
// (purchase-orders.html) and the phone screen (receiving.html). Needs js/cuts.js
// for the batchUpdate helpers.
//
// Everything goes in one spreadsheets.batchUpdate, which Google applies all or
// nothing, so a dropped connection can't leave a delivery half recorded. The PO
// is read again first: if it's no longer Ordered, nothing is written, so a retry
// after a save whose reply got lost can't receive the same goods twice.
//
// `lines` is [{ lineId, code, unit, isNew, lots: [{ qty, lot, bbe }] }]. A line
// with no lot over zero is recorded as Not delivered.

const receiveDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The lots that actually arrived on a line.
const receivedLots = line => line.lots.filter(l => parseFloat(l.qty) > 0);

// What's wrong with `lines`, or '' if they can be recorded.
function receiveProblem(lines, nameOf) {
  for (const line of lines) {
    for (const l of receivedLots(line)) {
      if (!(l.lot || '').trim()) return `Enter a lot number for ${nameOf(line.code)}.`;
      if (!l.bbe) return `Enter a best-before date for ${nameOf(line.code)}.`;
    }
  }
  return '';
}

// An order line short of shelf stock can reserve a quantity on an open PO line
// (an Allocations row with PO LINE ID and no lot — see orders.html). When the PO
// is received, each reservation becomes real allocations from the lots just
// entered, first placed, first served (order date, then order ID); whatever a
// short or missing delivery can't cover is released and that order drops back
// from Allocated to New, to be replaced or re-allocated. Cancelling the PO
// releases them all (receivedByLine = {}).
//
// allocRows / lineRows / orderRows are [{ rowNumber, obj }]. receivedByLine is
// { [poLineId]: [{ lot, bbe, qty }] }. Returns { reservations, newAllocs, short,
// backToNew }, where newAllocs is [{ lineId, code, lot, qty }].
function planReservations(allocRows, lineRows, orderRows, poLineIds, receivedByLine) {
  const reservations = allocRows.filter(a => poLineIds.has(a.obj['PO LINE ID']));
  const orderOfLine = Object.fromEntries(lineRows.map(l => [l.obj.ID, l.obj['ORDER ID']]));
  const orderById = Object.fromEntries(orderRows.map(o => [o.obj.ID, o.obj]));
  const num = id => parseInt(String(id).replace(/\D/g, ''), 10) || 0;
  const orderOf = a => orderById[orderOfLine[a.obj['ORDER LINE ID']]] || {};
  const sorted = [...reservations].sort((a, b) => (orderOf(a).DATE || '9999').localeCompare(orderOf(b).DATE || '9999')
    || num(orderOf(a).ID) - num(orderOf(b).ID) || num(a.obj.ID) - num(b.obj.ID));

  const pools = {};
  Object.entries(receivedByLine).forEach(([id, lots]) => {
    pools[id] = lots.map(x => ({ ...x, remaining: x.qty })).sort((a, b) => (a.bbe || '9999').localeCompare(b.bbe || '9999'));
  });
  const newAllocs = [], short = new Set();
  sorted.forEach(a => {
    let left = parseFloat(a.obj['QTY ALLOCATED']) || 0;
    (pools[a.obj['PO LINE ID']] || []).forEach(lot => {
      if (left <= 0.0001 || lot.remaining <= 0.0001) return;
      const take = Math.round(Math.min(left, lot.remaining) * 1000) / 1000;
      lot.remaining -= take;
      left = Math.round((left - take) * 1000) / 1000;
      newAllocs.push({ lineId: a.obj['ORDER LINE ID'], code: a.obj['PRODUCT CODE'], lot: lot.lot, qty: take });
    });
    if (left > 0.0001) short.add(orderOfLine[a.obj['ORDER LINE ID']]);
  });
  const backToNew = orderRows.filter(o => short.has(o.obj.ID) && o.obj.STATUS === 'Allocated');
  return { reservations, newAllocs, short: [...short], backToNew };
}

// { [poLineId]: [{ lot, bbe, qty }] } for planReservations, from receive lines.
function receivedByLineOf(lines) {
  const out = {};
  lines.filter(l => !l.isNew && l.lineId).forEach(l => {
    out[l.lineId] = receivedLots(l).map(x => ({ lot: x.lot.trim(), bbe: x.bbe, qty: parseFloat(x.qty) }));
  });
  return out;
}

async function loadRequiredTab(spreadsheetId, tab) {
  const t = await loadOptionalTab(spreadsheetId, tab);
  if (!t.exists) throw new Error(`Could not read ${tab}.`);
  return t;
}

// What a PO change needs: the tabs it writes, freshly read, and their sheet ids.
async function loadPoTabs(spreadsheetId, poId) {
  const [pos, pols, allocs, lines, orders, tabs] = await Promise.all([
    loadRequiredTab(spreadsheetId, 'PurchaseOrders'),
    loadRequiredTab(spreadsheetId, 'PurchaseOrderLines'),
    loadRequiredTab(spreadsheetId, 'Allocations'),
    loadRequiredTab(spreadsheetId, 'OrderLines'),
    loadRequiredTab(spreadsheetId, 'Orders'),
    sheetsGetTabs(spreadsheetId)
  ]);
  const po = pos.rows.find(r => r.obj.ID === poId);
  if (!po) throw new Error(`${poId} isn't in the sheet any more.`);
  return {
    pos, pols, allocs, lines, orders, po,
    sheet: Object.fromEntries(tabs.map(t => [t.title, t.sheetId])),
    poLineIds: new Set(pols.rows.filter(l => l.obj['PO ID'] === poId).map(l => l.obj.ID))
  };
}

// Requests that swap a PO's reservations for the plan's real allocations and
// send short orders back to New. Deletes go last, so they can't move other rows.
function reservationRequests(t, plan, isTest) {
  const requests = [];
  const statusCol = t.orders.headers.indexOf('STATUS');
  plan.backToNew.forEach(o => requests.push(updateCellRequest(t.sheet.Orders, o.rowNumber, statusCol, 'New')));
  if (plan.newAllocs.length) {
    let base = [['ID'], ...t.allocs.rows.map(a => [a.obj.ID])];
    requests.push(appendRowsRequest(t.sheet.Allocations, plan.newAllocs.map(a => {
      const id = nextId(base, 'ALO');
      base = base.concat([[id]]);
      return [id, a.lineId, a.code, a.lot, a.qty, receiveDate(), isTest ? 'TEST' : '', ''];
    })));
  }
  requests.push(...deleteRowsRequests(t.sheet.Allocations, plan.reservations.map(a => a.rowNumber)));
  return requests;
}

// Records a delivery. Returns { already: status } if the PO has stopped being
// Ordered, or { filled, short } once it's saved: `filled` allocations made from
// the lots received, `short` the order IDs left needing attention.
async function receivePurchaseOrder(spreadsheetId, poId, lines) {
  const t = await loadPoTabs(spreadsheetId, poId);
  if (t.po.obj.STATUS !== 'Ordered') return { already: t.po.obj.STATUS };
  const isTest = t.po.obj.NOTES === 'TEST';

  const delIds = await sheetsGet(spreadsheetId, 'Deliveries!A:A');
  let delBase = delIds.length ? delIds : [['ID']];
  const deliveryRows = [];
  lines.forEach(line => receivedLots(line).forEach(l => {
    const id = nextId(delBase, 'DEL');
    delBase = delBase.concat([[id]]);
    deliveryRows.push([id, receiveDate(), t.po.obj.SUPPLIER, line.code, l.lot.trim(), l.bbe, parseFloat(l.qty), line.unit, isTest ? 'TEST' : '', poId]);
  }));

  const col = name => t.pols.headers.indexOf(name);
  const polRequests = [], newLineRows = [];
  let polBase = [['ID'], ...t.pols.rows.map(l => [l.obj.ID])];
  lines.forEach(line => {
    const got = receivedLots(line);
    const total = Math.round(got.reduce((s, l) => s + parseFloat(l.qty), 0) * 1000) / 1000;
    const fields = {
      'QTY RECEIVED': got.length ? total : '',
      'LOT NUMBER': got.map(l => l.lot.trim()).join(', '),
      'BEST BEFORE DATE': got.map(l => l.bbe).join(', '),
      STATUS: got.length ? 'Delivered' : 'Not delivered'
    };
    if (line.isNew) {
      const id = nextId(polBase, 'POL');
      polBase = polBase.concat([[id]]);
      newLineRows.push([id, poId, line.code, '', line.unit, fields['QTY RECEIVED'], fields['LOT NUMBER'], fields['BEST BEFORE DATE'], fields.STATUS]);
    } else {
      const row = t.pols.rows.find(l => l.obj.ID === line.lineId);
      if (!row) throw new Error(`A line on ${poId} has changed — reload and try again.`);
      Object.entries(fields).forEach(([name, value]) => polRequests.push(updateCellRequest(t.sheet.PurchaseOrderLines, row.rowNumber, col(name), value)));
    }
  });

  const plan = planReservations(t.allocs.rows, t.lines.rows, t.orders.rows, t.poLineIds, receivedByLineOf(lines));
  await sheetsBatchUpdate(spreadsheetId, [
    ...(deliveryRows.length ? [appendRowsRequest(t.sheet.Deliveries, deliveryRows)] : []),
    ...polRequests,
    ...(newLineRows.length ? [appendRowsRequest(t.sheet.PurchaseOrderLines, newLineRows)] : []),
    updateCellRequest(t.sheet.PurchaseOrders, t.po.rowNumber, t.pos.headers.indexOf('STATUS'), 'Delivered'),
    ...reservationRequests(t, plan, isTest)
  ]);
  return { filled: plan.newAllocs.length, short: plan.short };
}

// Cancels a PO and releases anything reserved on it. Same return as above.
async function cancelPurchaseOrder(spreadsheetId, poId) {
  const t = await loadPoTabs(spreadsheetId, poId);
  if (t.po.obj.STATUS !== 'Ordered') return { already: t.po.obj.STATUS };
  const plan = planReservations(t.allocs.rows, t.lines.rows, t.orders.rows, t.poLineIds, {});
  await sheetsBatchUpdate(spreadsheetId, [
    updateCellRequest(t.sheet.PurchaseOrders, t.po.rowNumber, t.pos.headers.indexOf('STATUS'), 'Cancelled'),
    ...reservationRequests(t, plan, false)
  ]);
  return { filled: 0, short: plan.short };
}
