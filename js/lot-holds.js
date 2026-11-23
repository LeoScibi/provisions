// Lots on hold — the LotHolds tab (see setup.html). A held lot is still on
// the shelf but mustn't go out: a recall, or quarantine while a supplier
// checks something. Keyed on product code + lot, like Deliveries, because
// suppliers reuse lot numbers across products. A hold is active while its
// RELEASED AT is blank.
//
// Pages call loadLotHolds() alongside their other reads; after that
// lotHold(code, lot) answers anywhere (orders.html's lot pool, the stock
// position, the warehouse lists, Today's alerts). Before Setup has created
// the tab there are simply no holds.

let LOT_HOLDS = [];          // active holds, header-keyed row objects
let LOT_HOLD_ROWS = [];      // every row, with its sheet rowNumber, for recall.html
let LOT_HOLD_HEADERS = [];
let LOT_HOLDS_TAB = false;   // whether the tab exists yet

const lotHoldKey = (code, lot) => `${code}\u0001${lot}`;
let lotHoldIndex = {};

async function loadLotHolds(spreadsheetId) {
  try {
    const rows = await sheetsGet(spreadsheetId, 'LotHolds!A:Z');
    const [head = [], ...rest] = rows;
    LOT_HOLDS_TAB = true;
    LOT_HOLD_HEADERS = head;
    LOT_HOLD_ROWS = rest.map((r, i) => ({ rowNumber: i + 2, obj: Object.fromEntries(head.map((h, c) => [h, r[c] ?? ''])) }));
  } catch (err) {
    LOT_HOLDS_TAB = false;
    LOT_HOLD_HEADERS = [];
    LOT_HOLD_ROWS = [];
  }
  LOT_HOLDS = LOT_HOLD_ROWS.map(r => r.obj).filter(h => h['PRODUCT CODE'] && h['BATCH/LOT NUMBER'] && !h['RELEASED AT']);
  lotHoldIndex = {};
  LOT_HOLDS.forEach(h => { lotHoldIndex[lotHoldKey(h['PRODUCT CODE'], h['BATCH/LOT NUMBER'])] = h; });
  return LOT_HOLDS;
}

// The active hold on this lot, or null.
function lotHold(code, lot) {
  if (!lot) return null;
  return lotHoldIndex[lotHoldKey(code, lot)] || null;
}

function lotHoldTag(hold) {
  if (!hold) return '';
  const why = [hold.REASON, hold['RECALL ID'] ? `Recall ${hold['RECALL ID']}` : ''].filter(Boolean).join(' · ');
  return `<span class="tag t-crit" title="${escapeHtml(why || 'On hold')}">On hold</span>`;
}

// "2026-11-12 14:03" in local time — what the recall tabs store.
function localStamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function currentUserLabel() {
  const u = getStoredUserInfo();
  return u.name || u.email || '';
}
