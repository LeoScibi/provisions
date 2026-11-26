// Floor checklists — Opening, Closing, Cleaning, Goods In, Goods Out — the
// paper HACCP forms on the clipboards, filled in on the warehouse phone
// (checklists.html) and approved by a manager, which saves a PDF to Drive.
//
// Tabs (see setup.html): Staff (who can fill in / approve), ChecklistItems
// (what each list asks — editable; CHECKLIST_DEFAULTS below are the paper
// forms, loaded with one button), ChecklistRuns (one row per filled-in list,
// its answers as JSON so later edits to the items never rewrite history).
//
// A run is one list for one day (Opening, Closing, Cleaning, Goods Out) or
// one delivery (Goods In, REF = its PO). Staff pick their name; a run is
// Submitted, then a Manager — signed in with their own Google account, whose
// email is on Staff with ROLE Manager — Approves it (PDF to Drive) or Sends
// it back with a note to fix and resubmit.

const CHECKLISTS = [
  { key: 'opening', name: 'Opening', title: 'Opening checks', per: 'day',
    intro: 'Tick when complete or record the temperature. If the fridge is over 8°C, tell the manager.' },
  { key: 'closing', name: 'Closing', title: 'Closing checks', per: 'day',
    intro: 'Tick when complete or record the temperature. If the fridge is over 8°C, tell the manager.' },
  { key: 'cleaning', name: 'Cleaning', title: 'Cleaning schedule', per: 'day',
    intro: 'Tick when complete, adding notes where necessary.' },
  { key: 'goods-in', name: 'Goods In', title: 'Goods In — observational checklist', per: 'delivery',
    intro: 'Tick when complete and record the temperature. If it\'s over 8°C, tell the manager.' },
  { key: 'goods-out', name: 'Goods Out', title: 'Goods Out — observational checklist', per: 'day',
    intro: 'Tick when complete and record temperatures. If any is over 8°C, tell the manager.' }
];
const checklistByKey = key => CHECKLISTS.find(c => c.key === key);
const CHECKLIST_TEMP_MAX = 8;

// The paper forms, as ChecklistItems rows: [checklist, item, type, options,
// max °C, days, required].
const CHECKLIST_DEFAULTS = [
  ['opening', 'Walk-in display temp', 'temp', '', 8, '', 'Yes'],
  ['opening', 'Walk-in thermometer temp', 'temp', '', 8, '', 'Yes'],
  ['opening', 'Main storeroom pest check', 'tick', '', '', '', 'Yes'],
  ['opening', 'Back storeroom pest check', 'tick', '', '', '', 'Yes'],
  ['opening', 'Toilets and washing up area pest check', 'tick', '', '', '', 'Yes'],

  ['closing', 'Clean and sanitise preparation surfaces', 'tick', '', '', '', 'Yes'],
  ['closing', 'Take bins out and inspect area for pests', 'tick', '', '', '', 'Yes'],
  ['closing', 'Walk-in display temp', 'temp', '', 8, '', 'Yes'],
  ['closing', 'Walk-in thermometer temp', 'temp', '', 8, '', 'Yes'],
  ['closing', 'Main storeroom pest check', 'tick', '', '', '', 'Yes'],
  ['closing', 'Back storeroom pest check', 'tick', '', '', '', 'Yes'],
  ['closing', 'Toilets and washing up area pest check', 'tick', '', '', '', 'Yes'],
  ['closing', 'Sweep and spot mop', 'tick', '', '', '', 'Yes'],
  ['closing', 'Lights off, lock up and set alarm', 'tick', '', '', '', 'Yes'],

  ['cleaning', 'Clean toilets', 'tick', '', '', 'Tue', 'Yes'],
  ['cleaning', 'Sweep and mop toilets', 'tick', '', '', 'Tue', 'Yes'],
  ['cleaning', 'Clean walk-in shelves', 'tick', '', '', 'Wed', 'Yes'],
  ['cleaning', 'Sweep and mop walk-in floor', 'tick', '', '', 'Wed', 'Yes'],
  ['cleaning', 'Deep clean of sink', 'tick', '', '', 'Wed', 'Yes'],
  ['cleaning', 'Clean walls in walk-in', 'tick', '', '', 'Wed', 'Yes'],
  ['cleaning', 'Sweep and mop kitchen area', 'tick', '', '', 'Wed', 'Yes'],
  ['cleaning', 'Mop main floor', 'tick', '', '', 'Wed', 'Yes'],
  ['cleaning', 'Ensure waste collection has been completed', 'tick', '', '', 'Thu', 'Yes'],
  ['cleaning', 'Stock take of chilled items', 'tick', '', '', 'Thu', 'Yes'],
  ['cleaning', 'Check all dates on fresh items', 'tick', '', '', 'Thu', 'Yes'],
  ['cleaning', 'Record wastage', 'tick', '', '', 'Thu', 'Yes'],

  ['goods-in', 'Supplier', 'text', '', '', '', 'Yes'],
  ['goods-in', 'Delivery partner', 'text', '', '', '', 'No'],
  ['goods-in', 'Delivery temperature — received at an appropriate temperature?', 'temp', '', 8, '', 'Yes'],
  ['goods-in', 'All products received within their use-by date?', 'tick', '', '', '', 'Yes'],
  ['goods-in', 'Inspected for broken or damaged packaging, or any possible infestations?', 'tick', '', '', '', 'Yes'],
  ['goods-in', 'Lot / batch numbers recorded with use-by dates and placed in the goods-in folder?', 'tick', '', '', '', 'Yes'],
  ['goods-in', 'Invoice / packing list printed and placed in the goods-in folder?', 'tick', '', '', '', 'Yes'],

  ['goods-out', 'Delivery partner', 'text', '', '', '', 'Yes'],
  ['goods-out', 'Same day or next day', 'choice', 'Same day, Next day', '', '', 'Yes'],
  ['goods-out', 'Number of drops', 'number', '', '', '', 'Yes'],
  ['goods-out', 'Appropriate packaging used? Temperature cold-chain packaging used?', 'tick', '', '', '', 'Yes'],
  ['goods-out', 'Outbound fridge temp', 'temp', '', 8, '', 'Yes'],
  ['goods-out', 'Outbound thermometer temp', 'temp', '', 8, '', 'Yes'],
  ['goods-out', 'Vehicle temp (refrigerated deliveries)', 'temp', '', 8, '', 'No'],
  ['goods-out', 'Lot / batch numbers and use-by dates recorded?', 'tick', '', '', '', 'Yes'],
  ['goods-out', 'Clear allergen and ingredient lists supplied as necessary?', 'tick', '', '', '', 'Yes'],
  ['goods-out', 'Invoice, delivery note or packing list supplied with the delivery?', 'tick', '', '', '', 'Yes']
];

