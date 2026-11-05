// Shared by the warehouse list pages — cutting-list.html, picking.html,
// lists.html (Packing) and day-sheet.html. One read of everything an order's
// lines, lots and customers need (loadListsData), the week/day picker, and the
// per-order helpers every list is built from (packLines, packingGroups, ...).
//
// Pages keep the result in the global `data` so their render functions can
// re-draw (a day chip, a reordered drop) without another round trip.

let data = null;

function toObjects(rows) {
  if (!rows.length) return [];
  const [head, ...rest] = rows;
  return rest.map(r => {
    const o = {};
    head.forEach((h, i) => { o[h] = r[i] ?? ''; });
    return o;
  });
}

async function loadListsData(spreadsheetId, token) {
  const groupsP = loadProductGroups(spreadsheetId); // in parallel with the reads below
  const cutsP = loadOptionalTab(spreadsheetId, 'Cuts');
  const [orderRows, lineRows, allocRows, productRows, deliveryRows, customerRows, poRows, polRows] = await Promise.all([
    sheetsGet(spreadsheetId, 'Orders!A:Z', token),
    sheetsGet(spreadsheetId, 'OrderLines!A:Z', token),
    sheetsGet(spreadsheetId, 'Allocations!A:Z', token),
    sheetsGet(spreadsheetId, 'Products!A:AZ', token),
    sheetsGet(spreadsheetId, 'Deliveries!A:Z', token),
    sheetsGet(spreadsheetId, 'Customers!A:Z', token),
    sheetsGet(spreadsheetId, 'PurchaseOrders!A:Z', token),
    sheetsGet(spreadsheetId, 'PurchaseOrderLines!A:Z', token)
  ]);

  const productByCode = {};
  const products = toObjects(productRows);
  products.forEach(p => { productByCode[p['Product code']] = p; });
  registerProducts(products);
  registerProductGroups(await groupsP);

  const deliveryByKey = {};
  toObjects(deliveryRows).forEach(d => {
    deliveryByKey[`${d['PRODUCT CODE']} ${d['BATCH/LOT NUMBER']}`] = d;
  });

  const customerByName = {};
  toObjects(customerRows).forEach(c => { customerByName[c['Customer name (as in Xero)']] = c; });

  // DROP ORDER and BOXES were appended to Orders after launch — until
  // Setup has been re-run those columns don't exist and can't be saved.
  const dropIdx = (orderRows[0] || []).indexOf('DROP ORDER');
  const boxesIdx = (orderRows[0] || []).indexOf('BOXES');

  return {
    orders: toObjects(orderRows).map((o, i) => ({ ...o, rowNumber: i + 2 })),
    lines: toObjects(lineRows),
    allocs: toObjects(allocRows),
    productByCode, deliveryByKey, customerByName,
    cutsOfLine: cutsByLine((await cutsP).rows),
    // PO line → its PO, for lines held by a reservation on stock still arriving.
    poOfLine: (() => {
      const pos = Object.fromEntries(toObjects(poRows).map(po => [po.ID, po]));
      return Object.fromEntries(toObjects(polRows).map(l => [l.ID, pos[l['PO ID']] || { ID: l['PO ID'] }]));
    })(),
    dropCol: dropIdx >= 0 ? colLetter(dropIdx + 1) : null,
    boxesCol: boxesIdx >= 0 ? colLetter(boxesIdx + 1) : null
  };
}

