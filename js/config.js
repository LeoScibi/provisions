// Shared config + auth helpers used by every page.
// The OAuth Client ID and the Spreadsheet ID are baked in below, so there's
// nothing to configure per browser — the Dashboard just shows a sign-in
// screen. The access token is kept in localStorage so pages share the same
// signed-in session instead of re-authenticating each time.

const APP_CONFIG = {
  clientId: '463779305743-ha237e1vfbj5le2psr5nqpo28uhnd09a.apps.googleusercontent.com',
  spreadsheetId: '16ODfsKSfSlPEZmIZYytIH6GmG9UOu_3brxpRTheV03E'
};

const PROVISIONS_KEYS = {
  token: 'provisions_accessToken',
  tokenExpiry: 'provisions_tokenExpiry',
  userEmail: 'provisions_userEmail',
  userName: 'provisions_userName'
};

// Kept as a function (rather than every page reading APP_CONFIG directly)
// since all pages already call it.
function getStoredConfig() {
  return { ...APP_CONFIG };
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

// Clears everything about the signed-in session — used by "Sign out" in the
// top bar's account menu (see js/shell.js).
function clearSession() {
  clearToken();
  clearUserInfo();
}

// Non-critical: only powers the account menu (and the reconnect hint), so a failure here
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
// onToken(token) fires on every successful sign-in (including a reconnect).
// onError(message) also fires when the popup is blocked or closed.
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
    },
    error_callback: (err) => {
      const msg = err?.type === 'popup_failed_to_open' ? 'The sign-in popup was blocked. Allow popups for this site and try again.'
        : err?.type === 'popup_closed' ? 'Sign-in was cancelled.' : (err?.message || 'Sign-in failed.');
      onError && onError(msg);
    }
  });
}

// Call this on every page load. If a valid cached token exists, it's used
// immediately (no re-sign-in needed within the ~1hr window). Otherwise the
// caller is left in a "signed out" state and should show the sign-in button.
function tryResumeSession() {
  return getStoredToken();
}

// Every page but the Dashboard needs a session, so a signed-out visit (or an
// expired token) goes straight to the Dashboard's sign-in screen, which
// sends you back here afterwards (see NEXT_PAGE_KEY in index.html).
const NEXT_PAGE_KEY = 'provisions_nextPage';
if (!getStoredToken() && !/\/(index\.html)?$/.test(location.pathname)) {
  try { sessionStorage.setItem(NEXT_PAGE_KEY, location.pathname.split('/').pop() + location.search + location.hash); } catch (e) {}
  location.replace('index.html');
}