const CL_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clWeekday = iso => CL_WEEKDAYS[new Date(iso + 'T00:00:00').getDay()];

// The items a list asks on `date`: active, for that weekday, in order.
function checklistItemsFor(items, key, date) {
  const day = date ? clWeekday(date) : '';
  return items
    .filter(i => i.CHECKLIST === key && (i.ACTIVE || 'Yes') !== 'No')
    .filter(i => {
      const days = (i.DAYS || '').split(',').map(d => d.trim().slice(0, 3).toLowerCase()).filter(Boolean);
      return !days.length || days.includes(day.toLowerCase());
    })
    .sort((a, b) => (parseFloat(a.ORDER) || 0) - (parseFloat(b.ORDER) || 0));
}

// Rows for "Load the standard checklists": [ID, CHECKLIST, ITEM, TYPE,
// OPTIONS, MAX °C, DAYS, REQUIRED, ORDER, ACTIVE].
function checklistDefaultRows(existingIds) {
  let base = existingIds.length ? existingIds : [['ID']];
  const rows = [];
  CHECKLIST_DEFAULTS.forEach(([list, item, type, options, max, days, required], i) => {
    const id = nextId(base, 'CI');
    base = base.concat([[id]]);
    rows.push([id, list, item, type, options, max, days, required, (i + 1) * 10, 'Yes']);
  });
  return rows;
}

// Answer flags: a temperature over its limit, or a tick marked not done.
function checklistFlags(answers) {
  return answers.filter(a => a.flag).map(a => a.type === 'temp' ? `${a.item}: ${a.value}°C` : `${a.item}: not done`);
}

function parseRunAnswers(run) {
  try { return JSON.parse(run.ANSWERS || '[]'); } catch (e) { return []; }
}

// ---- the PDF saved to Drive on approval ----
//
// Drive turns an uploaded HTML page into a Google Doc, exports that as a
// PDF, and the temporary Doc is deleted — no PDF library needed, and only
// drive.file access (the app sees only files it made). PDFs go in one
// "Provisions Checklists" folder in the approving manager's Drive.
const CHECKLIST_FOLDER_NAME = 'Provisions Checklists';
const CHECKLIST_FOLDER_KEY = 'provisions_checklistsFolderId';

async function driveEnsureChecklistFolder() {
  const cached = localStorage.getItem(CHECKLIST_FOLDER_KEY);
  if (cached) {
    const res = await googleFetch(`https://www.googleapis.com/drive/v3/files/${cached}?fields=id,trashed`);
    if (res.ok && !(await res.json()).trashed) return cached;
  }
  const created = await driveHandle(await googleFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: CHECKLIST_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  }));
  localStorage.setItem(CHECKLIST_FOLDER_KEY, created.id);
  return created.id;
}

async function driveMultipart(metadata, mimeType, body, fields = 'id') {
  const boundary = 'provisions-' + Math.random().toString(36).slice(2);
  const blob = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    body,
    `\r\n--${boundary}--`
  ]);
  return driveHandle(await googleFetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${fields}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: blob
  }));
}

