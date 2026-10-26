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
