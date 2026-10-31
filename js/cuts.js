// Cuts and waste: what actually came off a wheel, as opposed to what was
// planned. Cuts holds one row per weighed piece, Waste one row per loss.
//
// Stock on hand is still "received minus Allocations" everywhere, so these
// write through to Allocations rather than adding a second thing to subtract:
// - weighing a piece changes its line's allocation from nominal to actual kilos;
// - waste adds an Allocations row with the 'ADJUSTMENT' line id, as stock.html's
//   manual removals do.
// A record and its stock change go in one spreadsheets.batchUpdate, which
// Google applies all or nothing, so they can't come apart if a save fails.

const WASTE_REASONS = ['Offcut', 'Damaged', 'Spoiled / mould', 'Sample / tasting', 'Rind trim', 'Other'];

// House rule: warn (never block) when stock has under this many days left on
// delivery. A customer's own "Min shelf life on receipt" can raise it.
const SHORT_DATED_DAYS = 14;

const cutNum = v => parseFloat(v) || 0;
const cutRound = n => Math.round(n * 1000) / 1000;

// A tab as [{ rowNumber, obj }]. `exists` is false when the tab isn't there
// yet (Setup not re-run), so pages can still load and say so.
async function loadOptionalTab(spreadsheetId, tab) {
  try {
    const rows = await sheetsGet(spreadsheetId, `${tab}!A:Z`);
    const [head = [], ...rest] = rows;
    return {
      exists: true,
      headers: head,
      rows: rest.map((r, i) => ({ rowNumber: i + 2, obj: Object.fromEntries(head.map((h, c) => [h, r[c] ?? ''])) }))
    };
  } catch (err) {
    return { exists: false, headers: [], rows: [] };
  }
}

// What a line draws from and whether it gets weighed at the bench, or null if
// it doesn't: a portion "Cut from" a whole, or a whole sold by the piece but
// stocked and invoiced in kilos. Matches stockSource() in orders.html.
function weighSource(line, productByCode) {
  const p = productByCode[line['PRODUCT CODE']];
  if (!p) return null;
  const parent = p['Cut from (code)'] ? productByCode[p['Cut from (code)']] : null;
  if (parent) return { code: parent['Product code'], perUnit: cutNum(p['Nominal weight (kg)']), whole: false };
  if (line.UNIT === 'pc' && p['Pricing basis'] === 'Per kg' && cutNum(p['Nominal weight (kg)'])) {
    return { code: line['PRODUCT CODE'], perUnit: cutNum(p['Nominal weight (kg)']), whole: true };
  }
  return null;
}

// How many pieces a line comes to, and the nominal kilos of each. A cut line
// held in kilos is one piece of that weight.
function linePieces(line, source) {
  const qty = cutNum(line['QTY ORDERED']);
  if (line.UNIT === 'kg') return { count: qty > 0 ? 1 : 0, nominal: qty };
  return { count: Math.ceil(qty), nominal: source.perUnit };
}

// Weighed pieces by order line: { lineId: [{ rowNumber, obj }] }.
function cutsByLine(cutRows) {
  const out = {};
  cutRows.forEach(c => { (out[c.obj['ORDER LINE ID']] = out[c.obj['ORDER LINE ID']] || []).push(c); });
  return out;
}

const cutWeight = c => cutNum(c.obj['WEIGHT KG']);
const sumCutWeight = cuts => cutRound((cuts || []).reduce((s, c) => s + cutWeight(c), 0));

// What each of a line's allocation rows still holds for pieces not yet cut:
// the row's qty, less the actual weight already cut from its lot.
function heldByAllocation(allocRows, lineCuts) {
  const cutKg = {};
  (lineCuts || []).forEach(c => { cutKg[c.obj['BATCH/LOT NUMBER']] = (cutKg[c.obj['BATCH/LOT NUMBER']] || 0) + cutWeight(c); });
  return allocRows.map(a => {
    const lot = a.obj['PO LINE ID'] ? '' : a.obj['BATCH/LOT NUMBER'];
    let held = cutNum(a.obj['QTY ALLOCATED']);
    if (lot && cutKg[lot]) {
      const off = Math.min(held, cutKg[lot]);
      held -= off;
      cutKg[lot] -= off;
    }
    return { row: a, lot, poLineId: a.obj['PO LINE ID'] || '', held: cutRound(held) };
  });
}

