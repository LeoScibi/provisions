// Which suppliers sell which products. One row per supplier + product on the
// SupplierProducts tab, so a product can come from several suppliers, each
// with its own product code and cost. A product's "Default supplier" (on
// Products) always counts as one of its suppliers, with or without a row
// here — so nothing needs migrating and the default never has to be linked
// twice. Used by suppliers.html (a supplier's product list) and
// purchase-orders.html (which products a PO can include).

const SP_TAB = 'SupplierProducts';
const SP_HEADERS = ['ID', 'SUPPLIER', 'PRODUCT CODE', 'SUPPLIER PRODUCT CODE', 'COST PRICE £', 'NOTES', 'UPDATED'];
const SP_RANGE = `${SP_TAB}!A:G`;

// Returns [{ rowNumber, obj }] for every link. A sheet that hasn't been
// through Setup yet has no SupplierProducts tab — treat that as no links
// rather than failing the whole page.
async function loadSupplierProducts(spreadsheetId) {
  let rows;
  try {
    rows = await sheetsGet(spreadsheetId, SP_RANGE);
  } catch (err) {
    if (/Unable to parse range/i.test(err.message)) return [];
    throw err;
  }
  return rows.slice(1).map((r, i) => ({
    rowNumber: i + 2,
    obj: Object.fromEntries(SP_HEADERS.map((h, j) => [h, r[j] ?? '']))
  })).filter(l => l.obj.SUPPLIER && l.obj['PRODUCT CODE']);
}

// Every product `supplier` sells: [{ product, link, isDefault }], where link
// is its SupplierProducts entry ({ rowNumber, obj }) or null when the product
// only counts through its Default supplier. Sorted by product name.
function productsForSupplier(products, links, supplier) {
  const out = new Map();
  products.forEach(p => {
    if (p['Default supplier'] === supplier) out.set(p['Product code'], { product: p, link: null, isDefault: true });
  });
  links.forEach(l => {
    if (l.obj.SUPPLIER !== supplier) return;
    const code = l.obj['PRODUCT CODE'];
    const product = products.find(p => p['Product code'] === code);
    if (!product) return;
    const entry = out.get(code) || { product, link: null, isDefault: false };
    entry.link = l;
    out.set(code, entry);
  });
  return [...out.values()].sort((a, b) => (a.product['Product name'] || '').localeCompare(b.product['Product name'] || ''));
}

// Deletes one link by ID. Re-reads the tab first so the row index is current
// even if someone else added or removed links since this page loaded.
async function deleteSupplierProduct(spreadsheetId, id) {
  const fresh = await loadSupplierProducts(spreadsheetId);
  const row = fresh.find(l => l.obj.ID === id);
  if (!row) return;
  const tabs = await sheetsGetTabs(spreadsheetId);
  const sheet = tabs.find(t => t.title === SP_TAB);
  if (!sheet) throw new Error(`Tab "${SP_TAB}" not found — run Setup first.`);
  await sheetsBatchUpdate(spreadsheetId, [{
    deleteDimension: { range: { sheetId: sheet.sheetId, dimension: 'ROWS', startIndex: row.rowNumber - 1, endIndex: row.rowNumber } }
  }]);
}
