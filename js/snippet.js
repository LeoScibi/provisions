// A product's snippet: one card in the wholesale portfolio's design, previewed
// in a dialog and saved as a PNG or printed. Built from ProductGroups' portfolio
// columns plus its Wholesale SKUs. The NEW ribbon is switched on here and kept
// in ProductGroups.New.
//
// A PNG can't use Drive's thumbnail URL (no CORS headers, so the canvas refuses
// to export), so the photo is fetched through the Drive API first. That only
// reaches files this app uploaded (the drive.file scope); for any other photo
// the PNG fails with a message and Print still works.

const SNIPPET_BADGES = [
  ["Cow's milk", 'cow'], ["Goat's milk", 'goat'], ["Sheep's milk", 'sheep'],
  ['Raw milk', 'raw'], ['Pasteurised', 'pasteurised'], ['Thermised', 'thermised'],
  ['Vegetarian rennet', 'vegetarian'], ['Grab & go', 'grab'], ['Meat slicer required', 'slicer']
];
const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

function snippetMoney(n) {
  return '£' + (Number.isInteger(n) ? String(n) : n.toFixed(2));
}

// The printed price, or for a SKU that has none, the same sum Orders and
// Reports use (flagged in the preview, since it may not be the agreed price).
function snippetPrice(p) {
  const listed = parseFloat(p['List price £']);
  if (listed) return { value: listed, calculated: false };
  const landed = parseFloat(p['Landed cost £']) || parseFloat(p['Cost price £']) || 0;
  const gp = parseFloat(p['GP at list']);
  return { value: landed && !isNaN(gp) ? Math.round(landed / (1 - gp / 100) * 100) / 100 : 0, calculated: true };
}

function snippetCardHtml({ pick, skus, photo, ribbon }) {
  const per = p => (p['Pricing basis'] === 'Per kg' ? '/kg' : '/unit');
  const priced = skus.map(p => ({ p, price: snippetPrice(p) }));
  const label = x => x.price.value ? snippetMoney(x.price.value) + per(x.p) : '';
  const samePrice = new Set(priced.map(label)).size === 1;
  const pack = p => { const n = parseInt(p['Units per case'], 10) || 1; return `pack size: ${n} unit${n === 1 ? '' : 's'}`; };
  const lines = priced.length === 1
    ? `<div>${escapeHtml(pack(priced[0].p))}</div><div>SKU: <b>${escapeHtml(priced[0].p['Product code'])}</b>${priced[0].p.Size ? ` - <b>${escapeHtml(priced[0].p.Size)}</b>` : ''}</div>`
    : priced.map(x => `<div>${x.p.Size ? `<b>${escapeHtml(x.p.Size)}</b> | ` : ''}SKU: <b>${escapeHtml(x.p['Product code'])}</b>${samePrice ? '' : ` | <b>${escapeHtml(label(x))}</b>`}</div>`).join('');
  const has = (pick('Badges') || '').split(',').map(s => s.trim().toLowerCase());
  const badges = SNIPPET_BADGES.filter(([name]) => has.includes(name.toLowerCase()));
  const main = skus[0] || {};
  const makers = [pick('Maker'), main.Producer].map(s => (s || '').trim()).filter(Boolean);
  return `
    <div class="sn-card">
      <div class="sn-head"><span>${escapeHtml(pick('Section') || pick('Category') || '')}</span><span class="sn-mark">PROVISIONS <i>LONDON</i></span></div>
      <div class="sn-top">
        <div class="sn-photo">
          ${photo ? `<img src="${escapeHtml(photo)}" alt="">` : ''}
          ${ribbon ? '<div class="sn-ribbon">NEW</div>' : ''}
        </div>
        <div class="sn-info">
          <div class="sn-titlebar">
            <h2>${escapeHtml(pick('Product name'))}</h2>
            ${badges.length ? `<div class="sn-badges">${badges.map(([name, file]) => `<img class="${file === 'slicer' ? 'wide' : ''}" src="img/badges/${file}.png" alt="${escapeHtml(name)}" title="${escapeHtml(name)}">`).join('')}</div>` : ''}
          </div>
          <div class="sn-rule"></div>
          ${pick('Origin') ? `<div class="sn-origin">${escapeHtml(pick('Origin'))}</div>` : ''}
          ${makers.length ? `<div class="sn-maker">${makers.map(escapeHtml).join('<br>')}</div>` : ''}
          ${has.includes('london delivery only') ? '<div class="sn-sticker">LONDON DELIVERY ONLY</div>' : ''}
          <div class="sn-buy">
            ${samePrice && label(priced[0] || { price: {} }) ? `<div class="sn-price">${escapeHtml(label(priced[0]))}</div>` : ''}
            <div class="sn-skus">${lines}</div>
          </div>
        </div>
      </div>
      ${pick('Tasting note') ? `<p class="sn-tasting">${escapeHtml(pick('Tasting note'))}</p>` : ''}
      ${pick('Story') ? `<p class="sn-story">${escapeHtml(pick('Story'))}</p>` : ''}
    </div>`;
}

