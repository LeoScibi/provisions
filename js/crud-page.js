// Generic "add + edit + remove" table bound to one Sheets tab. Every flat
// list page (Products, Suppliers, Customers, Orders, OrderLines,
// Allocations) configures one of these instead of hand-rolling its
// own fetch/append/update/delete logic, so behaviour — including how a row
// gets deleted or overwritten (via its real sheet row index), how the
// form's unsaved-changes guard works, and how sort/search/column-visibility
// behave — stays identical across tables.
//
// Add and Edit share one <dialog>, opened via a toolbar button or a row's
// Edit button rather than sitting inline on the page, with
// js/dialog-guard.js protecting against losing in-progress input on an
// accidental Cancel/Escape/backdrop click.
//
// config = {
//   mount: '#el',            // container to render the panel into
//   title: 'Suppliers',
//   subtitle: 'Who deliveries come from.', // optional one-liner shown under
//                              // the dialog's title, e.g. "Add Supplier"
//   tab: 'Suppliers',        // sheet tab name
//   headers: [...],          // must match Setup's REQUIRED_TABS for this tab
//   autoId: 'SUP' | null,    // prefix for a generated ID in column A, or null
//                            // if column A is a user-entered natural key
//                            // (e.g. Products.CODE) — that key field is
//                            // shown but locked once editing an existing
//                            // row, since other tabs may reference it.
//   fields: [                // one entry per header, in header order
//     { key:'NAME', label:'Name', type:'text', required:true, primary:true }, // primary: this cell (and any 'image' cell) opens the detail dialog
//     { key:'TIER', label:'Tier', type:'text', placeholder:'e.g. Standard' },
//     { key:'ACTIVE', label:'Active', type:'checkbox' },        // stores TRUE/FALSE
//     { key:'ACTIVE', label:'Active', type:'checkbox', trueValue:'Yes', falseValue:'No' }, // stores Yes/No instead
//     { key:'CATEGORY', label:'Category', type:'select', options:[...] },
//     { key:'SUPPLIER', label:'Supplier', type:'ref', refTab:'Suppliers', refValue:'NAME' },
//     { key:'COST', label:'Cost', type:'number', format:'currency' },
//     { key:'PHOTO', label:'Photo', type:'image' },             // plain URL input; renders as a table thumbnail
//   ],
//   inlineEdit: true,         // opt-in: click a cell to edit it in place instead
//                              // of opening the dialog (see below) — off by
//                              // default so other tables keep today's
//                              // click-Edit-button behaviour unchanged.
//   groupBy: 'Category',      // optional: bucket rows under a heading row
//                             // keyed on this column's value. Display-only;
//                             // ignored while a column sort is active.
//   catalogue: {              // optional: replace the plain sortable table
//                             // with category tabs + bare stat figures +
//                             // grouped card rows (see products.html for a
//                             // full example). Mutually exclusive with the
//                             // table-specific bits above (groupBy, sort,
//                             // Columns picker, inline edit) — a catalogue
//                             // row always opens the detail dialog on click.
//     tabsBy: 'Category',        // field to build the tab bar + counts from;
//                                 // tab order follows that field's own
//                                 // `select` options order when it has one
//     groupBy: 'Category',       // field the card rows are bucketed under
//                                 // within the active tab (usually = tabsBy)
//     photo: 'Photo URL',
//     name: 'Product name',
//     tag: (pick) => ({ text: pick('Storage'), on: pick('Storage') === 'Chilled' }),
//     sub: (pick) => [pick('Producer'), pick('Default supplier')].filter(Boolean).join(' · '),
//     meta: (pick) => [pick('Product code'), packLabel(pick)],   // mono lines, right of the name
//     prices: [
//       { label: 'Cost', get: (pick) => currency(pick('Cost price £')) },
//       { label: 'Landed', get: (pick) => currency(pick('Landed cost £')), big: true },
//     ],
//     gpLabel: 'GP',
//     gp: (pick) => ({ text: '31.2%', color: '#1F7A44' }),
//     badges: (pick) => [{ text: 'No Xero code', tone: 'warn' }],  // tone: warn|crit|yell;
//                                 // every badge shows on the row card, most
//                                 // important first
//     stats: (rows, get) => [{ l: 'Active', n: '231', u: 'SKUs', tone: 'warn' }],
//       // a stat can also be clickable: add `key: 'attention'` (any unique
//       // string) and `filter: (pick) => pick('...') === '...'` — clicking
//       // it toggles a rowsData-wide predicate filter, stacking with the
//       // active tab and search term. Always computed from the full
//       // unfiltered rowsData, never from the current view.
//     layout: 'cards',            // optional: small cards in a grid instead of
//                                 // the default one-line rows. A card shows
//                                 // the photo, tag, name, sub, badges, the
//                                 // last `prices` entry, gp, and `stock`:
//     stock: (pick) => ({ n: '12.4', u: 'kg', l: 'in stock', tone: 'ok' }),
//                                 // optional figure on each card (tone:
//                                 // ok|warn|crit|muted); return null while it
//                                 // isn't known yet, and call the returned
//                                 // handle's rerender() once it is.
//     kicker: (pick) => 'Cheese · CCS050',        // dialog header, above the title
//     detailSub: (pick) => 'Fromagerie Dongé · via Fine Cheese Co',
//     emptyTitle: 'Nothing in the catalogue yet',
//     emptySub: 'Add your first product to get started.'
//   }
//   detailSection: {         // optional: an extra tab in the record dialog,
//     label: 'Products',     // shown only for an existing record (not in
//     first: true,           // Add mode) — e.g. suppliers.html lists the
//     render: (container, pick, rowValues) => { ... }
//   },                       // supplier's products there. `first` puts the
//                            // tab first and opens the record on it. It
//                            // manages its own reads/writes; the record's
//                            // Save button doesn't touch it.
//   onLoad: (rows, get) => { ... },  // optional: fires after each successful
//                             // load with the fresh rowsData array (each
//                             // entry `{ rowNumber, values }`) and the same
//                             // get(values, key) lookup catalogue callbacks
//                             // use — e.g. to update page-level chrome like
//                             // a dynamic subtitle with a live SKU count.
// }
//
// onLoad's third argument, openEdit(rowNumber), opens that row's add/edit
// dialog — e.g. a linked page can deep-link in via a `?open=<ID>` query
// param: `onLoad: (rows, get, openEdit) => { const id = new
// URLSearchParams(location.search).get('open'); const row = id &&
// rows.find(r => get(r.values, 'ID') === id); if (row) openEdit(row.rowNumber); }`
// (clear the query param afterwards with history.replaceState so a later
// manual reload doesn't reopen it).
//
// fields[i] corresponds to headers[i+1] when autoId is set (headers[0] is
// the generated ID, not user-entered) or headers[i] when autoId is null
// (headers[0] IS a field, e.g. CODE).
//
// `format: 'currency'` on a 'number' field displays it as "£12.74" in the
// table (rounded for display only — the stored value keeps full precision)
// and right-aligns/sorts it numerically like any other number field.
//
// The table itself gets, for free: click-a-header to sort (numeric-aware
// for number/currency fields), a search box that filters across every
// column regardless of visibility, and a Columns picker to hide/show
// individual columns — the hidden-column set persists per table via
// localStorage.
//
// Every 'ref' field, plus any 'select' field with more than 3 options, gets
// a searchable trigger instead of a plain <select> (js/searchable-select.js)
// — automatic, no config needed. Same treatment applies to the inline-edit
// cell editor below.
//
// When `inlineEdit` is on:
//   - Any 'image' field is always rendered as the leading column(s), ahead
//     of the sheet's real header order, so a product's photo reads first —
//     this is purely a display reorder; the underlying headers/fields
//     arrays (and therefore the sheet's append-only column order) never
//     change.
//   - Clicking a cell for an editable field type (text/number/select/
//     checkbox/date/ref) turns just that cell into an input; Enter or blur
//     saves it with a single-cell Sheets write, Escape reverts it.
//     'textarea' and 'image' cells aren't inline-editable — edit those from
//     the detail dialog instead.
//   - Clicking an 'image' cell, a field flagged `primary:true`, or (when
//     `autoId` is null) the natural-key column always opens the same
//     add/edit dialog as a "detail card" for the full row — titled with
//     that record's primary value instead of the generic "Edit X" when one
//     is set. A "Details" button in the row's action column does the same,
//     as a guaranteed fallback if no cell in a given row happens to do so.