// ---- dates — weeks run Monday–Sunday; orders are picked by DELIVERY DATE ----

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function weekRange(offset) {
  const start = mondayOf(new Date());
  start.setDate(start.getDate() + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

// Local-date ISO string (not toISOString, which converts to UTC and can
// shift the date near midnight in a +ve timezone like BST).
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtWeekRange(start, end) {
  const sameMonth = start.getMonth() === end.getMonth();
  const s = start.toLocaleDateString('en-GB', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  const e = end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${s}–${e}`;
}

function fmtDateShort(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDateLong(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ---- week + day picker, shared by the three week pages ----
//
// The page carries the toolbar markup (#prevWeekBtn, #weekLabel, #nextWeekBtn,
// #thisWeekBtn, optional #dayChips and #showAllToggle) and calls
// initWeekPicker(render). `dayFilter` narrows the week to one delivery date
// ('' = the whole week); the chips only list days that have orders.

let weekOffset = 0;
let dayFilter = '';

function initWeekPicker(onChange) {
  const shift = delta => {
    weekOffset = delta === 0 ? 0 : weekOffset + delta;
    dayFilter = '';
    renderWeekLabel();
    if (data) onChange();
  };
  document.getElementById('prevWeekBtn').addEventListener('click', () => shift(-1));
  document.getElementById('nextWeekBtn').addEventListener('click', () => shift(1));
  document.getElementById('thisWeekBtn').addEventListener('click', () => shift(0));
  document.getElementById('showAllToggle')?.addEventListener('change', () => { if (data) onChange(); });
  document.getElementById('dayChips')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-day]');
    if (!chip) return;
    dayFilter = chip.dataset.day;
    onChange();
  });
}

function renderWeekLabel() {
  const { start, end } = weekRange(weekOffset);
  const prefix = weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : weekOffset === -1 ? 'Last week' : 'Week of';
  document.getElementById('weekLabel').textContent = `${prefix} · ${fmtWeekRange(start, end)}`;
  document.getElementById('thisWeekBtn').style.display = weekOffset === 0 ? 'none' : '';
}

// What the lists are for, for print headings: "This week · 9–15 Nov" or
// "Thu 12 Nov" when one day is picked.
function periodLabel() {
  return dayFilter ? fmtDateShort(dayFilter) : document.getElementById('weekLabel').textContent;
}

const showDispatched = () => !!document.getElementById('showAllToggle')?.checked;

function openOrders() {
  const all = showDispatched();
  return data.orders.filter(o => all || o.STATUS !== 'Dispatched');
}

// The week's orders (narrowed to dayFilter when set), plus open orders with
// no delivery date at all, which no week can show.
function weekOrders() {
  const { start, end } = weekRange(weekOffset);
  const startIso = isoDate(start), endIso = isoDate(end);
  const open = openOrders();
  const week = open.filter(o => o['DELIVERY DATE'] >= startIso && o['DELIVERY DATE'] <= endIso);
  renderDayChips(week);
  return {
    inWeek: dayFilter ? week.filter(o => o['DELIVERY DATE'] === dayFilter) : week,
    undated: open.filter(o => !o['DELIVERY DATE'])
  };
}

function renderDayChips(week) {
  const box = document.getElementById('dayChips');
  if (!box) return;
  const days = {};
  week.forEach(o => { days[o['DELIVERY DATE']] = (days[o['DELIVERY DATE']] || 0) + 1; });
  const dates = Object.keys(days).sort();
  if (dayFilter && !days[dayFilter]) dayFilter = '';
  if (dates.length < 2 && !dayFilter) { box.innerHTML = ''; return; }
  const chip = (day, label, n) => `<button type="button" class="day-chip${dayFilter === day ? ' on' : ''}" data-day="${day}" aria-pressed="${dayFilter === day}">${escapeHtml(label)} <span>${n}</span></button>`;
  box.innerHTML = chip('', 'Whole week', week.length) + dates.map(d => chip(d, fmtDateShort(d), days[d])).join('');
}

// ---- per-order helpers ----

// "Comté Petite 10/14M — 1/4 wheel 9kg" → cheese "Comté Petite 10/14M",
// portion "1/4 wheel 9kg". Product names use an em dash for the cut.
function splitPortionName(name) {
  const i = name.indexOf(' — ');
  return i < 0 ? { cheese: name, portion: '' } : { cheese: name.slice(0, i), portion: name.slice(i + 3) };
}

function zoneOf(order) {
  const c = data.customerByName[order.CUSTOMER];
  return (c && c['Delivery zone']) || '';
}

function zoneTag(zone) {
  if (zone === 'London') return '<span class="tag t-chill">London</span>';
  if (zone === 'Out of London') return '<span class="tag t-ldo">Out of London</span>';
  return '<span class="tag t-warn">No zone</span>';
}

const orderLink = (id) => `<a href="orders.html?open=${encodeURIComponent(id)}">${escapeHtml(id)}</a>`;

// London drops in truck order: saved DROP ORDER first (1 = first drop),
// then anything not placed yet, alphabetically, at the end.
function sortByDrop(orders) {
  return orders.slice().sort((a, b) => {
    const da = parseInt(a['DROP ORDER'], 10), db = parseInt(b['DROP ORDER'], 10);
    const ha = !isNaN(da), hb = !isNaN(db);
    if (ha && hb && da !== db) return da - db;
    if (ha !== hb) return ha ? -1 : 1;
    return a.CUSTOMER.localeCompare(b.CUSTOMER);
  });
}

// The order orders are packed in: Out of London first (courier), then
// London in truck order, then anything with no zone. Slips, delivery notes,
// box labels and the day sheet all follow it.
function packingGroups(orders) {
  return {
    outside: orders.filter(o => zoneOf(o) === 'Out of London').sort((a, b) => a.CUSTOMER.localeCompare(b.CUSTOMER)),
    london: sortByDrop(orders.filter(o => zoneOf(o) === 'London')),
    noZone: orders.filter(o => !['London', 'Out of London'].includes(zoneOf(o))).sort((a, b) => a.CUSTOMER.localeCompare(b.CUSTOMER))
  };
}

// The same, flattened, each London order carrying its drop number as _drop.
// Drops are numbered within one delivery date's run.
function packingOrder(orders) {
  const { outside, london, noZone } = packingGroups(orders);
  const dropNo = {};
  return [...outside, ...london.map(o => {
    const day = o['DELIVERY DATE'];
    dropNo[day] = (dropNo[day] || 0) + 1;
    return { ...o, _drop: dropNo[day] };
  }), ...noZone];
}

// Every line of an order, with the lots it's allocated from (one entry per lot
// or PO, however many Allocations rows it took) and whether it's short.
function packLines(order) {
  return data.lines.filter(l => l['ORDER ID'] === order.ID).map(l => {
    const prod = data.productByCode[l['PRODUCT CODE']];
    const ordered = parseFloat(l['QTY ORDERED']) || 0;
    const isCut = !!(prod && prod['Cut from (code)']);
    const lots = data.allocs.filter(a => a['ORDER LINE ID'] === l.ID).map(a => {
      if (a['PO LINE ID']) {
        const po = data.poOfLine[a['PO LINE ID']] || {};
        return { awaiting: po.ID || 'PO', due: po['EXPECTED END DATE'] || po['EXPECTED START DATE'] || '', qty: parseFloat(a['QTY ALLOCATED']) || 0 };
      }
      const del = data.deliveryByKey[`${a['PRODUCT CODE']} ${a['BATCH/LOT NUMBER']}`];
      return { lot: a['BATCH/LOT NUMBER'], qty: parseFloat(a['QTY ALLOCATED']) || 0, bbe: del ? del['BEST BEFORE DATE'] : '' };
    }).reduce((out, x) => {
      const same = out.find(y => (y.lot || '') === (x.lot || '') && (y.awaiting || '') === (x.awaiting || ''));
      if (same) same.qty += x.qty; else out.push(x);
      return out;
    }, []);
    const allocated = lots.reduce((s, x) => s + x.qty, 0);
    return {
      id: l.ID,
      product: prod,
      code: l['PRODUCT CODE'],
      name: prod ? prod['Product name'] : l['PRODUCT CODE'],
      qty: ordered, unit: l.UNIT,
      isCut, lots,
      weighed: sumCutWeight(data.cutsOfLine[l.ID]),
      short: !isCut && allocated + 0.0001 < ordered,
      // Set when the line was swapped for another product (orders.html → Replace).
      replaces: l.REPLACES ? (data.productByCode[l.REPLACES]?.['Product name'] || l.REPLACES) : ''
    };
  });
}

// Lines across these orders that still need stock allocated.
function shortLineCount(orders) {
  return orders.reduce((n, o) => n + packLines(o).filter(l => l.short).length, 0);
}

// The shared notes above a list: undated orders, and lines short of stock.
function listNotesHtml(inWeek, undated) {
  const shortCount = shortLineCount(inWeek);
  return (undated.length ? `
      <div class="note no-print">
        <strong>${undated.length} open order(s) have no delivery date</strong> and won't show on any week: ${undated.map(o => `${orderLink(o.ID)} (${escapeHtml(o.CUSTOMER)})`).join(', ')}.
      </div>` : '') + (shortCount ? `
      <div class="note no-print">
        <strong>${shortCount} line(s) still need stock allocated</strong> — they're flagged below. Allocate them on the <a href="orders.html" style="color:inherit; text-decoration:underline;">Orders</a> page.
      </div>` : '');
}
