// Weekly sales invoices as a Xero import CSV (Sales → Invoices → Import).
//
// Format, per Xero Central's "Import customer invoices":
// - the header row is Xero's template, column for column — Xero matches on
//   the headings, so none may be renamed or dropped;
// - one row per invoice line; rows sharing an InvoiceNumber are one invoice;
// - dates DD/MM/YYYY; Discount is a percentage without the % sign;
// - AccountCode and TaxType must match Xero exactly (TaxType is the tax
//   rate's display name, e.g. "Zero Rated Income");
// - an unknown InventoryItemCode creates a new inventory item, so only a
//   product's own `Xero item code` is ever sent;
// - an InvoiceNumber already in Xero is skipped, so the order ID is used as
//   the invoice number and exporting the same week twice is harmless;
// - invoices land as drafts. UnitAmount here is ex VAT: pick "Tax exclusive"
//   when Xero asks at import.
//
// An order line that went out from several lots becomes one invoice line per
// lot, each ending with its lot and best-before (as on the delivery note):
// weighed pieces by the wheel lot each was cut from (Cuts), everything else
// by its Allocations, dated from Deliveries. Anything no lot covers yet
// (stock still on a purchase order) is one more line with no lot.
//
// An order can only be invoiced once every piece that is weighed at the bench
// (cut portions, and wholes sold by the piece but priced per kg — see
// weighSource() in js/cuts.js) has been weighed: those lines bill the actual
// kilos from Cuts, not the nominal weight.

const XERO_INVOICE_HEADERS = [
  '*ContactName', 'EmailAddress', 'POAddressLine1', 'POAddressLine2', 'POAddressLine3', 'POAddressLine4',
  'POCity', 'PORegion', 'POPostalCode', 'POCountry', '*InvoiceNumber', 'Reference', '*InvoiceDate', '*DueDate',
  'InventoryItemCode', '*Description', '*Quantity', '*UnitAmount', 'Discount', '*AccountCode', '*TaxType',
  'TrackingName1', 'TrackingOption1', 'TrackingName2', 'TrackingOption2', 'Currency', 'BrandingTheme'
];

// Xero UK's default tax rate names, keyed by how the sheet might spell them.
const XERO_TAX_TYPES = {
  'zero rated income': 'Zero Rated Income',
  'zero rated': 'Zero Rated Income',
  'zero': 'Zero Rated Income',
  '0%': 'Zero Rated Income',
  '20% (vat on income)': '20% (VAT on Income)',
  '20%': '20% (VAT on Income)',
  'standard': '20% (VAT on Income)',
  '5% (vat on income)': '5% (VAT on Income)',
  '5%': '5% (VAT on Income)',
  'reduced': '5% (VAT on Income)',
  'exempt income': 'Exempt Income',
  'exempt': 'Exempt Income',
  'no vat': 'No VAT'
};
function xeroTaxType(vat) {
  const v = (vat || '').toString().trim();
  return XERO_TAX_TYPES[v.toLowerCase()] || v;
}

const xeroNum = v => parseFloat(v) || 0;
const xeroRound = (n, dp) => Math.round(n * 10 ** dp) / 10 ** dp;

// Price per pricing unit (per kg or per piece). The printed `List price £`
// when there is one, else the calculated list price Orders and Reports use:
// landed cost ÷ (1 − GP at list).
function xeroUnitPrice(p) {
  const printed = parseFloat(p['List price £']);
  if (printed > 0) return printed;
  const landed = xeroNum(p['Landed cost £']) || xeroNum(p['Cost price £']);
  const gp = parseFloat(p['GP at list']);
  return landed ? landed / (1 - (isNaN(gp) ? 30 : gp) / 100) : 0;
}

