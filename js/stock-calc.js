// On-hand stock per product, from the Deliveries and Allocations tabs: each
// delivered batch's received qty minus what's been allocated against it,
// counting only batches with something left — the same calc as stock.html's
// "On hand by product". Takes header-keyed row objects for both tabs.
//
// Returns { [productCode]: { onHand, unit, batches, nearestBbe } }, where
// nearestBbe is the earliest best-before among batches still in stock.
function computeStockByProduct(deliveries, allocations) {
  const batches = {};
  const key = (code, batch) => `${code} ${batch}`;
  deliveries.forEach(d => {
    const k = key(d['PRODUCT CODE'], d['BATCH/LOT NUMBER']);
    if (!batches[k]) batches[k] = { code: d['PRODUCT CODE'], unit: d.UNIT || 'kg', bbe: d['BEST BEFORE DATE'] || '', remaining: 0 };
    batches[k].remaining += parseFloat(d['QTY RECEIVED']) || 0;
    // Earliest best-before wins if the same batch number was logged twice.
    if (d['BEST BEFORE DATE'] && (!batches[k].bbe || d['BEST BEFORE DATE'] < batches[k].bbe)) batches[k].bbe = d['BEST BEFORE DATE'];
  });
  allocations.forEach(a => {
    const b = batches[key(a['PRODUCT CODE'], a['BATCH/LOT NUMBER'])];
    if (b) b.remaining -= parseFloat(a['QTY ALLOCATED']) || 0;
  });

  const out = {};
  Object.values(batches).forEach(b => {
    const p = out[b.code] || (out[b.code] = { onHand: 0, unit: b.unit, batches: 0, nearestBbe: null });
    if (b.remaining <= 0.0001) return;
    p.onHand += b.remaining;
    p.batches += 1;
    if (b.bbe && (!p.nearestBbe || b.bbe < p.nearestBbe)) p.nearestBbe = b.bbe;
  });
  return out;
}

// Stock position per product, shown when placing orders and POs:
// - inStock:   physically here — every delivery received, minus allocations
//              on orders that have been Dispatched (those have left);
// - allocated: allocated to orders not dispatched yet (still here, but spoken for);
// - free:      inStock − allocated, i.e. what a new order can still take;
// - incoming:  lines on POs still "Ordered", each with its expected dates,
//              soonest first.
// Takes header-keyed row objects for each tab.
//
// Returns { [productCode]: { inStock, allocated, free, incoming: [{ qty, unit, poId, supplier, start, end }] } }
function computeStockPosition({ deliveries, allocations, orders, orderLines, purchaseOrders, poLines }) {
  const out = {};
  const num = v => parseFloat(v) || 0;
  const get = code => out[code] || (out[code] = { inStock: 0, allocated: 0, free: 0, incoming: [] });

  deliveries.forEach(d => { get(d['PRODUCT CODE']).inStock += num(d['QTY RECEIVED']); });

  const statusByOrder = {};
  orders.forEach(o => { statusByOrder[o.ID] = o.STATUS; });
  const orderByLine = {};
  orderLines.forEach(l => { orderByLine[l.ID] = l['ORDER ID']; });
  allocations.forEach(a => {
    const p = get(a['PRODUCT CODE']);
    const qty = num(a['QTY ALLOCATED']);
    if (statusByOrder[orderByLine[a['ORDER LINE ID']]] === 'Dispatched') p.inStock -= qty;
    else p.allocated += qty;
  });

  // A cancelled PO only flips the PO's own STATUS, so that's what decides
  // whether its lines are still coming (see purchase-orders.html).
  const openPo = {};
  purchaseOrders.forEach(po => { if (!po.STATUS || po.STATUS === 'Ordered') openPo[po.ID] = po; });
  poLines.forEach(l => {
    const po = openPo[l['PO ID']];
    if (!po) return;
    get(l['PRODUCT CODE']).incoming.push({
      qty: num(l['QTY ORDERED']), unit: l.UNIT, poId: po.ID, supplier: po.SUPPLIER,
      start: po['EXPECTED START DATE'] || '', end: po['EXPECTED END DATE'] || ''
    });
  });

  const round = n => Math.round(n * 1000) / 1000;
  Object.values(out).forEach(p => {
    p.inStock = round(p.inStock);
    p.allocated = round(p.allocated);
    p.free = round(p.inStock - p.allocated);
    p.incoming.sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'));
  });
  return out;
}
