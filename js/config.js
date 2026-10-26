// Shared config + auth helpers used by every page.
// Config (Client ID / Spreadsheet ID) and the access token are kept in
// localStorage so you only enter them once per browser, and pages share
// the same signed-in session instead of re-authenticating each time.

const PROVISIONS_KEYS = {
  clientId: 'provisions_clientId',
  spreadsheetId: 'provisions_spreadsheetId',
  token: 'provisions_accessToken',
  tokenExpiry: 'provisions_tokenExpiry',
  userEmail: 'provisions_userEmail',
  userName: 'provisions_userName'
};

// Accepts either a bare Spreadsheet ID or a full docs.google.com sheet URL
// (an easy thing to paste by mistake) and returns just the ID.
function normalizeSpreadsheetId(value) {
  const v = (value || '').trim();
  const m = v.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : v;
}

function getStoredConfig() {
  return {
    clientId: localStorage.getItem(PROVISIONS_KEYS.clientId) || '',
    spreadsheetId: normalizeSpreadsheetId(localStorage.getItem(PROVISIONS_KEYS.spreadsheetId))
  };
}

function saveStoredConfig(clientId, spreadsheetId) {
  localStorage.setItem(PROVISIONS_KEYS.clientId, clientId.trim());
  localStorage.setItem(PROVISIONS_KEYS.spreadsheetId, normalizeSpreadsheetId(spreadsheetId));
}

function getStoredToken() {
  const token = localStorage.getItem(PROVISIONS_KEYS.token);
  const expiry = parseInt(localStorage.getItem(PROVISIONS_KEYS.tokenExpiry) || '0', 10);
  if (token && Date.now() < expiry) return token;
  return null;
}

function storeToken(token, expiresInSeconds) {
  const safeExpiry = Date.now() + ((expiresInSeconds || 3600) * 1000) - 60000; // 1 min safety buffer
  localStorage.setItem(PROVISIONS_KEYS.token, token);
  localStorage.setItem(PROVISIONS_KEYS.tokenExpiry, String(safeExpiry));
}

function clearToken() {
  localStorage.removeItem(PROVISIONS_KEYS.token);
  localStorage.removeItem(PROVISIONS_KEYS.tokenExpiry);
}

function getStoredUserInfo() {
  return {
    email: localStorage.getItem(PROVISIONS_KEYS.userEmail) || '',
    name: localStorage.getItem(PROVISIONS_KEYS.userName) || ''
  };
}

function storeUserInfo(email, name) {
  if (email) localStorage.setItem(PROVISIONS_KEYS.userEmail, email);
  if (name) localStorage.setItem(PROVISIONS_KEYS.userName, name);
}

function clearUserInfo() {
  localStorage.removeItem(PROVISIONS_KEYS.userEmail);
  localStorage.removeItem(PROVISIONS_KEYS.userName);
}

// Clears everything about the signed-in session — used by the logout
// control in the top-right user badge (see initUserBadge below).
function clearSession() {
  clearToken();
  clearUserInfo();
}

// Non-critical: only powers the "who's signed in" badge, so a failure here
// (e.g. a cached token from before the userinfo scopes were added) is
// silently ignored rather than surfaced as an error.
async function fetchAndStoreUserInfo(token) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    storeUserInfo(data.email || '', data.name || '');
  } catch (e) { /* badge falls back to a generic "Signed in" label */ }
}

// Sets up a Google Identity Services token client.
// onToken(token) fires on every successful sign-in (including silent refresh).
function initGoogleAuth({ clientId, onToken, onError }) {
  return google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    // drive.file is a non-sensitive, restricted-access scope: it only ever
    // sees files this app itself creates (the product photos folder and the
    // images in it), never the user's wider Drive. Needed for the Products
    // photo bulk-upload feature — see js/drive.js. userinfo.email/profile are
    // also non-sensitive, basic scopes — used only to show who's signed in.
    scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    callback: (resp) => {
      if (resp.error) { onError && onError(resp.error); return; }
      storeToken(resp.access_token, resp.expires_in);
      fetchAndStoreUserInfo(resp.access_token).finally(() => { onToken && onToken(resp.access_token); });
    }
  });
}

// Call this on every page load. If a valid cached token exists, it's used
// immediately (no re-sign-in needed within the ~1hr window). Otherwise the
// caller is left in a "signed out" state and should show the sign-in button.
function tryResumeSession() {
  return getStoredToken();
}

// Drives the "signed in as X" badge on the Dashboard (index.html only —
// its markup sits next to the "Dashboard" heading there) — shows/hides it
// based on session state and wires its logout button once. Runs
// automatically on every page load (a no-op on pages without the badge);
// index.html also calls it straight after a successful sign-in so the
// badge appears without a reload.
function renderUserBadgeUI() {
  const badge = document.getElementById('userBadge');
  if (!badge) return;
  const token = tryResumeSession();
  if (!token) { badge.style.display = 'none'; return; }
  const info = getStoredUserInfo();
  const nameEl = document.getElementById('userBadgeName');
  if (nameEl) nameEl.textContent = info.name || info.email || 'Signed in';
  badge.style.display = 'flex';
}

function initUserBadge() {
  renderUserBadgeUI();
  const logoutBtn = document.getElementById('userBadgeLogout');
  if (logoutBtn && !logoutBtn.dataset.wired) {
    logoutBtn.dataset.wired = '1';
    logoutBtn.addEventListener('click', () => {
      clearSession();
      location.reload();
    });
  }
}

window.addEventListener('load', initUserBadge);
