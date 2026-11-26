// Selling prices and invoice codes, shared by Orders (the live order total),
// Reports and the Xero export — the one place a line's price is worked out.
//
// One invoice SKU per product. Xero has a single item per cheese, invoiced by
// weight, whatever it was cut into, so:
//   - invoiceSku(p): the SKU a line is invoiced as. A portion "Cut from" a
//     whole bills as that whole (followed up to three levels);
//   - invoiceItemCode(p): the product's (ProductGroups) `Xero item code`, else
//     the invoice SKU's own `Xero item code`.
// Channels (wholesale, the shops, Selfridges) differ only by price list, not
// by SKU: Customers.`Price list` says which list a customer buys from.
//
// unitPrice(p, customer, date) is the price per pricing unit (per kg or per
// piece, by the SKU's Pricing basis), before the customer's Discount (%):
//   1. a Prices row for this product and this customer;
//   2. a Prices row for this product and the customer's price list (no
//      customer on it);
//   3. the invoice SKU's `List price £`;
//   4. the calculated list price, landed cost ÷ (1 − GP at list).
// A Prices row only counts on dates between its VALID FROM and VALID TO
// (either may be blank); when several match, the latest VALID FROM wins.
// Prices rows are by product (ProductGroups ID), so one row prices a wheel and
// every portion cut from it.
//
// Pages call registerPricing({ products, groups, prices }) after loading
// those tabs (loadPrices() reads Prices, or [] before Setup has made it).

const PRICE_LISTS = ['Standard', 'P2P', 'Selfridges'];
const DEFAULT_PRICE_LIST = 'Standard';

let priceBook = { byCode: {}, groupById: {}, rulesByGroup: {} };

function registerPricing({ products = [], groups = [], prices = [] }) {
  const byCode = {}, groupById = {}, rulesByGroup = {};
  products.forEach(p => { if (p['Product code']) byCode[p['Product code']] = p; });
  groups.forEach(g => { if (g.ID) groupById[g.ID] = g; });
  prices.forEach(r => {
    const group = (r['GROUP ID'] || '').toString().trim();
    const price = parseFloat(r['PRICE £']);
    if (!group || !(price > 0)) return;
    (rulesByGroup[group] = rulesByGroup[group] || []).push({
      id: r.ID || '',
      list: (r['PRICE LIST'] || '').toString().trim(),
      customer: (r.CUSTOMER || '').toString().trim(),
      price,
      from: priceDate(r['VALID FROM']),
      to: priceDate(r['VALID TO'])
    });
  });
  priceBook = { byCode, groupById, rulesByGroup };
}

// The Prices tab as header-keyed objects, or [] if Setup hasn't made it yet.
async function loadPrices(spreadsheetId) {
  try {
    const [head = [], ...rows] = await sheetsGet(spreadsheetId, 'Prices!A:Z');
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  } catch (err) {
    return [];
  }
}

// "YYYY-MM-DD" from an ISO or DD/MM/YYYY cell; '' for blank or unreadable.
function priceDate(v) {
  const s = (v || '').toString().trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

function customerPriceList(customer) {
  return (customer?.['Price list'] || '').toString().trim() || DEFAULT_PRICE_LIST;
}

function invoiceSku(p) {
  let sku = p;
  for (let i = 0; i < 3 && sku && sku['Cut from (code)']; i++) {
    const parent = priceBook.byCode[sku['Cut from (code)']];
    if (!parent) break;
    sku = parent;
  }
  return sku || p;
}

function invoiceGroupId(p) {
  if (!p) return '';
  return invoiceSku(p)['Group ID'] || p['Group ID'] || '';
}

function invoiceItemCode(p) {
  if (!p) return '';
  const group = priceBook.groupById[invoiceGroupId(p)];
  const fromGroup = (group?.['Xero item code'] || '').toString().trim();
  return fromGroup || (invoiceSku(p)['Xero item code'] || '').toString().trim() || (p['Xero item code'] || '').toString().trim();
}

// The calculated list price of one SKU: its printed List price £, else
// landed cost ÷ (1 − GP at list), GP 30% when blank.
function skuListPrice(p) {
  if (!p) return 0;
  const printed = parseFloat(p['List price £']);
  if (printed > 0) return printed;
  const landed = parseFloat(p['Landed cost £']) || parseFloat(p['Cost price £']) || 0;
  const gp = parseFloat(p['GP at list']);
  return landed ? landed / (1 - (isNaN(gp) ? 30 : gp) / 100) : 0;
}

// { price, source, rule } — source is 'customer' | 'list' | 'list price' |
// 'calculated' | '' (no price at all). `date` is the delivery date, ISO.
function unitPrice(p, customer, date) {
  if (!p) return { price: 0, source: '', rule: null };
  const sku = invoiceSku(p);
  const day = priceDate(date);
  const live = (priceBook.rulesByGroup[invoiceGroupId(p)] || [])
    .filter(r => (!day || !r.from || r.from <= day) && (!day || !r.to || day <= r.to))
    .sort((a, b) => (b.from || '').localeCompare(a.from || ''));
  const name = (customer?.['Customer name (as in Xero)'] || '').toString().trim();
  const mine = name && live.find(r => r.customer === name);
  if (mine) return { price: mine.price, source: 'customer', rule: mine };
  const list = customerPriceList(customer);
  const onList = live.find(r => !r.customer && (r.list || DEFAULT_PRICE_LIST) === list);
  if (onList) return { price: onList.price, source: 'list', rule: onList };
  const own = skuListPrice(sku) || skuListPrice(p);
  const printed = parseFloat(sku['List price £']) > 0 || parseFloat(p['List price £']) > 0;
  return { price: own, source: own ? (printed ? 'list price' : 'calculated') : '', rule: null };
}

// What `qty` in `unit` of product `p` comes to at `price` per pricing unit:
// per-kg products ordered by the piece count at their nominal weight.
function billableQty(p, qty, unit) {
  if (!p) return 0;
  if (p['Pricing basis'] === 'Per kg' && unit !== 'kg') return qty * (parseFloat(p['Nominal weight (kg)']) || 0);
  return qty;
}