// The allocation rows a line should end up with once a piece is added to or
// taken off `lineCuts`. Each lot holds its pieces' actual weight plus whatever
// is still held nominally for pieces not cut yet, so stock follows the scale.
//
// `change` is { lot, nominal, weight, undo }. Adding takes the piece's nominal
// kilos from its own lot first, then other lots, then PO reservations; undoing
// puts them back on the piece's lot. Returns { updates: [{ rowNumber, qty }],
// deletes: [rowNumber], appends: [{ lot, qty }] }.
function planAllocationChange(allocRows, lineCuts, change) {
  const entries = heldByAllocation(allocRows, lineCuts);
  const cutKg = {};
  (lineCuts || []).forEach(c => { cutKg[c.obj['BATCH/LOT NUMBER']] = cutRound((cutKg[c.obj['BATCH/LOT NUMBER']] || 0) + cutWeight(c)); });
  const extraHeld = {};

  if (change.undo) {
    cutKg[change.lot] = cutRound((cutKg[change.lot] || 0) - change.weight);
    extraHeld[change.lot] = change.nominal;
  } else {
    let left = change.nominal;
    const take = e => {
      const off = Math.min(left, e.held);
      e.held = cutRound(e.held - off);
      left = cutRound(left - off);
    };
    entries.filter(e => e.lot === change.lot).forEach(take);
    entries.filter(e => e.lot && e.lot !== change.lot).forEach(take);
    entries.filter(e => e.poLineId).forEach(take);
    cutKg[change.lot] = cutRound((cutKg[change.lot] || 0) + change.weight);
  }

  const targetFor = lot => {
    const held = entries.filter(e => e.lot === lot).reduce((s, e) => s + e.held, 0);
    return cutRound(held + (cutKg[lot] || 0) + (extraHeld[lot] || 0));
  };

  const out = { updates: [], deletes: [], appends: [] };
  const seen = new Set();
  entries.forEach(e => {
    const target = e.poLineId ? e.held : (seen.has(e.lot) ? 0 : targetFor(e.lot));
    if (!e.poLineId) seen.add(e.lot);
    if (target <= 0.0001) out.deletes.push(e.row.rowNumber);
    else if (Math.abs(target - cutNum(e.row.obj['QTY ALLOCATED'])) > 0.0001) out.updates.push({ rowNumber: e.row.rowNumber, qty: target });
  });
  new Set([...Object.keys(cutKg), ...Object.keys(extraHeld)]).forEach(lot => {
    if (seen.has(lot)) return;
    const target = targetFor(lot);
    if (target > 0.0001) out.appends.push({ lot, qty: target });
  });
  return out;
}

// ---- spreadsheets.batchUpdate requests ----

function sheetCell(v) {
  return { userEnteredValue: typeof v === 'number' ? { numberValue: v } : { stringValue: String(v ?? '') } };
}

function appendRowsRequest(sheetId, rows) {
  return { appendCells: { sheetId, rows: rows.map(r => ({ values: r.map(sheetCell) })), fields: 'userEnteredValue' } };
}

function updateCellRequest(sheetId, rowNumber, colIndex, value) {
  return {
    updateCells: {
      range: { sheetId, startRowIndex: rowNumber - 1, endRowIndex: rowNumber, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
      rows: [{ values: [sheetCell(value)] }],
      fields: 'userEnteredValue'
    }
  };
}

// Highest row first: deleting a row shifts every later row's index down.
function deleteRowsRequests(sheetId, rowNumbers) {
  return [...new Set(rowNumbers)].sort((a, b) => b - a)
    .map(rn => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rn - 1, endIndex: rn } } }));
}

// Requests for a planAllocationChange() result. `row` builds a new Allocations
// row from { lot, qty }. Deletes go last so they can't move the rows updated.
function allocationChangeRequests(sheetId, qtyCol, plan, row) {
  return [
    ...plan.updates.map(u => updateCellRequest(sheetId, u.rowNumber, qtyCol, u.qty)),
    ...(plan.appends.length ? [appendRowsRequest(sheetId, plan.appends.map(row))] : []),
    ...deleteRowsRequests(sheetId, plan.deletes)
  ];
}