function xeroDate(iso) {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}
function addDaysIso(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Whether `order` can be invoiced, plus the invoice lines it would produce.
// Returns { order, ready, blockers: [string], warnings: [string], lines, total }.
// `ctx` is { lines, productByCode, customerByName, cutsOfLine, allocations,
// deliveryByKey } — allocations as row objects, deliveryByKey keyed
// "<product code> <lot>".
function xeroInvoiceFor(order, ctx) {
  const blockers = [], warnings = [], lines = [];
  const orderLines = ctx.lines.filter(l => l['ORDER ID'] === order.ID);
  const customer = ctx.customerByName[order.CUSTOMER];
  const discount = xeroNum(customer?.['Discount (%)']);

  if (!orderLines.length) blockers.push('No lines');
  if (!order['DELIVERY DATE']) blockers.push('No delivery date');
  if (!customer) warnings.push(`"${order.CUSTOMER}" isn't on the Customers tab — check the name matches the Xero contact`);

  orderLines.forEach(l => {
    const p = ctx.productByCode[l['PRODUCT CODE']];
    if (!p) { blockers.push(`Unknown product ${l['PRODUCT CODE']}`); return; }
    const name = p['Product name'] || l['PRODUCT CODE'];
    const ordered = xeroNum(l['QTY ORDERED']);
    if (ordered <= 0) return;

    const src = weighSource(l, ctx.productByCode);
    const cuts = ctx.cutsOfLine[l.ID] || [];
    const pcs = n => `${n} pc${n === 1 ? '' : 's'}`;
    // One invoice line per lot: [{ qty, lot, wheel, note }].
    let parts;
    if (src) {
      const pieces = linePieces(l, src).count;
      if (cuts.length < pieces) {
        blockers.push(`${name}: ${cuts.length} of ${pieces} piece${pieces === 1 ? '' : 's'} weighed`);
        return;
      }
      // Each weighed piece records the wheel lot it came off.
      const byLot = new Map();
      cuts.forEach(c => {
        const lot = c.obj['BATCH/LOT NUMBER'] || '';
        if (!byLot.has(lot)) byLot.set(lot, []);
        byLot.get(lot).push(c);
      });
      parts = [...byLot].map(([lot, cs]) => ({
        qty: sumCutWeight(cs), lot, wheel: cs[0].obj['WHEEL CODE'] || src.code,
        note: `${pcs(cs.length)}: ${cs.map(c => `${cutWeight(c).toFixed(3)}kg`).join(' + ')}`
      }));
    } else {
      // Priced per kg, ordered by the piece, never weighed: bill nominal
      // kilos, which is also what its allocations hold.
      const kg = p['Pricing basis'] === 'Per kg' && l.UNIT !== 'kg' ? xeroNum(p['Nominal weight (kg)']) : 0;
      if (p['Pricing basis'] === 'Per kg' && l.UNIT !== 'kg' && !kg) warnings.push(`${name}: priced per kg but has no nominal weight — billed as ${ordered} pieces`);
      const note = q => { const n = kg ? q / kg : 0; return kg && Math.abs(n - Math.round(n)) < 0.001 ? pcs(Math.round(n)) : ''; };
      let left = kg ? ordered * kg : ordered;
      parts = [];
      (ctx.allocations || []).filter(a => a['ORDER LINE ID'] === l.ID && !a['PO LINE ID'] && a['BATCH/LOT NUMBER']).forEach(a => {
        const take = xeroRound(Math.min(left, xeroNum(a['QTY ALLOCATED'])), 3);
        if (take <= 0) return;
        const same = parts.find(x => x.lot === a['BATCH/LOT NUMBER'] && x.wheel === a['PRODUCT CODE']);
        if (same) same.qty = xeroRound(same.qty + take, 3);
        else parts.push({ qty: take, lot: a['BATCH/LOT NUMBER'], wheel: a['PRODUCT CODE'] });
        left = xeroRound(left - take, 3);
      });
      // Whatever no lot covers (still on a purchase order, or short).
      if (left > 0.0001) parts.push({ qty: left, lot: '' });
      parts.forEach(x => { x.note = note(x.qty); });
    }

    const price = xeroUnitPrice(p);
    if (!price) warnings.push(`${name}: no price — fill it in on the draft in Xero`);
    if (!p['Xero account code']) warnings.push(`${name}: no Xero account code`);
    if (!p['VAT rate']) warnings.push(`${name}: no VAT rate`);
    const replaces = l.REPLACES ? ` (replaces ${ctx.productByCode[l.REPLACES]?.['Product name'] || l.REPLACES})` : '';
    parts.forEach(x => {
      const bbe = x.lot ? xeroDate((ctx.deliveryByKey || {})[`${x.wheel} ${x.lot}`]?.['BEST BEFORE DATE']) : '';
      const lotText = x.lot ? `Lot ${x.lot}${bbe ? ` (BB ${bbe})` : ''}` : '';
      lines.push({
        itemCode: p['Xero item code'] || '',
        description: [name + replaces, x.note, lotText].filter(Boolean).join(' · '),
        qty: xeroRound(x.qty, 3),
        price: xeroRound(price, 2),
        discount,
        account: p['Xero account code'] || '',
        tax: xeroTaxType(p['VAT rate'])
      });
    });
  });

  const total = xeroRound(lines.reduce((s, x) => s + x.qty * x.price, 0) * (1 - discount / 100), 2);
  return { order, customer, ready: !blockers.length && lines.length > 0, blockers, warnings, lines, total };
}

// The CSV rows (header first) for invoices from xeroInvoiceFor().
function xeroCsvRows(invoices) {
  const rows = [XERO_INVOICE_HEADERS];
  invoices.forEach(inv => {
    const date = inv.order['DELIVERY DATE'];
    const terms = parseInt(inv.customer?.['Payment terms (days)'], 10);
    // No terms on file → leave DueDate blank and Xero applies its own default.
    const due = isNaN(terms) ? '' : xeroDate(addDaysIso(date, terms));
    inv.lines.forEach(x => {
      const r = Object.fromEntries(XERO_INVOICE_HEADERS.map(h => [h, '']));
      r['*ContactName'] = inv.order.CUSTOMER;
      r['*InvoiceNumber'] = inv.order.ID;
      r.Reference = inv.order.ID;
      r['*InvoiceDate'] = xeroDate(date);
      r['*DueDate'] = due;
      r.InventoryItemCode = x.itemCode;
      r['*Description'] = x.description;
      r['*Quantity'] = x.qty;
      r['*UnitAmount'] = x.price.toFixed(2);
      r.Discount = x.discount ? x.discount : '';
      r['*AccountCode'] = x.account;
      r['*TaxType'] = x.tax;
      rows.push(XERO_INVOICE_HEADERS.map(h => r[h]));
    });
  });
  return rows;
}

function downloadXeroCsv(invoices, filename) {
  const cell = v => /[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const csv = xeroCsvRows(invoices).map(r => r.map(cell).join(',')).join('\r\n');
  // BOM so accents (Comté, Délice) survive — the same as Excel's "CSV UTF-8".
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
