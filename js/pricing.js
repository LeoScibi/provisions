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
// Order discounts (orderDiscount()): the DiscountRules tab holds "spend
// £X, get Y% off" rules (e.g. £1,000 → 5%), each optionally limited to some
// price lists and dates. An order's discount is the HIGHER of the customer's
// own Discount (%) and the best rule its subtotal reaches — never both. The
// subtotal is ex VAT, at unitPrice(), before any discount. It's recalculated
// on what's actually invoiced, so a cut weighing light can lose it.
//
// Pages call registerPricing({ products, groups, prices, discountRules })
// after loading those tabs (loadPrices() / loadDiscountRules() read them, or
// [] before Setup has made them).

const PRICE_LISTS = ['Standard', 'P2P', 'Selfridges'];
const DEFAULT_PRICE_LIST = 'Standard';

let priceBook = { byCode: {}, groupById: {}, rulesByGroup: {}, discountRules: [] };

function registerPricing({ products = [], groups = [], prices = [], discountRules = [] }) {
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
  const rules = discountRules.map(r => ({
    id: r.ID || '',
    threshold: parseFloat(r['THRESHOLD £']) || 0,
    pct: parseFloat(r['DISCOUNT %']) || 0,
    lists: (r['PRICE LISTS'] || '').toString().split(',').map(x => x.trim()).filter(Boolean),
    from: priceDate(r['VALID FROM']),
    to: priceDate(r['VALID TO'])
  })).filter(r => r.threshold > 0 && r.pct > 0);
  priceBook = { byCode, groupById, rulesByGroup, discountRules: rules };
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

async function loadDiscountRules(spreadsheetId) {
  try {
    const [head = [], ...rows] = await sheetsGet(spreadsheetId, 'DiscountRules!A:Z');
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

// The discount an order gets: { pct, source, customerPct, rule, next }.
// `subtotal` is ex VAT at unitPrice(), before discounts; `date` the delivery
// date. source is 'customer' | 'order' | '' (none). `next` is the nearest rule
// still out of reach that would raise the discount — { threshold, pct, gap }
// — for the "spend £X more" bar; null when there's none.
function orderDiscount(customer, date, subtotal) {
  const customerPct = parseFloat(customer?.['Discount (%)']) || 0;
  const list = customerPriceList(customer);
  const day = priceDate(date);
  const live = priceBook.discountRules
    .filter(r => (!r.lists.length || r.lists.includes(list)) && (!day || !r.from || r.from <= day) && (!day || !r.to || day <= r.to));
  const reached = live.filter(r => subtotal + 0.005 >= r.threshold).sort((a, b) => b.pct - a.pct)[0] || null;
  const rulePct = reached ? reached.pct : 0;
  const pct = Math.max(customerPct, rulePct);
  const source = !pct ? '' : rulePct > customerPct ? 'order' : 'customer';
  const ahead = live.filter(r => r.threshold > subtotal + 0.005 && r.pct > pct).sort((a, b) => a.threshold - b.threshold)[0];
  const next = ahead ? { threshold: ahead.threshold, pct: ahead.pct, gap: ahead.threshold - subtotal } : null;
  return { pct, source, customerPct, rule: source === 'order' ? reached : null, next };
}