// One shared popover for every table's long-text cells (.cell-note): shows
// the full text, line breaks kept, as soon as you hover. Attached to <body>
// and positioned by hand so a panel's overflow can't clip it.
function initNoteTips() {
  if (initNoteTips.done) return;
  initNoteTips.done = true;
  const tip = document.createElement('div');
  tip.className = 'note-tip';
  tip.hidden = true;
  document.body.append(tip);
  document.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.cell-note');
    if (!cell) return;
    tip.textContent = cell.dataset.note;
    tip.hidden = false;
    const r = cell.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const below = r.bottom + 8 + t.height < innerHeight;
    tip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - t.width - 8))}px`;
    tip.style.top = `${below ? r.bottom + 6 : r.top - t.height - 6}px`;
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('.cell-note') && !e.relatedTarget?.closest?.('.cell-note')) tip.hidden = true;
  });
  addEventListener('scroll', () => { tip.hidden = true; }, true);
}

async function initCrudTable(config) {
  initNoteTips();
  const { mount, title, tab, headers, autoId, fields, inlineEdit, subtitle, groupBy, catalogue, onLoad, detailSection } = config;
  // Optional category-style grouping: rows are bucketed by this header's
  // value and each bucket gets a `tr.group` heading row. Display-only —
  // it never touches the sheet's row order. Suppressed while a column
  // sort is active, since an explicit sort is a deliberate override.
  const groupColIdx = groupBy ? headers.indexOf(groupBy) : -1;
  const hIdx = {};
  headers.forEach((h, i) => { hIdx[h] = i; });
  // Look up one field's raw value from a row's `values` array by header
  // name rather than position — what every `catalogue` callback is handed.
  function get(values, key) {
    const i = hIdx[key];
    return i === undefined ? '' : (values[i] ?? '');
  }
  let activeTab = null; // catalogue mode only: null = "All"
  let catCounts = new Map(); // catalogue mode only: tabsBy value -> total row count, unfiltered
  let activeStatKey = null; // catalogue mode only: key of the clicked filterable stat tile, if any
  let lastStats = []; // catalogue mode only: the stats array from the last toolbar render, so a stat click can look its own filter back up
  function rowPick(values) { return (key) => get(values, key); }
  const root = document.querySelector(mount);
  const range = `${tab}!A:${colLetter(headers.length)}`;
  const endCol = colLetter(headers.length);
  const singular = /ies$/.test(title) ? title.replace(/ies$/, 'y') : title.replace(/s$/, '');
  let token = null;
  let sheetId = null;
  let rowsData = []; // [{ rowNumber, values }] from the last successful load — array index k always maps to rowNumber k+2, so it's never reordered even when the *displayed* view is sorted/filtered
  let editing = null; // null = Add mode; { rowNumber, id } = editing that existing row
  let sortColIdx = null;
  let sortDir = 1;
  let searchTerm = '';
  const hiddenColsKey = `${tab}_hiddenCols`;
  let hiddenCols = new Set(JSON.parse(localStorage.getItem(hiddenColsKey) || '[]'));
  const refCache = {};
  let inlineEditing = null; // { rowNumber, colIdx, field, original } while a single cell is mid-edit, else null

  root.innerHTML = catalogue ? `
    <div class="cat-toolbar">
      <div class="cat-tabs" id="${tab}_tabs"></div>
      <div class="cat-search">
        <input type="search" id="${tab}_search" placeholder="Search ${escapeHtml(title.toLowerCase())}...">
        <kbd>/</kbd>
      </div>
    </div>
    <div class="cat-stats" id="${tab}_stats"></div>
    <div class="cat-groups" id="${tab}_groups"></div>
    <div id="${tab}_status" class="mono" style="margin-top:8px; font-size:12.5px; color:var(--steel);"></div>

    <dialog id="${tab}_dialog">
      <form id="${tab}_form"></form>
    </dialog>
  ` : `
    <div class="panel-h" style="border:none; background:none; padding:0 0 8px;">
      <h3 style="text-transform:none; letter-spacing:normal; font-size:15px; color:var(--ink); font-weight:600;">${escapeHtml(title)}</h3>
      <button type="button" class="btn add-btn sm" id="${tab}_addBtn" style="margin:0;">+ Add ${escapeHtml(singular)}</button>
      <button type="button" class="btn ghost sm" id="${tab}_reload" style="margin:0;">Reload</button>
    </div>
    <div class="filter-bar">
      <input type="search" id="${tab}_search" placeholder="Search ${escapeHtml(title.toLowerCase())}...">
      <div class="col-picker-wrap">
        <button type="button" class="btn ghost sm" id="${tab}_colsBtn">Columns</button>
        <div class="col-menu" id="${tab}_colsMenu" style="display:none;">
          ${headers.map(h => `<label><input type="checkbox" data-col="${escapeHtml(h)}" ${hiddenCols.has(h) ? '' : 'checked'}> ${escapeHtml(h)}</label>`).join('')}
        </div>
      </div>
    </div>
    <div class="panel"><div class="scroll" style="overflow-x:auto;"><table id="${tab}_table"><thead><tr></tr></thead><tbody></tbody></table></div></div>
    <div id="${tab}_status" class="mono" style="margin-top:8px; font-size:12.5px; color:var(--steel);"></div>

    <dialog id="${tab}_dialog">
      <form id="${tab}_form"></form>
    </dialog>
  `;

  const statusEl = root.querySelector(`#${tab}_status`);
  const tableEl = root.querySelector(`#${tab}_table`);
  const dialogEl = root.querySelector(`#${tab}_dialog`);
  const form = root.querySelector(`#${tab}_form`);
  const searchInput = root.querySelector(`#${tab}_search`);
  const colsBtn = root.querySelector(`#${tab}_colsBtn`);
  const colsMenu = root.querySelector(`#${tab}_colsMenu`);
  const tabsEl = root.querySelector(`#${tab}_tabs`);
  const statsEl = root.querySelector(`#${tab}_stats`);
  const groupsEl = root.querySelector(`#${tab}_groups`);

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.style.color = kind === 'error' ? 'var(--crit)' : kind === 'ok' ? 'var(--ok)' : 'var(--steel)';
  }

  function setDlgStatus(msg, kind) {
    const el = root.querySelector(`#${tab}_dlgStatus`);
    if (!el) return;
    el.textContent = msg;
    el.style.color = kind === 'error' ? 'var(--crit)' : kind === 'ok' ? 'var(--ok)' : 'var(--steel)';
  }

  async function ensureAuth(statusFn = setStatus) {
    const cfg = getStoredConfig();
    token = tryResumeSession();
    if (!token || !cfg.spreadsheetId) { statusFn('Sign in on the Dashboard first.', 'error'); return null; }
    return cfg;
  }

  async function ensureSheetId(cfg) {
    if (sheetId !== null) return sheetId;
    const tabs = await sheetsGetTabs(cfg.spreadsheetId, token);
    const found = tabs.find(t => t.title === tab);
    sheetId = found ? found.sheetId : null;
    return sheetId;
  }

  async function loadRefOptions(field, cfg) {
    if (refCache[field.refTab]) return refCache[field.refTab];
    const rows = await sheetsGet(cfg.spreadsheetId, `${field.refTab}!A:Z`, token);
    if (!rows.length) { refCache[field.refTab] = []; return []; }
    const [head, ...rest] = rows;
    const valueIdx = head.indexOf(field.refValue);
    const labelIdx = field.refLabel ? head.indexOf(field.refLabel) : -1;
    const opts = rest
      .filter(r => (r[valueIdx] || '').toString().trim() !== '')
      .map(r => ({ value: r[valueIdx], label: labelIdx >= 0 && r[labelIdx] ? `${r[valueIdx]} — ${r[labelIdx]}` : r[valueIdx] }));
    refCache[field.refTab] = opts;
    return opts;
  }

  // Header/field keys can contain spaces or slashes (e.g. "UNIT TYPE",
  // "BATCH/LOT NUMBER") which aren't safe inside a bare CSS id selector —
  // every element id and lookup goes through this sanitized form instead.
  function fid(f) {
    return `${tab}_f_${f.key.replace(/[^A-Za-z0-9]/g, '_')}`;
  }

  // Maps a `headers` column index back to its field definition (undefined
  // for the autoId-owned ID column, which has no field).
  function fieldForHeaderIndex(idx) {
    const fieldIdx = autoId ? idx - 1 : idx;
    return fields[fieldIdx];
  }

  // Column render order: image field(s) first, then everything else in its
  // real header order. Display-only — sorting/hiding/search still key off
  // the real header index carried in each cell's data-col-idx, so this
  // never touches the sheet's actual (append-only) column order.
  const displayOrder = (() => {
    const idxs = headers.map((_, i) => i);
    const imageIdxs = idxs.filter(i => { const f = fieldForHeaderIndex(i); return f && f.type === 'image'; });
    const restIdxs = idxs.filter(i => !imageIdxs.includes(i));
    return [...imageIdxs, ...restIdxs];
  })();

  function isInlineEditable(field) {
    return !!field && ['text', 'number', 'select', 'checkbox', 'date', 'ref'].includes(field.type);
  }

  // Whether clicking this column's cell should open the detail dialog
  // instead of (or as well as, for non-editable types) inline-editing.
  function opensDetail(field, idx) {
    if (!inlineEdit || !field) return false;
    if (field.type === 'image' || field.primary) return true;
    if (!autoId && idx === 0) return true; // the natural key — locked in the dialog too
    return false;
  }

  function fieldInputHtml(f) {
    const id = fid(f);
    if (f.type === 'textarea') return `<textarea id="${id}" placeholder="${escapeHtml(f.placeholder || '')}"></textarea>`;
    if (f.type === 'checkbox') return `<input type="checkbox" id="${id}">`;
    if (f.type === 'number') return `<input type="number" step="any" id="${id}" placeholder="${escapeHtml(f.placeholder || '')}">`;
    if (f.type === 'date') return `<input type="date" id="${id}">`;
    if (f.type === 'select') return `<select id="${id}"><option value="">—</option>${f.options.map(o => {
      const opt = typeof o === 'object' ? o : { value: o, label: o };
      return `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`;
    }).join('')}</select>`;
    if (f.type === 'ref') return `<select id="${id}"><option value="">Loading…</option></select>`;
    if (f.type === 'file') return `
      <input id="${id}" placeholder="${escapeHtml(f.placeholder || '')}">
      <div class="file-field-row">
        <input type="file" id="${id}_file" class="file-field-input">
        ${f.onUpload ? `<button type="button" class="btn ghost sm" id="${id}_uploadBtn">Upload</button>` : ''}
      </div>
      <div class="file-field-status mono" id="${id}_status"></div>
    `;
    // 'image' falls through to the default plain text input below — it's
    // just a URL field; only its table display differs (see displayCell).
    return `<input id="${id}" placeholder="${escapeHtml(f.placeholder || '')}">`;
  }

  // Keeps a 'file' field's "Open ↗" link in sync with its underlying URL
  // input, whether that value came from typing/pasting, populateFieldsFromRow
  // (edit mode), or a completed upload.
  function syncFileFieldLink(f) {
    if (f.type !== 'file') return;
    const urlInput = form.querySelector(`#${fid(f)}`);
    const link = form.querySelector(`#${fid(f)}_view`);
    if (!urlInput || !link) return;
    const v = urlInput.value.trim();
    link.style.display = v ? 'inline' : 'none';
    link.href = v;
  }

  // Wires each 'file' field's Upload button (when the field config supplies
  // `onUpload`) and keeps its "Open ↗" link in sync. `onUpload(file, getField)`
  // is page-specific (it's how Drive knowledge stays out of this generic
  // module) — `getField(key)` reads another field's current, unsaved form
  // value, e.g. to name the uploaded file after the record's own key field.
  function wireFileFields() {
    fields.forEach(f => {
      if (f.type !== 'file') return;
      const urlInput = form.querySelector(`#${fid(f)}`);
      urlInput.addEventListener('input', () => syncFileFieldLink(f));
      urlInput.addEventListener('change', () => syncFileFieldLink(f));
      if (!f.onUpload) return;
      const fileInput = form.querySelector(`#${fid(f)}_file`);
      const uploadBtn = form.querySelector(`#${fid(f)}_uploadBtn`);
      const statusEl = form.querySelector(`#${fid(f)}_status`);
      uploadBtn.addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) { statusEl.textContent = 'Choose a file first.'; statusEl.style.color = 'var(--crit)'; return; }
        uploadBtn.disabled = true;
        statusEl.textContent = 'Uploading...'; statusEl.style.color = 'var(--steel)';
        try {
          const url = await f.onUpload(file, (key) => {
            const other = fields.find(x => x.key === key);
            return other ? fieldValue(other) : '';
          });
          urlInput.value = url;
          syncFileFieldLink(f);
          statusEl.textContent = 'Uploaded.'; statusEl.style.color = 'var(--ok)';
          fileInput.value = '';
        } catch (err) {
          statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--crit)';
        } finally {
          uploadBtn.disabled = false;
        }
      });
    });
  }

  // Builds the dialog's form DOM once. Ref-type <select> options are filled
  // in later, on each dialog open, so they're never stale.
  //
  // Fields are normally one flat grid. A field can opt into a named
  // `section` (e.g. 'Docs & training') to be grouped under a small tab
  // bar instead — purely a dialog-layout thing, unrelated to sort/search/
  // sheet-column order. Only kicks in once 2+ distinct sections exist, so
  // pages that never set `section` render exactly as before.
  function renderForm() {
    const sectionOrder = [];
    const sectionFields = new Map();
    fields.forEach(f => {
      const sec = f.section || null;
      if (!sectionFields.has(sec)) { sectionFields.set(sec, []); sectionOrder.push(sec); }
      sectionFields.get(sec).push(f);
    });
    const hasTabs = sectionOrder.length > 1 || !!detailSection;
    const EXTRA = '__extra';
    const extraTab = detailSection ? `<button type="button" class="cat-tab" data-dlg-tab="${EXTRA}">${escapeHtml(detailSection.label)}</button>` : '';
    const extraPanel = detailSection ? `<div class="dlg-tab-panel dlg-extra" data-dlg-panel="${EXTRA}" id="${tab}_dlgExtra" style="display:none;"></div>` : '';

    const fieldHtml = (f) => `<div class="col field"><label>${escapeHtml(f.label)}${f.required ? ' *' : ''}${f.type === 'file' ? ` <a href="#" class="file-field-view" id="${fid(f)}_view" target="_blank" rel="noopener">Open ↗</a>` : ''}</label>${fieldInputHtml(f)}</div>`;
    const rowClass = `row${catalogue ? ' grid3' : ''}`;
    const bodyHtml = hasTabs ? `
      <div class="cat-tabs dlg-tabs" id="${tab}_dlgTabs">
        ${detailSection?.first ? extraTab : ''}
        ${sectionOrder.map((sec, i) => `<button type="button" class="cat-tab${i === 0 ? ' active' : ''}" data-dlg-tab="${escapeHtml(sec || '')}">${escapeHtml(sec || 'Details')}</button>`).join('')}
        ${detailSection && !detailSection.first ? extraTab : ''}
      </div>
      ${sectionOrder.map((sec, i) => `<div class="${rowClass} dlg-tab-panel" data-dlg-panel="${escapeHtml(sec || '')}" style="${i === 0 ? '' : 'display:none;'}">${sectionFields.get(sec).map(fieldHtml).join('')}</div>`).join('')}
      ${extraPanel}
    ` : `<div class="${rowClass}">${fields.map(fieldHtml).join('')}</div>`;

    form.innerHTML = `
      <div class="dlg-h${catalogue ? ' detail' : ''}">
        ${catalogue ? `<img class="dlg-photo" id="${tab}_dlgPhoto" src="" alt="" style="display:none;">` : ''}
        <div>
          ${catalogue ? `<div class="dlg-kicker" id="${tab}_dlgKicker"></div>` : ''}
          <div class="ttl" id="${tab}_dlgTitle">Add ${escapeHtml(singular)}</div>
          ${catalogue ? `<div class="subtitle" id="${tab}_dlgSub"></div>` : (subtitle ? `<div class="subtitle">${escapeHtml(subtitle)}</div>` : '')}
        </div>
        <button type="button" class="dlg-close" data-cancel aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="dlg-b">
        ${bodyHtml}
        <div id="${tab}_dlgStatus" class="mono" style="margin-top:10px; font-size:12.5px; color:var(--steel);"></div>
      </div>
      <div class="dlg-f">
        ${catalogue ? `<button type="button" class="btn danger" id="${tab}_dlgRemove" data-remove style="margin-right:auto; display:none;">Remove</button>` : ''}
        <button type="button" class="btn ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn" id="${tab}_submitBtn">Add ${escapeHtml(singular)}</button>
      </div>
    `;

    if (hasTabs) {
      form.querySelector(`#${tab}_dlgTabs`).addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-dlg-tab]');
        if (btn) showDlgTab(btn.dataset.dlgTab);
      });
    }

    resetFieldValues();
    wireFileFields();
  }

  // Switches the dialog's tab bar (field sections + any detailSection tab);
  // with no key, goes to the first visible tab.
  function showDlgTab(key) {
    const btns = [...form.querySelectorAll('.dlg-tabs .cat-tab')].filter(b => !b.hidden);
    if (!btns.length) return;
    if (key === undefined) key = btns[0].dataset.dlgTab;
    btns.forEach(b => b.classList.toggle('active', b.dataset.dlgTab === key));
    form.querySelectorAll('.dlg-tab-panel').forEach(p => { p.style.display = p.dataset.dlgPanel === key ? '' : 'none'; });
  }

  function resetFieldValues() {
    for (const f of fields) {
      const el = form.querySelector(`#${fid(f)}`);
      if (f.type === 'checkbox') el.checked = false;
      else if (f.type === 'date' && f.default === 'today') el.value = new Date().toISOString().slice(0, 10);
      else el.value = '';
      syncFileFieldLink(f);
    }
    // The natural-key field (Products.CODE etc.) is only ever locked while
    // editing an existing row — Add mode always starts unlocked.
    if (!autoId) form.querySelector(`#${fid(fields[0])}`).disabled = false;
  }

  // Fills the form from an existing row's raw cell values (index-aligned to
  // `headers`, offset by 1 when autoId owns column A). Dispatches a real
  // 'change' event per field afterwards so page-specific logic hooked onto
  // these inputs (e.g. the Allocations FEFO helper) reacts the same way it
  // would to the user actually picking that value.
  function populateFieldsFromRow(rowValues) {
    const offset = autoId ? 1 : 0;
    fields.forEach((f, i) => {
      const el = form.querySelector(`#${fid(f)}`);
      const raw = rowValues[i + offset] ?? '';
      if (f.type === 'checkbox') el.checked = (raw || '').toString().toUpperCase() === (f.trueValue || 'TRUE').toUpperCase();
      else el.value = raw;
    });
    fields.forEach(f => {
      form.querySelector(`#${fid(f)}`).dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  async function refreshRefOptions() {
    const cfg = getStoredConfig();
    if (!cfg.spreadsheetId) return;
    for (const f of fields) {
      if (f.type !== 'ref') continue;
      const sel = form.querySelector(`#${fid(f)}`);
      try {
        delete refCache[f.refTab]; // always fetch fresh when the dialog opens
        const opts = await loadRefOptions(f, cfg);
        sel.innerHTML = `<option value="">—</option>` + opts.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
      } catch (err) {
        sel.innerHTML = `<option value="">(error loading ${escapeHtml(f.refTab)})</option>`;
      }
    }
  }

  function fieldValue(f) {
    const el = form.querySelector(`#${fid(f)}`);
    if (f.type === 'checkbox') return el.checked ? (f.trueValue || 'TRUE') : (f.falseValue || 'FALSE');
    return el.value.trim();
  }

  function isNumericField(f) {
    return !!f && (f.type === 'number' || f.format === 'currency');
  }

  function displayCell(field, value) {
    if (field && field.type === 'checkbox') {
      const on = (value || '').toString().toUpperCase() === (field.trueValue || 'TRUE').toUpperCase();
      const onLabel = field.trueValue || 'Yes';
      const offLabel = field.falseValue || 'No';
      return `<span class="tag ${on ? 't-ok' : 't-amb'}">${on ? onLabel : offLabel}</span>`;
    }
    if (field && field.format === 'currency') {
      const n = parseFloat(value);
      return isNaN(n) ? '' : `£${n.toFixed(2)}`;
    }
    if (field && field.type === 'image') {
      const url = (value || '').toString().trim();
      const box = 'width:38px;height:38px;border-radius:8px;vertical-align:middle;background:#EEF0F2;';
      return url
        ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" style="${box}object-fit:cover;display:block;">`
        : `<span style="${box}display:inline-block;"></span>`;
    }
    // A textarea's full text would blow out row height, so the cell shows it
    // on one line (cut off with an ellipsis) and the whole thing pops up on
    // hover — see initNoteTips() below.
    if (field && field.type === 'textarea') {
      const v = (value || '').toString().trim();
      if (!v) return '';
      return `<span class="cell-note" data-note="${escapeHtml(v)}">${escapeHtml(v.replace(/\s*\n+\s*/g, ', '))}</span>`;
    }
    return escapeHtml(value);
  }

  // ---- inline cell editing (opt-in via config.inlineEdit) ----

  function inlineInputHtml(field, value) {
    const v = (value ?? '').toString();
    if (field.type === 'checkbox') {
      const checked = v.toUpperCase() === (field.trueValue || 'TRUE').toUpperCase();
      return `<input type="checkbox" ${checked ? 'checked' : ''}>`;
    }
    if (field.type === 'number') return `<input type="number" step="any" value="${escapeHtml(v)}">`;
    if (field.type === 'date') return `<input type="date" value="${escapeHtml(v)}">`;
    if (field.type === 'select') return `<select><option value="">—</option>${field.options.map(o => {
      const opt = typeof o === 'object' ? o : { value: o, label: o };
      return `<option value="${escapeHtml(opt.value)}" ${opt.value === v ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`;
    }).join('')}</select>`;
    if (field.type === 'ref') return `<select><option value="${escapeHtml(v)}">${escapeHtml(v || 'Loading…')}</option></select>`;
    return `<input value="${escapeHtml(v)}">`;
  }

  async function populateInlineRefOptions(field, selectEl) {
    const cfg = getStoredConfig();
    if (!cfg.spreadsheetId) return;
    try {
      delete refCache[field.refTab]; // always fetch fresh, same as the dialog does
      const opts = await loadRefOptions(field, cfg);
      const current = selectEl.value;
      selectEl.innerHTML = `<option value="">—</option>` + opts.map(o => `<option value="${escapeHtml(o.value)}" ${o.value === current ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('');
    } catch (err) {
      // leave the current-value placeholder option in place
    }
  }

  // Turns one <td> into a live input, saving on blur/Enter (or immediately
  // on change, for select/ref/checkbox) with a single-cell Sheets write —
  // no full-row resubmission and no dialog. Escape reverts without saving.
  function beginInlineEdit(td, rowNumber, colIdx, field) {
    if (inlineEditing) return; // one cell at a time; the other one commits on its own blur
    const row = rowsData[rowNumber - 2];
    if (!row) return;
    const original = row.values[colIdx] ?? '';
    inlineEditing = { rowNumber, colIdx, field, original };
    td.innerHTML = inlineInputHtml(field, original);
    const input = td.querySelector('input, select');
    const cbx = (field.type === 'ref' || (field.type === 'select' && field.options.length > 3)) ? enhanceSelect(input) : null;
    if (cbx) cbx.trigger.focus();
    else { input.focus(); if (input.select) input.select(); }
    if (field.type === 'ref') populateInlineRefOptions(field, input);

    const revert = () => { if (cbx) cbx.destroy(); td.innerHTML = displayCell(field, original); };

    const commit = async () => {
      if (!inlineEditing) return; // already committed/cancelled via another event
      inlineEditing = null;
      const value = field.type === 'checkbox'
        ? (input.checked ? (field.trueValue || 'TRUE') : (field.falseValue || 'FALSE'))
        : input.value.trim();

      if (field.required && !value) { setStatus(`${field.label} is required.`, 'error'); revert(); return; }
      if (field.type !== 'checkbox' && value === (original ?? '').toString().trim()) { revert(); return; }

      const cfg = await ensureAuth();
      if (!cfg) { revert(); return; }
      const col = colLetter(colIdx + 1);
      try {
        await sheetsUpdateRange(cfg.spreadsheetId, `${tab}!${col}${rowNumber}:${col}${rowNumber}`, [[value]], token, 'USER_ENTERED');
        row.values[colIdx] = value;
        if (cbx) cbx.destroy();
        td.innerHTML = displayCell(field, value);
        setStatus('Saved.', 'ok');
      } catch (err) {
        setStatus('Error saving: ' + err.message, 'error');
        revert();
      }
    };
    const cancel = () => { inlineEditing = null; revert(); };

    input.addEventListener('blur', commit);
    if (field.type === 'select' || field.type === 'ref' || field.type === 'checkbox') {
      input.addEventListener('change', commit);
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });
    if (cbx) {
      // The hidden native <select> never receives focus/blur/keydown once
      // enhanced — the trigger button does instead. A pick already commits
      // via the 'change' listener above; this just covers leaving the
      // widget without picking anything (click away, or Escape).
      cbx.wrap.addEventListener('focusout', (e) => { if (!cbx.wrap.contains(e.relatedTarget)) commit(); });
      cbx.trigger.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } });
    }
  }

  // Best available title for a record's detail dialog: its `primary`
  // field's value, falling back to the natural key (when there is one),
  // falling back to the generic "Edit X" set by the caller.
  function recordTitle(rowValues) {
    const offset = autoId ? 1 : 0;
    const primaryField = fields.find(f => f.primary);
    if (primaryField) {
      const v = (rowValues[fields.indexOf(primaryField) + offset] || '').toString().trim();
      if (v) return v;
    }
    if (!autoId) {
      const v = (rowValues[0] || '').toString().trim();
      if (v) return v;
    }
    return null;
  }

  async function loadRows() {
    const cfg = getStoredConfig();
    if (!cfg.spreadsheetId) { setStatus('Sign in on the Dashboard first.', 'error'); return; }
    token = tryResumeSession();
    if (!token) { setStatus('Sign in on the Dashboard first.', 'error'); return; }
    setStatus('Loading...');
    try {
      const rows = await sheetsGet(cfg.spreadsheetId, range, token);
      const rest = rows.length ? rows.slice(1) : [];
      rowsData = rest.map((values, i) => ({ rowNumber: i + 2, values }));
      if (catalogue) renderCatalogueToolbar();
      applyViewAndRender();
      if (onLoad) onLoad(rowsData, get, handleEdit);
      setStatus(`Loaded ${rest.length} row(s).`, 'ok');
    } catch (err) {
      setStatus('Error loading: ' + err.message, 'error');
    }
  }

  function compareCell(a, b, colIdx) {
    if (isNumericField(fieldForHeaderIndex(colIdx))) {
      const na = parseFloat(a); const nb = parseFloat(b);
      const va = isNaN(na) ? -Infinity : na;
      const vb = isNaN(nb) ? -Infinity : nb;
      return va - vb;
    }
    return (a ?? '').toString().localeCompare((b ?? '').toString());
  }

  function applyViewAndRender() {
    let view = rowsData;
    if (catalogue && activeTab !== null) {
      const idx = hIdx[catalogue.tabsBy];
      view = view.filter(d => (d.values[idx] || '').toString().trim() === activeTab);
    }
    if (catalogue && activeStatKey) {
      const stat = lastStats.find(s => s.key === activeStatKey);
      if (stat && stat.filter) view = view.filter(d => stat.filter(rowPick(d.values)));
    }
    if (searchTerm) {
      view = view.filter(d => d.values.some(v => searchMatch(v, searchTerm)));
    }
    if (catalogue) { renderCatalogueGroups(view); return; }
    if (sortColIdx !== null) {
      view = [...view].sort((a, b) => compareCell(a.values[sortColIdx], b.values[sortColIdx], sortColIdx) * sortDir);
    }
    renderTable(view);
  }

  function renderTable(viewRows) {
    const thead = tableEl.querySelector('thead tr');
    const tbody = tableEl.querySelector('tbody');

    thead.innerHTML = displayOrder.map(idx => {
      const h = headers[idx];
      if (hiddenCols.has(h)) return '';
      const numCls = isNumericField(fieldForHeaderIndex(idx)) ? ' num' : '';
      const arrow = sortColIdx === idx ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
      return `<th class="sortable${numCls}" data-col-idx="${idx}">${escapeHtml(h)}${arrow}</th>`;
    }).join('') + '<th></th>';

    if (!viewRows.length) {
      const visibleCount = headers.filter(h => !hiddenCols.has(h)).length + 1;
      const msg = rowsData.length ? 'No rows match your search.' : 'No rows yet.';
      tbody.innerHTML = `<tr><td colspan="${visibleCount}" class="empty" style="padding:18px;">${msg}</td></tr>`;
      return;
    }

    const rowHtml = (d) => {
      const cells = displayOrder.map(idx => {
        const h = headers[idx];
        if (hiddenCols.has(h)) return '';
        const field = fieldForHeaderIndex(idx);
        const classes = [];
        if (isNumericField(field)) classes.push('num');
        let titleAttr = '';
        if (opensDetail(field, idx)) { classes.push('cell-detail'); titleAttr = ' title="Click to view details"'; }
        else if (inlineEdit && isInlineEditable(field)) { classes.push('cell-editable'); titleAttr = ' title="Click to edit"'; }
        const classAttr = classes.length ? ` class="${classes.join(' ')}"` : '';
        return `<td${classAttr}${titleAttr} data-col-idx="${idx}">${displayCell(field, d.values[idx])}</td>`;
      }).join('');
      const editLabel = inlineEdit ? 'Details' : 'Edit';
      return `<tr data-row="${d.rowNumber}">${cells}<td style="white-space:nowrap;"><button type="button" class="btn ghost sm" data-edit="${d.rowNumber}">${editLabel}</button> <button type="button" class="btn danger sm" data-del="${d.rowNumber}">Remove</button></td></tr>`;
    };

    if (groupColIdx === -1 || hiddenCols.has(headers[groupColIdx]) || sortColIdx !== null) {
      tbody.innerHTML = viewRows.map(rowHtml).join('');
      return;
    }

    const colSpan = headers.filter(h => !hiddenCols.has(h)).length + 1;
    const order = [];
    const buckets = new Map();
    viewRows.forEach(d => {
      const key = (d.values[groupColIdx] || '').toString().trim() || 'Uncategorised';
      if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
      buckets.get(key).push(d);
    });
    order.sort((a, b) => a.localeCompare(b));
    tbody.innerHTML = order.map(key =>
      `<tr class="group"><td colspan="${colSpan}"><span class="g-name">${escapeHtml(key)}</span><span class="g-count">${buckets.get(key).length}</span></td></tr>`
      + buckets.get(key).map(rowHtml).join('')
    ).join('');
  }

  // ---- catalogue mode: tabs + stat figures + grouped card rows ----

  function renderCatalogueToolbar() {
    const tabsIdx = hIdx[catalogue.tabsBy];
    catCounts = new Map();
    rowsData.forEach(d => {
      const v = (d.values[tabsIdx] || '').toString().trim();
      if (!v) return;
      catCounts.set(v, (catCounts.get(v) || 0) + 1);
    });
    const tabsField = fields.find(f => f.key === catalogue.tabsBy);
    const orderedLabels = tabsField && tabsField.options
      ? tabsField.options.map(o => (typeof o === 'object' ? o.value : o)).filter(v => catCounts.has(v))
      : [...catCounts.keys()].sort();

    tabsEl.innerHTML = [{ label: 'All', v: null }].concat(orderedLabels.map(l => ({ label: l, v: l }))).map(t => `
      <button type="button" class="cat-tab${activeTab === t.v ? ' active' : ''}" data-tab="${t.v === null ? '' : escapeHtml(t.v)}">
        ${escapeHtml(t.label)}<span class="n">${t.v === null ? rowsData.length : catCounts.get(t.v)}</span>
      </button>`).join('');

    if (catalogue.stats) {
      lastStats = catalogue.stats(rowsData, get);
      statsEl.innerHTML = lastStats.map(s => {
        const toneClass = s.tone === 'crit' ? ' bad' : s.tone === 'warn' ? ' alert' : '';
        const filterableClass = s.filter ? ' filterable' : '';
        const activeClass = s.filter && activeStatKey === s.key ? ' filter-active' : '';
        const tag = s.filter ? 'button' : 'div';
        const attrs = s.filter ? ` type="button" data-stat-key="${escapeHtml(s.key)}"` : '';
        return `<${tag}${attrs} class="stat${toneClass}${filterableClass}${activeClass}">
          <div class="l">${escapeHtml(s.l)}</div>
          <div class="n">${escapeHtml(s.n)}${s.u ? ` <span style="font-size:12px;color:var(--steel);font-weight:500;">${escapeHtml(s.u)}</span>` : ''}</div>
        </${tag}>`;
      }).join('');
    }
  }

  function catRowHtml(d) {
    const pick = (key) => get(d.values, key);
    const photoUrl = catalogue.photo ? (pick(catalogue.photo) || '').toString().trim() : '';
    const name = catalogue.name ? pick(catalogue.name) : '';
    const tagInfo = catalogue.tag ? catalogue.tag(pick) : null;
    const subText = catalogue.sub ? catalogue.sub(pick) : '';
    const metaLines = catalogue.meta ? catalogue.meta(pick) : [];
    const badges = catalogue.badges ? catalogue.badges(pick) : [];
    const gpInfo = catalogue.gp ? catalogue.gp(pick) : null;

    const photoHtml = photoUrl
      ? `<img class="cr-photo" src="${escapeHtml(photoUrl)}" alt="" loading="lazy">`
      : `<span class="cr-photo"></span>`;
    const tagHtml = tagInfo && tagInfo.text
      ? `<span class="tag ${tagInfo.on ? 't-chill' : 't-amb'}">${escapeHtml(tagInfo.text)}</span>` : '';
    const badgeHtml = badges.map(b => `<span class="tag t-${b.tone}">${escapeHtml(b.text)}</span>`).join('');
    const priceCells = (catalogue.prices || []).map(p => `<div class="cr-price${p.big ? ' big' : ''}">${escapeHtml(p.get(pick))}</div>`).join('');

    return `
      <div class="cat-row" data-row="${d.rowNumber}">
        ${photoHtml}
        <div class="cr-info">
          <div class="cr-name-line">
            <span class="cr-name">${escapeHtml(name)}</span>
            ${tagHtml}${badgeHtml}
          </div>
          ${subText ? `<div class="cr-sub">${escapeHtml(subText)}</div>` : ''}
        </div>
        <div class="cr-meta">${metaLines.map(l => `<div>${escapeHtml(l)}</div>`).join('')}</div>
        ${priceCells}
        ${gpInfo ? `<div class="cr-gp" style="color:${gpInfo.color}">${escapeHtml(gpInfo.text)}</div>` : ''}
      </div>`;
  }

  // Card variant of catRowHtml, for `catalogue.layout: 'cards'`.
  function catCardHtml(d) {
    const pick = (key) => get(d.values, key);
    const photoUrl = catalogue.photo ? (pick(catalogue.photo) || '').toString().trim() : '';
    const name = catalogue.name ? pick(catalogue.name) : '';
    const tagInfo = catalogue.tag ? catalogue.tag(pick) : null;
    const subText = catalogue.sub ? catalogue.sub(pick) : '';
    const badges = catalogue.badges ? catalogue.badges(pick) : [];
    const price = (catalogue.prices || []).slice(-1)[0];
    const gpInfo = catalogue.gp ? catalogue.gp(pick) : null;
    const stock = catalogue.stock ? catalogue.stock(pick) : null;

    return `
      <button type="button" class="pcard" data-row="${d.rowNumber}">
        <span class="pc-photo">
          ${photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="" loading="lazy">` : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5l9-4 9 4-9 4-9-4z"/><path d="M3 7.5v9l9 4 9-4v-9"/><path d="M12 11.5v9"/></svg>`}
        </span>
        <span class="pc-body">
          <span class="pc-name">${escapeHtml(name)}</span>
          ${subText ? `<span class="pc-sub">${escapeHtml(subText)}</span>` : ''}
          <span class="pc-badges">${tagInfo && tagInfo.text ? `<span class="tag ${tagInfo.on ? 't-chill' : 't-amb'}">${escapeHtml(tagInfo.text)}</span>` : ''}${badges.map(b => `<span class="tag t-${b.tone}">${escapeHtml(b.text)}</span>`).join('')}</span>
        </span>
        <span class="pc-foot">
            ${catalogue.stock ? (stock
              ? `<span class="pc-stock ${stock.tone || ''}"><b>${escapeHtml(stock.n)}${stock.u ? `<em>${escapeHtml(stock.u)}</em>` : ''}</b><small>${escapeHtml(stock.l || '')}</small></span>`
              : `<span class="pc-stock loading"><b>…</b><small>stock</small></span>`) : ''}
            ${price ? `<span class="pc-price"><b>${escapeHtml(price.get(pick))}</b><small>${escapeHtml(price.label.toLowerCase())}${gpInfo ? ` · <span style="color:${gpInfo.color}">${escapeHtml(catalogue.gpLabel || 'GP')} ${escapeHtml(gpInfo.text)}</span>` : ''}</small></span>` : ''}
        </span>
      </button>`;
  }

  function renderCatalogueGroups(viewRows) {
    if (!viewRows.length) {
      const title = rowsData.length ? 'No rows match the current filters.' : (catalogue.emptyTitle || 'Nothing here yet.');
      const sub = !rowsData.length && catalogue.emptySub ? `<div>${escapeHtml(catalogue.emptySub)}</div>` : '';
      groupsEl.innerHTML = `<div class="empty"><strong>${escapeHtml(title)}</strong>${sub}</div>`;
      return;
    }
    const groupIdx = hIdx[catalogue.groupBy || catalogue.tabsBy];
    const order = [];
    const buckets = new Map();
    viewRows.forEach(d => {
      const key = (d.values[groupIdx] || '').toString().trim() || 'Uncategorised';
      if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
      buckets.get(key).push(d);
    });
    const cards = catalogue.layout === 'cards';
    groupsEl.innerHTML = order.map(key => {
      const items = buckets.get(key);
      const total = catCounts.get(key) || items.length;
      if (cards) return `
        <div class="cat-group">
          <div class="cat-group-head">
            <span class="g-name">${escapeHtml(key)}</span>
            <span class="g-count">${items.length} of ${total}</span>
          </div>
          <div class="pcards">${items.map(catCardHtml).join('')}</div>
        </div>`;
      return `
        <div class="cat-group">
          <div class="cat-group-head">
            <span class="g-name">${escapeHtml(key)}</span>
            <span class="g-count">${items.length} of ${total}</span>
            <span class="g-spacer"></span>
            ${(catalogue.prices || []).map(p => `<span class="g-col">${escapeHtml(p.label)}</span>`).join('')}
            ${catalogue.gp ? `<span class="g-col gp">${escapeHtml(catalogue.gpLabel || 'GP')}</span>` : ''}
          </div>
          ${items.map(catRowHtml).join('')}
        </div>`;
    }).join('');
  }

  async function handleDelete(rowNumber) {
    if (!confirm('Remove this row? This can\'t be undone.')) return;
    const cfg = await ensureAuth();
    if (!cfg) return;
    try {
      const sid = await ensureSheetId(cfg);
      if (sid === null) throw new Error(`Tab "${tab}" not found — run Setup first.`);
      await sheetsBatchUpdate(cfg.spreadsheetId, [{
        deleteDimension: { range: { sheetId: sid, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } }
      }], token);
      setStatus('Row removed.', 'ok');
      loadRows();
    } catch (err) {
      setStatus('Error removing row: ' + err.message, 'error');
    }
  }

  if (catalogue) {
    tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      activeTab = btn.dataset.tab || null;
      renderCatalogueToolbar();
      applyViewAndRender();
    });
    groupsEl.addEventListener('click', (e) => {
      const row = e.target.closest('.cat-row[data-row], .pcard[data-row]');
      if (row) handleEdit(parseInt(row.dataset.row, 10));
    });
    statsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-stat-key]');
      if (!btn) return;
      activeStatKey = activeStatKey === btn.dataset.statKey ? null : btn.dataset.statKey;
      renderCatalogueToolbar();
      applyViewAndRender();
    });
    // Matches the "/" hint shown next to the search box.
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || dialogEl.open) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      searchInput.focus();
    });
  } else {
    tableEl.addEventListener('click', (e) => {
      const th = e.target.closest('th[data-col-idx]');
      if (th) {
        const idx = parseInt(th.dataset.colIdx, 10);
        if (sortColIdx === idx) sortDir *= -1; else { sortColIdx = idx; sortDir = 1; }
        applyViewAndRender();
        return;
      }
      const delBtn = e.target.closest('button[data-del]');
      if (delBtn) { handleDelete(parseInt(delBtn.dataset.del, 10)); return; }
      const editBtn = e.target.closest('button[data-edit]');
      if (editBtn) { handleEdit(parseInt(editBtn.dataset.edit, 10)); return; }

      if (!inlineEdit) return;
      const td = e.target.closest('td[data-col-idx]');
      if (!td || inlineEditing) return; // ignore stray clicks while a cell is already mid-edit
      const idx = parseInt(td.dataset.colIdx, 10);
      const rowNumber = parseInt(td.closest('tr').dataset.row, 10);
      const field = fieldForHeaderIndex(idx);
      if (opensDetail(field, idx)) { handleEdit(rowNumber); return; }
      if (isInlineEditable(field)) beginInlineEdit(td, rowNumber, idx, field);
    });

    colsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      colsMenu.style.display = colsMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
      if (colsMenu.style.display !== 'none' && !colsMenu.contains(e.target) && e.target !== colsBtn) {
        colsMenu.style.display = 'none';
      }
    });
    colsMenu.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type=checkbox]');
      if (!cb) return;
      const col = cb.dataset.col;
      if (cb.checked) hiddenCols.delete(col); else hiddenCols.add(col);
      localStorage.setItem(hiddenColsKey, JSON.stringify([...hiddenCols]));
      applyViewAndRender();
    });
  }

  searchInput.addEventListener('input', () => {
    searchTerm = searchNorm(searchInput.value.trim());
    applyViewAndRender();
  });

  renderForm();
  // Any field backed by a big list gets a searchable trigger instead of a
  // plain <select> — every ref field (dynamic, so its eventual size isn't
  // known upfront) plus any static 'select' with more than a handful of
  // options. Built once, since the underlying <select> element persists for
  // the life of the dialog — ref-option reloads just rewrite its <option>s
  // in place (see js/searchable-select.js's MutationObserver).
  fields.forEach(f => {
    if (f.type === 'ref' || (f.type === 'select' && f.options.length > 3)) {
      const el = form.querySelector(`#${fid(f)}`);
      if (el) enhanceSelect(el);
    }
  });
  const guard = attachDiscardGuard(dialogEl, { scope: form });

  // Catalogue mode's dialog header carries a photo + kicker + dynamic
  // subline instead of the generic static `subtitle` — updated per-open
  // since it reflects whichever row (or none, in Add mode) is showing.
  function updateCatalogueDialogHeader(rowValues) {
    if (!catalogue) return;
    const pick = rowValues ? (key) => get(rowValues, key) : () => '';
    const photoEl = root.querySelector(`#${tab}_dlgPhoto`);
    const kickerEl = root.querySelector(`#${tab}_dlgKicker`);
    const subEl = root.querySelector(`#${tab}_dlgSub`);
    const photoUrl = rowValues && catalogue.photo ? (pick(catalogue.photo) || '').toString().trim() : '';
    if (photoEl) { photoEl.src = photoUrl; photoEl.style.display = photoUrl ? '' : 'none'; }
    if (kickerEl) kickerEl.textContent = rowValues && catalogue.kicker ? catalogue.kicker(pick) : '';
    if (subEl) subEl.textContent = rowValues && catalogue.detailSub ? catalogue.detailSub(pick) : '';
  }

  async function openAddDialog() {
    editing = null;
    root.querySelector(`#${tab}_dlgTitle`).textContent = `Add ${singular}`;
    root.querySelector(`#${tab}_submitBtn`).textContent = `Add ${singular}`;
    if (catalogue) {
      updateCatalogueDialogHeader(null);
      const removeBtn = root.querySelector(`#${tab}_dlgRemove`);
      if (removeBtn) removeBtn.style.display = 'none';
    }
    setDlgStatus('');
    resetFieldValues();
    const extraEl = root.querySelector(`#${tab}_dlgExtra`);
    if (extraEl) {
      extraEl.innerHTML = '';
      form.querySelector('[data-dlg-tab="__extra"]').hidden = true;
      // A record with only the extra tab plus plain fields doesn't need a tab bar to add one.
      form.querySelector('.dlg-tabs').hidden = form.querySelectorAll('.dlg-tabs .cat-tab:not([hidden])').length < 2;
      showDlgTab();
    }
    await refreshRefOptions();
    dialogEl.showModal();
    guard.arm();
  }

  async function handleEdit(rowNumber) {
    const row = rowsData[rowNumber - 2];
    if (!row) return;
    const rowValues = row.values;
    editing = { rowNumber, id: rowValues[0] };
    root.querySelector(`#${tab}_dlgTitle`).textContent = recordTitle(rowValues) || `Edit ${singular}`;
    root.querySelector(`#${tab}_submitBtn`).textContent = 'Save changes';
    if (catalogue) {
      updateCatalogueDialogHeader(rowValues);
      const removeBtn = root.querySelector(`#${tab}_dlgRemove`);
      if (removeBtn) removeBtn.style.display = '';
    }
    setDlgStatus('');
    resetFieldValues();
    await refreshRefOptions();
    populateFieldsFromRow(rowValues);
    // The natural key (e.g. Products.CODE) can't be changed once other tabs
    // may already reference it by that value.
    if (!autoId) form.querySelector(`#${fid(fields[0])}`).disabled = true;
    const extraEl = root.querySelector(`#${tab}_dlgExtra`);
    if (extraEl) {
      form.querySelector('[data-dlg-tab="__extra"]').hidden = false;
      form.querySelector('.dlg-tabs').hidden = false;
      showDlgTab(detailSection.first ? '__extra' : undefined);
      detailSection.render(extraEl, (key) => get(rowValues, key), rowValues);
    }
    dialogEl.showModal();
    guard.arm();
  }

  if (!catalogue) root.querySelector(`#${tab}_addBtn`).addEventListener('click', openAddDialog);
  // Both the header's close button and the footer's Cancel button carry
  // data-cancel — wire every match, not just the first.
  form.querySelectorAll('[data-cancel]').forEach(el => el.addEventListener('click', () => guard.guardedClose()));
  if (catalogue) {
    // Catalogue rows carry no per-row action buttons — the detail dialog
    // is the only place a record gets removed.
    const removeBtn = form.querySelector('[data-remove]');
    if (removeBtn) removeBtn.addEventListener('click', async () => {
      if (!editing) return;
      const rowNumber = editing.rowNumber;
      dialogEl.close(); // programmatic close — bypasses the discard guard, same as a successful save
      await handleDelete(rowNumber);
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cfg = await ensureAuth(setDlgStatus);
    if (!cfg) return;

    for (const f of fields) {
      if (f.required && !fieldValue(f)) { setDlgStatus(`${f.label} is required.`, 'error'); return; }
    }

    const isEdit = !!editing;
    setDlgStatus(isEdit ? 'Saving...' : 'Adding...');
    try {
      const values = fields.map(fieldValue);
      if (isEdit) {
        const row = autoId ? [editing.id, ...values] : values;
        await sheetsUpdateRange(cfg.spreadsheetId, `${tab}!A${editing.rowNumber}:${endCol}${editing.rowNumber}`, [row], token, 'USER_ENTERED');
        setStatus(`${singular} updated.`, 'ok');
      } else {
        let row = values;
        if (autoId) {
          const existing = await sheetsGet(cfg.spreadsheetId, range, token);
          const id = nextId(existing.length ? existing : [headers], autoId);
          row = [id, ...values];
        }
        await sheetsAppend(cfg.spreadsheetId, range, row, token);
        setStatus(`${singular} added.`, 'ok');
      }
      dialogEl.close(); // programmatic close — the discard guard only ever intercepts 'cancel'/backdrop, never this
      loadRows();
    } catch (err) {
      setDlgStatus('Error: ' + err.message, 'error');
    }
  });

  if (!catalogue) root.querySelector(`#${tab}_reload`).addEventListener('click', loadRows);

  loadRows();

  // Catalogue-mode pages own their "+ Add" / bulk-action buttons as page
  // chrome (see products.html) rather than the generic toolbar above, so
  // they need a way to trigger the same dialog/reload this closure owns.
  // rerender() redraws the stats and rows from what's already loaded — for
  // data a page fetches separately, like the Products cards' stock figures.
  return {
    openAdd: openAddDialog,
    reload: loadRows,
    rerender: () => { if (catalogue) renderCatalogueToolbar(); applyViewAndRender(); }
  };
}