function loadHtml2Canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = HTML2CANVAS_URL;
    s.onload = () => resolve(window.html2canvas);
    s.onerror = () => reject(new Error('Couldn’t load the image tool — check your connection.'));
    document.head.appendChild(s);
  });
}

// Swaps a Drive thumbnail for a local copy the canvas is allowed to read.
async function snippetInlinePhoto(card) {
  const img = card.querySelector('.sn-photo img');
  if (!img) return;
  const id = /drive\.google\.com\/.*[?&]id=([^&]+)/.exec(img.src)?.[1];
  if (!id) return;
  const res = await googleFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  if (!res.ok) throw new Error('This photo wasn’t uploaded through the app, so it can’t go in a PNG. Use Print instead, or upload it again.');
  img.src = URL.createObjectURL(await res.blob());
  await img.decode();
}

async function snippetDownload(card, name) {
  const html2canvas = await loadHtml2Canvas();
  await snippetInlinePhoto(card);
  const canvas = await html2canvas(card, { scale: 3, backgroundColor: null, useCORS: true, logging: false });
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `${searchNorm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-snippet.png`;
  a.click();
}

function snippetPrint(card) {
  const sheet = document.createElement('div');
  sheet.id = 'snippetPrint';
  sheet.appendChild(card.cloneNode(true));
  document.body.appendChild(sheet);
  document.body.classList.add('snippet-printing');
  const done = () => { document.body.classList.remove('snippet-printing'); sheet.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
}

// opts = { pick, skus: [SKU objects, whole first], photo, setRibbon: async (on) => {} }
function openSnippet({ pick, skus, photo, setRibbon }) {
  let ribbon = (pick('New') || '').toUpperCase() === 'YES';
  const dlg = document.createElement('dialog');
  dlg.className = 'sn-dialog';
  const calculated = skus.filter(p => snippetPrice(p).calculated).length;
  dlg.innerHTML = `
    <div class="sn-preview"></div>
    ${!pick('Tasting note') ? '<div class="note info">No description yet. Add one on this product’s Portfolio tab.</div>' : ''}
    ${calculated ? `<div class="note info">${calculated === skus.length ? 'No list price set, so this' : 'Some prices have no list price, so this'} uses the calculated price.</div>` : ''}
    <div class="sn-actions">
      <label class="sn-toggle"><input type="checkbox" id="snRibbon" ${ribbon ? 'checked' : ''}> NEW ribbon</label>
      <span class="sn-spacer"></span>
      <button type="button" class="btn ghost sm" id="snClose">Close</button>
      <button type="button" class="btn ghost sm" id="snPrint">Print</button>
      <button type="button" class="btn sm" id="snPng">Download PNG</button>
    </div>`;
  document.body.appendChild(dlg);
  const preview = dlg.querySelector('.sn-preview');
  const render = () => { preview.innerHTML = snippetCardHtml({ pick, skus, photo, ribbon }); };
  render();

  const box = dlg.querySelector('#snRibbon');
  box.addEventListener('change', async () => {
    ribbon = box.checked;
    render();
    box.disabled = true;
    try {
      await setRibbon(ribbon);
    } catch (err) {
      ribbon = !ribbon; box.checked = ribbon; render();
      showToast('Couldn’t save the ribbon: ' + err.message, 'error');
    } finally {
      box.disabled = false;
    }
  });
  dlg.querySelector('#snClose').addEventListener('click', () => dlg.close());
  dlg.querySelector('#snPrint').addEventListener('click', () => snippetPrint(preview.querySelector('.sn-card')));
  dlg.querySelector('#snPng').addEventListener('click', async () => {
    try {
      await snippetDownload(preview.querySelector('.sn-card'), pick('Product name'));
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}
