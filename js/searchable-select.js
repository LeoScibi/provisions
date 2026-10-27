// Progressively enhances a plain <select> into a searchable combobox: a
// trigger button showing the current label, and on click a popover with a
// search box plus the filtered option list.
//
// The native <select> is kept in the DOM (display:none, not removed) as the
// single source of truth, so every existing call site that reads/writes
// `.value`, `.disabled`, listens for 'change', or rewrites `.innerHTML`
// wholesale (ref-option loading, the Allocations FEFO helper, etc.) keeps
// working completely untouched — this file never needs to know about any
// of that. A MutationObserver on the select's children/disabled attribute
// keeps the enhancement in sync automatically. The one gap a plain observer
// can't cover is a bare `select.value = x` with no event fired — dispatch a
// 'change' event after those (the codebase's existing ref-population code
// already does) so the trigger's label updates.
//
// enhanceSelect(selectEl) -> { wrap, trigger, destroy(), refresh() }, or
// null if it was already enhanced (safe to call more than once on the same
// element). `wrap` is the container for both the trigger and its popover —
// useful for a caller that needs to know when focus leaves the whole widget
// (e.g. `wrap.addEventListener('focusout', e => { if
// (!wrap.contains(e.relatedTarget)) ... })`), since the hidden native
// <select> itself never receives focus/blur once enhanced.

function enhanceSelect(selectEl) {
  if (selectEl.dataset.cbxEnhanced === '1') return null;
  selectEl.dataset.cbxEnhanced = '1';
  selectEl.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.className = 'cbx';
  selectEl.parentNode.insertBefore(wrap, selectEl);
  wrap.appendChild(selectEl);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'cbx-trigger';
  trigger.innerHTML = `<span class="cbx-label"></span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
  wrap.appendChild(trigger);
  const labelEl = trigger.querySelector('.cbx-label');

  const pop = document.createElement('div');
  pop.className = 'cbx-pop';
  pop.hidden = true;
  pop.innerHTML = `<input type="text" class="cbx-search" placeholder="Search…"><div class="cbx-list"></div>`;
  wrap.appendChild(pop);
  const searchInput = pop.querySelector('.cbx-search');
  const list = pop.querySelector('.cbx-list');

  let filtered = [];
  let activeIdx = -1;

  function options() {
    return [...selectEl.options].map(o => ({ value: o.value, text: o.text }));
  }

  function syncLabel() {
    const opt = selectEl.options[selectEl.selectedIndex];
    labelEl.textContent = opt ? opt.text : '';
    trigger.classList.toggle('cbx-placeholder', !opt || opt.value === '');
  }

  function syncDisabled() {
    trigger.disabled = selectEl.disabled;
    trigger.classList.toggle('cbx-disabled', selectEl.disabled);
  }

  function setActive(idx) {
    const prev = list.children[activeIdx];
    if (prev) prev.classList.remove('cbx-active');
    activeIdx = idx;
    const next = list.children[activeIdx];
    if (next) { next.classList.add('cbx-active'); next.scrollIntoView({ block: 'nearest' }); }
  }

  function renderList() {
    const term = searchNorm(searchInput.value.trim());
    const all = options();
    filtered = term ? all.filter(o => searchMatch(o.text, term)) : all;
    list.innerHTML = filtered.length
      ? filtered.map(o => `<button type="button" class="cbx-opt${o.value === selectEl.value ? ' cbx-selected' : ''}">${escapeHtml(o.text)}</button>`).join('')
      : `<div class="cbx-empty">No matches</div>`;
    const preselect = filtered.findIndex(o => o.value === selectEl.value);
    activeIdx = -1;
    setActive(preselect >= 0 ? preselect : 0);
  }

  function resync() {
    syncLabel();
    syncDisabled();
    if (!pop.hidden) renderList();
  }

  function open() {
    if (selectEl.disabled) return;
    searchInput.value = '';
    renderList();
    pop.hidden = false;
    trigger.classList.add('cbx-open');
    searchInput.focus();
  }

  function close() {
    pop.hidden = true;
    trigger.classList.remove('cbx-open');
  }

  function choose(opt) {
    selectEl.value = opt.value;
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    trigger.focus();
  }

  trigger.addEventListener('click', (e) => { e.stopPropagation(); pop.hidden ? open() : close(); });
  trigger.addEventListener('keydown', (e) => {
    if (pop.hidden && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); open(); }
  });
  document.addEventListener('click', (e) => { if (!pop.hidden && !wrap.contains(e.target)) close(); });

  searchInput.addEventListener('input', renderList);
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(activeIdx + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(activeIdx - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[activeIdx]) choose(filtered[activeIdx]); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); trigger.focus(); }
  });
  list.addEventListener('mousedown', (e) => {
    // mousedown (not click) so this fires before the search input's blur
    const btn = e.target.closest('.cbx-opt');
    if (btn) { e.preventDefault(); choose(filtered[[...list.children].indexOf(btn)]); }
  });

  const observer = new MutationObserver(resync);
  observer.observe(selectEl, { childList: true, attributes: true, attributeFilter: ['disabled'] });
  selectEl.addEventListener('change', syncLabel);

  resync();

  return {
    wrap,
    trigger,
    refresh: resync,
    destroy() {
      observer.disconnect();
      selectEl.removeEventListener('change', syncLabel);
      selectEl.style.display = '';
      delete selectEl.dataset.cbxEnhanced;
      wrap.parentNode.insertBefore(selectEl, wrap);
      wrap.remove();
    }
  };
}
