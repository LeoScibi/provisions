// App chrome shared by every page: the top bar (brand, nav, account menu),
// loading feedback, toasts, and the session-expired banner. Each page only
// carries an empty <header class="topbar" id="topbar"></header>; this file
// fills it, so the nav lives in one place.
//
// Loading feedback is driven by the 'google-request' events googleFetch
// (js/sheets.js) fires, so no page has to opt in:
// - a full-page loader until the page's first batch of requests finishes,
// - a thin progress bar under the top bar whenever a request is in flight,
// - a spinner on the button you just clicked while its requests run.
//
// Session expiry: tokens last an hour. When one runs out, nothing is thrown
// away — the banner offers a one-click Reconnect, and any request that was
// waiting (see waitForReconnect) is sent again once you're back.

(function () {
  const ICON = (paths) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

  // Groups are separated by a hairline in the bar. Setup lives in the account menu.
  const NAV = [
    [['index.html', 'Dashboard', '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>']],
    [['products.html', 'Products', '<path d="M3 7.5l9-4 9 4-9 4-9-4z"/><path d="M3 7.5v9l9 4 9-4v-9"/><path d="M12 11.5v9"/>'],
     ['suppliers.html', 'Suppliers', '<rect x="2" y="7" width="12" height="9" rx="1"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/>'],
     ['customers.html', 'Customers', '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2"/><circle cx="17.5" cy="9" r="2.3"/><path d="M15.8 13.5c2.6.5 4.2 2.4 4.2 5"/>'],
     ['transport.html', 'Transport', '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7.5a3.5 3.5 0 0 0 0-7h-7a3.5 3.5 0 0 1 0-7H16"/>']],
    [['purchase-orders.html', 'Purchase orders', '<path d="M12 3v10"/><path d="M8 9l4 4 4-4"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>'],
     ['orders.html', 'Orders', '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1z"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/>'],
     ['lists.html', 'Packing lists', '<path d="M9 5h9M9 12h9M9 19h9"/><path d="M4.5 5l1 1 2-2M4.5 12l1 1 2-2M4.5 19l1 1 2-2"/>']],
    [['stock.html', 'Stock', '<path d="M4 20V10"/><path d="M12 20V4"/><path d="M20 20v-7"/>'],
     ['stock-take.html', 'Stock takes', '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3.5h6a1 1 0 0 1 1 1V6H8V4.5a1 1 0 0 1 1-1z"/><path d="M8.5 12.5l2 2 4-4.5"/>'],
     ['reports.html', 'Reports', '<path d="M4 19h16"/><path d="M5 15l4-4 3 3 6-7"/><path d="M15 7h3v3"/>']]
  ];

  const page = location.pathname.split('/').pop() || 'index.html';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- Top bar
  function renderTopbar() {
    const bar = document.getElementById('topbar');
    if (!bar) return;
    const links = NAV.map(group => `<div class="nav-group">${group.map(([href, label, icon]) =>
      `<a href="${href}"${href === page ? ' class="active" aria-current="page"' : ''}>${ICON(icon)}<span>${label}</span></a>`
    ).join('')}</div>`).join('');
    bar.innerHTML = `
      <a class="brand" href="index.html" aria-label="Provisions — Dashboard">
        <span class="brand-mark"><img src="img/logo.png" alt=""></span>
        <span class="brand-name">Provisions</span>
      </a>
      <nav class="nav" aria-label="Main">${links}</nav>
      <details class="account">
        <summary class="avatar" aria-label="Account"><span data-initial>·</span></summary>
        <div class="menu">
          <div class="menu-who"><strong data-name></strong><span data-email></span></div>
          <a class="menu-item" target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/${esc(getStoredConfig().spreadsheetId)}/edit">Open the spreadsheet</a>
          <a class="menu-item${page === 'setup.html' ? ' active' : ''}" href="setup.html">Setup</a>
          <button type="button" class="menu-item" data-signout>Sign out</button>
        </div>
      </details>
      <div class="net-bar" aria-hidden="true"></div>`;
    bar.querySelector('[data-signout]').addEventListener('click', () => {
      clearSession();
      location.href = 'index.html';
    });
    // Close the account menu when clicking anywhere else.
    document.addEventListener('click', e => {
      const menu = bar.querySelector('.account');
      if (menu.open && !menu.contains(e.target)) menu.open = false;
    });
    // Keep the current page's tab in view on narrow screens, where the nav scrolls sideways.
    bar.querySelector('.nav a.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    refreshAccount();
  }

  function refreshAccount() {
    const bar = document.getElementById('topbar');
    if (!bar) return;
    const { name, email } = getStoredUserInfo();
    bar.querySelector('[data-initial]').textContent = (name || email || '·').trim().charAt(0);
    bar.querySelector('[data-name]').textContent = name || 'Signed in';
    bar.querySelector('[data-email]').textContent = email;
  }
  window.refreshAccount = refreshAccount;

  // ---- Toasts. Parked inside the top-most open dialog when there is one: a
  // modal dialog sits in the browser's top layer, so anything outside it
  // (fixed toasts included) would be hidden behind it.
  function park(el) {
    const top = [...document.querySelectorAll('dialog[open]')].pop();
    const home = top || document.body;
    if (el.parentElement !== home) home.append(el);
  }
  let toastBox;
  function showToast(message, type = 'ok') {
    if (!toastBox) {
      toastBox = document.createElement('div');
      toastBox.className = 'toasts';
      toastBox.setAttribute('aria-live', 'polite');
    }
    park(toastBox);
    const el = document.createElement('div');
    el.className = `toast-msg ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.textContent = message;
    toastBox.append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, type === 'error' ? 8000 : 3500);
  }
  window.showToast = showToast;

  // ---- Session expiry
  let banner;
  let waiters = [];
  let expiryTimer = null;

  function ensureBanner() {
    if (banner) return banner;
    banner = document.createElement('div');
    banner.className = 'session-banner';
    banner.setAttribute('role', 'alert');
    banner.hidden = true;
    banner.innerHTML = `
      <span class="sb-text"><strong>Your Google session has expired.</strong> Nothing you've typed is lost — reconnect and carry on.</span>
      <button type="button" class="btn sm">Reconnect</button>`;
    banner.querySelector('button').addEventListener('click', reconnect);
    return banner;
  }

  function showExpired() {
    if (document.body.classList.contains('signed-out')) return;
    const b = ensureBanner();
    // Signed in without the Google Sheets permission (js/config.js): say so,
    // since Reconnect will show Google's permission screen this time.
    let needsConsent = false;
    try { needsConsent = localStorage.getItem(NEEDS_CONSENT_KEY) === '1'; } catch (e) {}
    b.querySelector('.sb-text').innerHTML = needsConsent
      ? `<strong>The app needs permission to use Google Sheets.</strong> Press Reconnect and tick the Google Sheets box on Google's screen.`
      : `<strong>Your Google session has expired.</strong> Nothing you've typed is lost — reconnect and carry on.`;
    park(b);
    b.hidden = false;
  }

  // googleFetch calls this when it has no valid token; resolves with a fresh one.
  window.waitForReconnect = function () {
    showExpired();
    return new Promise(resolve => waiters.push(resolve));
  };

  function onReconnected(quiet) {
    const token = getStoredToken();
    if (!token) return;
    if (banner) banner.hidden = true;
    const pending = waiters.length;
    waiters.forEach(resolve => resolve(token));
    waiters = [];
    armExpiryTimer();
    refreshAccount();
    if (!quiet) showToast(pending ? 'Reconnected — finishing what you were saving.' : 'Reconnected. Carry on where you left off.');
  }

  function reconnect() {
    const btn = banner.querySelector('button');
    btn.disabled = true;
    try {
      const client = initGoogleAuth({
        clientId: getStoredConfig().clientId,
        onToken: () => { btn.disabled = false; onReconnected(false); },
        onError: msg => { btn.disabled = false; showToast(msg, 'error'); }
      });
      // With a hint Google can skip the account chooser and close the popup at
      // once — unless a permission was refused last time (see js/config.js).
      client.requestAccessToken(signInRequest());
    } catch (e) {
      btn.disabled = false;
      showToast('Google sign-in is still loading — try again in a moment.', 'error');
    }
  }

  function armExpiryTimer() {
    clearTimeout(expiryTimer);
    const expiry = parseInt(localStorage.getItem(PROVISIONS_KEYS.tokenExpiry) || '0', 10);
    if (!expiry || !getStoredToken()) return;
    expiryTimer = setTimeout(checkExpiry, Math.min(expiry - Date.now(), 2 ** 31 - 1));
  }

  function checkExpiry() {
    if (!getStoredToken() && localStorage.getItem(PROVISIONS_KEYS.userEmail)) showExpired();
  }

  // Timers stall while a laptop sleeps, so re-check when the tab comes back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkExpiry(); });
  // Reconnecting (or signing in) in another tab counts here too.
  window.addEventListener('storage', e => {
    if (e.key === PROVISIONS_KEYS.token && getStoredToken()) onReconnected(true);
  });

  // ---- Loading feedback
  let inFlight = 0;
  let idleTimer = null;
  let barTimer = null;
  let firstLoadDone = false;
  let lastClick = null;
  const busyButtons = new Set();

  document.addEventListener('click', e => {
    const btn = e.target.closest('button, .btn');
    if (btn && !btn.closest('.topbar, .session-banner')) lastClick = { el: btn, at: Date.now() };
  }, true);

  document.addEventListener('google-request', e => {
    inFlight = Math.max(0, inFlight + e.detail.delta);
    const bar = document.querySelector('.topbar .net-bar');
    if (e.detail.delta > 0) {
      clearTimeout(idleTimer);
      // Only show the bar for requests that take a moment, so quick ones don't flicker it.
      if (!barTimer) barTimer = setTimeout(() => bar?.classList.add('on'), 150);
      if (firstLoadDone && lastClick && Date.now() - lastClick.at < 1500 && lastClick.el.isConnected) {
        lastClick.el.classList.add('is-busy');
        busyButtons.add(lastClick.el);
      }
    } else if (inFlight === 0) {
      // A save is often several requests in a row; wait a beat before calling it done.
      idleTimer = setTimeout(() => {
        clearTimeout(barTimer); barTimer = null;
        bar?.classList.remove('on');
        busyButtons.forEach(b => b.classList.remove('is-busy'));
        busyButtons.clear();
        lastClick = null;
        finishFirstLoad();
      }, 200);
    }
  });

  function startFirstLoad() {
    if (!getStoredToken()) { firstLoadDone = true; return; }
    const loader = document.createElement('div');
    loader.className = 'page-loader';
    loader.innerHTML = `<div class="pl-logo"><img src="img/logo.png" alt=""></div><p>Loading…</p>`;
    document.body.append(loader);
    document.body.classList.add('page-loading');
    // A page that makes no requests on load shouldn't sit behind the loader.
    window.addEventListener('load', () => setTimeout(() => { if (inFlight === 0) finishFirstLoad(); }, 400));
  }

  function finishFirstLoad() {
    if (firstLoadDone) return;
    firstLoadDone = true;
    document.body.classList.remove('page-loading');
    const loader = document.querySelector('.page-loader');
    if (loader) { loader.classList.add('out'); setTimeout(() => loader.remove(), 300); }
  }
  // index.html shows the loader again after its sign-in completes.
  window.restartPageLoader = function () { firstLoadDone = false; document.querySelector('.page-loader')?.remove(); startFirstLoad(); };

  // Keep the banner and toasts in whichever dialog is on top as dialogs open and close.
  new MutationObserver(() => {
    if (banner && !banner.hidden) park(banner);
    if (toastBox) park(toastBox);
  }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });

  // ---- Opening an order or PO in place ----
  // A link to orders.html?open=ID or purchase-orders.html?open=ID anywhere
  // in the app opens that record's dialog over the current page instead of
  // navigating away. The target page loads in a transparent full-screen
  // iframe in "embed" mode (?embed=1: no top bar or list, just its dialog),
  // so there's still only one order screen and one PO screen to maintain.
  // When the dialog closes the iframe goes away and the page re-reads its
  // data through window.onRecordDialogClosed, if it sets one.
  const EMBED = new URLSearchParams(location.search).has('embed');
  if (EMBED) document.documentElement.classList.add('embedded');

  function openInPlace(url) {
    const shade = document.createElement('div');
    shade.className = 'record-shade';
    shade.innerHTML = '<span class="record-spinner" aria-label="Loading"></span>';
    const frame = document.createElement('iframe');
    frame.className = 'record-frame';
    frame.title = 'Order details';
    frame.src = url + (url.includes('?') ? '&' : '?') + 'embed=1';
    document.body.append(shade, frame);

    const done = () => {
      window.removeEventListener('message', onMessage);
      frame.remove();
      shade.remove();
      if (typeof window.onRecordDialogClosed === 'function') window.onRecordDialogClosed();
    };
    // Clicking the shade while it's still loading gives up on it.
    shade.addEventListener('click', () => { if (!frame.classList.contains('show')) done(); });
    function onMessage(e) {
      if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
      const type = e.data && e.data.provisionsEmbed;
      if (type === 'ready') {
        shade.classList.add('ready');
        frame.classList.add('show');
        frame.contentWindow.focus();
      } else if (type === 'closed') {
        done();
      }
    }
    window.addEventListener('message', onMessage);
  }
  window.openInPlace = openInPlace;

  if (!EMBED) {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      // Cmd/Ctrl/Shift-click still opens the full page in a new tab.
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const url = new URL(a.href, location.href);
      const target = url.pathname.split('/').pop();
      if (url.origin !== location.origin || !url.searchParams.get('open')) return;
      if (target !== 'orders.html' && target !== 'purchase-orders.html') return;
      if (target === (location.pathname.split('/').pop() || 'index.html')) return; // that page opens its own dialogs
      e.preventDefault();
      openInPlace(target + url.search);
    });
  } else {
    // Tell the parent page when the record's dialog has opened (show the
    // iframe) and when every dialog has closed again (remove it). The short
    // wait rides out a page closing one dialog and opening the next.
    const tell = (type) => parent.postMessage({ provisionsEmbed: type }, location.origin);
    let opened = false, closeTimer = null;
    new MutationObserver(() => {
      if (document.querySelector('dialog[open]')) {
        clearTimeout(closeTimer);
        if (!opened) { opened = true; tell('ready'); }
      } else if (opened) {
        clearTimeout(closeTimer);
        closeTimer = setTimeout(() => { if (!document.querySelector('dialog[open]')) tell('closed'); }, 150);
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    // For a page whose deep-linked record doesn't exist (deleted meanwhile).
    window.embedNothingToShow = () => tell('closed');
  }

  renderTopbar();
  startFirstLoad();
  armExpiryTimer();
})();
