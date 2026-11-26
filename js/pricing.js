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
// piece, by the SKU's Pricing basis), before any discount:
//   1. a Prices row for this product and the customer's price list;
//   2. the invoice SKU's `List price £`;
//   3. the calculated list price, landed cost ÷ (1 − GP at list).
// There are no per-customer prices: a customer's own deal is their
// basket-wide Discount (%) (see orderDiscount()). Prices' CUSTOMER column is
// retired and ignored.
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
// Lot discounts (lotDiscount()): the LotDiscounts tab puts a % off one lot
// of one product (for cut cheese, the wheel's code and lot). It covers
// orders delivered from the day it was made until it's ended, and STACKS on
// top of the order discount: the lot's lines first get the lot %, then the
// order / customer % (20% then 10% = 28% off; Xero gets that combined %).
// The order-discount threshold is measured after lot discounts.
//
// Pages call registerPricing({ products, groups, prices, discountRules,
// lotDiscounts }) after loading those tabs (loadPrices() / loadDiscountRules()
// / loadLotDiscounts() read them, or [] before Setup has made them).

const PRICE_LISTS = ['Standard', 'P2P', 'Selfridges'];
const DEFAULT_PRICE_LIST = 'Standard';

let priceBook = { byCode: {}, groupById: {}, rulesByGroup: {}, discountRules: [], lotDiscounts: {}, discountedCodes: new Set() };

function registerPricing({ products = [], groups = [], prices = [], discountRules = [], lotDiscounts = [] }) {
  const byCode = {}, groupById = {}, rulesByGroup = {};
  products.forEach(p => { if (p['Product code']) byCode[p['Product code']] = p; });
  groups.forEach(g => { if (g.ID) groupById[g.ID] = g; });
  prices.forEach(r => {
    const group = (r['GROUP ID'] || '').toString().trim();
    const price = parseFloat(r['PRICE £']);
    if (!group || !(price > 0)) return;
    if ((r.CUSTOMER || '').toString().trim()) return; // an old per-customer price: retired, ignored
    (rulesByGroup[group] = rulesByGroup[group] || []).push({
      id: r.ID || '',
      list: (r['PRICE LIST'] || '').toString().trim(),
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
  const lots = {};
  lotDiscounts.forEach(r => {
    const pct = parseFloat(r['DISCOUNT %']) || 0;
    const code = (r['PRODUCT CODE'] || '').toString().trim(), lot = (r['BATCH/LOT NUMBER'] || '').toString().trim();
    if (!code || !lot || !(pct > 0)) return;
    (lots[lotDiscountKey(code, lot)] = lots[lotDiscountKey(code, lot)] || []).push({
      id: r.ID || '', pct, reason: r.REASON || '',
      // Stamps go in as "YYYY-MM-DD HH:MM" but Sheets may show them as
      // "26/11/2026 11:20:00": priceDate() reads either day.
      from: priceDate((r['CREATED AT'] || '').toString().trim().split(/[ T]/)[0]),
      to: priceDate((r['ENDED AT'] || '').toString().trim().split(/[ T]/)[0])
    });
  });
  const discountedCodes = new Set(lotDiscounts.map(r => (r['PRODUCT CODE'] || '').toString().trim()).filter(Boolean));
  priceBook = { byCode, groupById, rulesByGroup, discountRules: rules, lotDiscounts: lots, discountedCodes };
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

// The LotDiscounts tab as [{ rowNumber, obj }], or [] before Setup made it.
async function loadLotDiscountRows(spreadsheetId) {
  try {
    const [head = [], ...rows] = await sheetsGet(spreadsheetId, 'LotDiscounts!A:Z');
    return rows.map((r, i) => ({ rowNumber: i + 2, obj: Object.fromEntries(head.map((h, c) => [h, r[c] ?? ''])) }));
  } catch (err) {
    return [];
  }
}
async function loadLotDiscounts(spreadsheetId) {
  return (await loadLotDiscountRows(spreadsheetId)).map(r => r.obj);
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

// { price, source, rule } — source is 'list' | 'list price' | 'calculated' |
// '' (no price at all). `date` is the delivery date, ISO.
function unitPrice(p, customer, date) {
  if (!p) return { price: 0, source: '', rule: null };
  const sku = invoiceSku(p);
  const day = priceDate(date);
  const live = (priceBook.rulesByGroup[invoiceGroupId(p)] || [])
    .filter(r => (!day || !r.from || r.from <= day) && (!day || !r.to || day <= r.to))
    .sort((a, b) => (b.from || '').localeCompare(a.from || ''));
  const list = customerPriceList(customer);
  const onList = live.find(r => (r.list || DEFAULT_PRICE_LIST) === list);
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

const lotDiscountKey = (code, lot) => `${code}\u0001${(lot || '').toString().trim().toUpperCase()}`;

// The discount on this lot for an order delivered on `date` (ISO; blank =
// today): { pct, reason, id } or null. Made on or before that day and not
// ended by it. `code` is the stock code — for a cut portion, its wheel's.
function lotDiscount(code, lot, date) {
  if (!code || !lot) return null;
  const day = priceDate(date) || new Date().toISOString().slice(0, 10);
  const live = (priceBook.lotDiscounts[lotDiscountKey(code, lot)] || [])
    .filter(r => (!r.from || r.from <= day) && (!r.to || day < r.to))
    .sort((a, b) => b.from.localeCompare(a.from))[0];
  return live ? { pct: live.pct, reason: live.reason, id: live.id } : null;
}

// Whether any lot of this stock code has ever had a discount — a cheap
// check before working out which lots are free.
const hasLotDiscounts = code => priceBook.discountedCodes.has(code);

// One Xero-style discount from a lot % then an order %: 20 then 10 → 28.
function stackDiscounts(lotPct, orderPct) {
  return Math.round((1 - (1 - (lotPct || 0) / 100) * (1 - (orderPct || 0) / 100)) * 10000) / 100;
}

function lotOffTag(d) {
  return d ? `<span class="lot-off" title="${escapeHtml(['Lot discount', d.reason].filter(Boolean).join(' · '))}">−${d.pct}%</span>` : '';
}