// Saves `html` as `name`.pdf in the checklists folder; returns its link.
async function saveChecklistPdf(name, html) {
  const folder = await driveEnsureChecklistFolder();
  const doc = await driveMultipart({ name, mimeType: 'application/vnd.google-apps.document', parents: [folder] }, 'text/html; charset=UTF-8', html);
  try {
    const res = await googleFetch(`https://www.googleapis.com/drive/v3/files/${doc.id}/export?mimeType=application/pdf`);
    if (!res.ok) throw new Error(`PDF export failed (${res.status})`);
    const pdf = await res.blob();
    const file = await driveMultipart({ name: `${name}.pdf`, parents: [folder] }, 'application/pdf', pdf, 'id,webViewLink');
    return file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
  } finally {
    googleFetch(`https://www.googleapis.com/drive/v3/files/${doc.id}`, { method: 'DELETE' }).catch(() => {});
  }
}

// The printable record of a run, as plain HTML Drive can convert.
function checklistRecordHtml(run, list, answers) {
  const esc = s => escapeHtml((s ?? '').toString());
  const shown = a => a.type === 'tick' ? (a.value === 'Yes' ? '✓ Done' : a.value === 'No' ? '✗ Not done' : '') : a.type === 'temp' && a.value !== '' ? `${a.value} °C` : a.value;
  const day = new Date(run.DATE + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return `<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;font-size:11pt;">
    <h2 style="margin:0 0 4pt;">${esc(list.title)}</h2>
    <p style="margin:0 0 10pt;color:#555;">${esc(day)}${run.REF ? ` · ${esc(run.REF)}` : ''} · Provisions</p>
    <p style="margin:0 0 10pt;font-size:9pt;color:#555;">${esc(list.intro)}</p>
    <table style="border-collapse:collapse;width:100%;" border="1" cellpadding="5">
      <tr style="background:#eee;"><th align="left">Check</th><th align="left">Result</th><th align="left">Notes</th></tr>
      ${answers.map(a => `<tr${a.flag ? ' style="background:#fde8e8;"' : ''}><td>${esc(a.item)}</td><td><b>${esc(shown(a))}</b>${a.flag ? ' — flagged' : ''}</td><td>${esc(a.note)}</td></tr>`).join('')}
    </table>
    ${run.NOTES ? `<p><b>Notes:</b> ${esc(run.NOTES)}</p>` : ''}
    <table style="border-collapse:collapse;margin-top:12pt;" cellpadding="3">
      <tr><td>Completed by</td><td><b>${esc(run['DONE BY'])}</b> · ${esc(run['SUBMITTED AT'])}</td></tr>
      <tr><td>Approved by</td><td><b>${esc(run['REVIEWED BY'])}</b> · ${esc(run['REVIEWED AT'])}</td></tr>
      ${run['MANAGER NOTE'] ? `<tr><td>Manager note</td><td>${esc(run['MANAGER NOTE'])}</td></tr>` : ''}
    </table>
    <p style="font-size:8pt;color:#888;margin-top:14pt;">Record ${esc(run.ID)}</p>
  </body></html>`;
}

// ---- reading the tabs ----

// A tab as { exists, rows: [{ rowNumber, obj }] }; a missing tab (Setup not
// re-run yet) reads as empty rather than failing the page.
async function clLoadTab(spreadsheetId, tab) {
  try {
    const [head = [], ...rest] = await sheetsGet(spreadsheetId, `${tab}!A:Z`);
    return { exists: true, rows: rest.map((r, i) => ({ rowNumber: i + 2, obj: Object.fromEntries(head.map((h, c) => [h, r[c] ?? ''])) })) };
  } catch (err) {
    return { exists: false, rows: [] };
  }
}

// Sheets may hand a date back as 26/11/2026: always work in YYYY-MM-DD.
function clIso(v) {
  const s = (v || '').toString().trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : s.slice(0, 10);
}
function clToday() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The Staff row for the signed-in Google account, if it's a Manager.
function checklistManager(staff) {
  const email = (getStoredUserInfo().email || '').trim().toLowerCase();
  if (!email) return null;
  return staff.find(s => (s.EMAIL || '').trim().toLowerCase() === email && /^manager$/i.test(s.ROLE || '') && (s.ACTIVE || 'Yes') !== 'No') || null;
}

// The latest run of a daily list on a date (Goods In has one per PO instead).
function checklistRunFor(runs, key, date, ref = '') {
  return runs.filter(r => r.CHECKLIST === key && clIso(r.DATE) === date && (r.REF || '') === ref).pop() || null;
}

// For Today: what's waiting for a manager, and the daily lists still to do.
function checklistTodaySummary(items, runs, date = clToday()) {
  const waiting = runs.filter(r => r.STATUS === 'Submitted');
  const sentBack = runs.filter(r => r.STATUS === 'Sent back');
  const todo = ['opening', 'closing', 'cleaning'].filter(key =>
    checklistItemsFor(items, key, date).length && !checklistRunFor(runs, key, date));
  return { waiting, sentBack, todo };
}
