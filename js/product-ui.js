// Shared product thumbnails and the order hover card.
//
// productThumb(prod) / productCell(prod, html) put a product's photo
// (Products."Photo URL", a public Drive thumbnail link — see js/drive.js)
// next to its name wherever a product is listed. A product with no photo,
// or one whose image fails to load, gets a plain grey square so rows still
// line up. The photo comes from the SKU's product first (ProductGroups tab,
// via Products."Group ID" — so one upload covers every SKU of a product),
// then the SKU's own, then the whole it's cut from; pages call
// registerProducts() and registerProductGroups() after loading those tabs.
//
// attachOrderHoverCard(container, selector, build) shows a small card with
// an order's details and line items (with thumbnails) when the mouse rests
// on a matching row. `build(el)` returns
//   { title, id, status, meta: [strings], lines: [{ product, name, qty }] }
// or null to show nothing. Touch screens have no hover, so it's skipped
// there — tapping the row still opens the order as before.

let productByCodeForPhoto = {};
let groupPhotoById = {};

function registerProducts(products) {
  productByCodeForPhoto = {};
  products.forEach(p => { productByCodeForPhoto[p['Product code']] = p; });
}

function registerProductGroups(groups) {
  groupPhotoById = {};
  groups.forEach(g => {
    const url = (g['Photo URL'] || '').toString().trim();
    if (url) groupPhotoById[g.ID] = url;
  });
}

function productPhoto(prod, depth = 0) {
  if (!prod) return '';
  const own = groupPhotoById[prod['Group ID']] || (prod['Photo URL'] || '').toString().trim();
  if (own || depth > 2) return own;
  return productPhoto(productByCodeForPhoto[prod['Cut from (code)']], depth + 1);
}

// The ProductGroups tab as header-keyed objects, or [] if it doesn't exist
// yet (Setup not re-run) — photos then just fall back to the SKU's own.
async function loadProductGroups(spreadsheetId) {
  try {
    const [head = [], ...rows] = await sheetsGet(spreadsheetId, 'ProductGroups!A:Z');
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
  } catch (err) {
    return [];
  }
}

function productThumb(prod, size) {
  const url = productPhoto(prod);
  const cls = `pthumb${size ? ' pthumb-' + size : ''}`;
  return url
    ? `<img class="${cls}" src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.removeAttribute('src')">`
    : `<span class="${cls}"></span>`;
}

// `html` is the cell's existing (already escaped) text — name, code, etc.
function productCell(prod, html, size) {
  return `<div class="pcell">${productThumb(prod, size)}<div class="pcell-t">${html}</div></div>`;
}

const HOVER_CARD_MAX_LINES = 6;
let hoverCardEl = null;

function hoverCardHtml(d) {
  const lines = d.lines || [];
  const shown = lines.slice(0, HOVER_CARD_MAX_LINES);
  return `
    <div class="hc-h">
      <div class="hc-title">${escapeHtml(d.title)}</div>
      <div class="hc-sub"><span class="code">${escapeHtml(d.id)}</span>${d.status ? ` <span class="tag t-amb">${escapeHtml(d.status)}</span>` : ''}</div>
    </div>
    ${(d.meta || []).filter(Boolean).map(m => `<div class="hc-meta">${escapeHtml(m)}</div>`).join('')}
    <div class="hc-lines">
      ${shown.length ? shown.map(l => `
        <div class="hc-line">
          ${productThumb(l.product, 'xs')}
          <span class="hc-name">${escapeHtml(l.name)}</span>
          <span class="hc-qty">${escapeHtml(l.qty)}</span>
        </div>`).join('') : '<div class="hc-meta">No items on this order.</div>'}
      ${lines.length > shown.length ? `<div class="hc-more">+ ${lines.length - shown.length} more item(s)</div>` : ''}
    </div>`;
}

function positionHoverCard(x, y) {
  const pad = 14;
  const w = hoverCardEl.offsetWidth, h = hoverCardEl.offsetHeight;
  let left = x + pad, top = y + pad;
  if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - pad);
  if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
  hoverCardEl.style.left = left + 'px';
  hoverCardEl.style.top = top + 'px';
}

function attachOrderHoverCard(container, selector, build) {
  if (!container || !window.matchMedia('(hover: hover)').matches) return;
  if (!hoverCardEl) {
    hoverCardEl = document.createElement('div');
    hoverCardEl.className = 'hover-card';
    hoverCardEl.setAttribute('role', 'tooltip');
    document.body.appendChild(hoverCardEl);
  }
  let current = null, timer = null, lastX = 0, lastY = 0;
  const hide = () => { clearTimeout(timer); current = null; hoverCardEl.classList.remove('show'); };

  container.addEventListener('mouseover', e => {
    const el = e.target.closest(selector);
    if (!el || !container.contains(el) || el === current) return;
    hide();
    current = el;
    lastX = e.clientX; lastY = e.clientY;
    // A short delay so sweeping the mouse down a list doesn't flash a card
    // for every row it crosses.
    timer = setTimeout(() => {
      const d = build(el);
      if (!d || current !== el) return;
      hoverCardEl.innerHTML = hoverCardHtml(d);
      hoverCardEl.classList.add('show');
      positionHoverCard(lastX, lastY);
    }, 300);
  });
  container.addEventListener('mousemove', e => {
    lastX = e.clientX; lastY = e.clientY;
    if (current && hoverCardEl.classList.contains('show')) positionHoverCard(lastX, lastY);
  });
  container.addEventListener('mouseout', e => {
    if (current && !current.contains(e.relatedTarget)) hide();
  });
  container.addEventListener('click', hide);
  window.addEventListener('scroll', hide, { passive: true });
}

// The stock lines under a product in the order and PO pickers, from one
// entry of computeStockPosition() (js/stock-calc.js). A cut portion holds
// no stock of its own, so `fromParent` labels figures borrowed from the
// whole product it's cut from.
const STOCK_INCOMING_SHOWN = 3;

function stockPositionHtml(pos, unit, fromParent) {
  pos = pos || { inStock: 0, allocated: 0, free: 0, incoming: [] };
  const q = n => escapeHtml(qtyUnit(n, unit));
  const day = iso => {
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const when = i => !i.start ? 'date TBC' : (i.end && i.end !== i.start ? `${day(i.start)}–${day(i.end)}` : day(i.start));
  const shown = pos.incoming.slice(0, STOCK_INCOMING_SHOWN);
  return `
    <div class="cr-stock">
      ${fromParent ? `<span class="muted">${escapeHtml(fromParent)}:</span> ` : ''}In stock <b>${q(pos.inStock)}</b> · Allocated <b>${q(pos.allocated)}</b> · Free <b class="${pos.free <= 0 ? 'neg' : ''}">${q(pos.free)}</b>
    </div>
    ${shown.length ? `<div class="cr-stock cr-incoming">Arriving ${shown.map(i =>
      `<b>${escapeHtml(qtyUnit(i.qty, i.unit || unit))}</b> ${escapeHtml(when(i))} <span class="muted">(${escapeHtml(i.poId)})</span>`).join(' · ')}${pos.incoming.length > shown.length ? ` · +${pos.incoming.length - shown.length} more` : ''}</div>` : ''}`;
}
