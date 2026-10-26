// Generic Sheets API v4 helpers. Every feature page uses these instead of
// writing its own fetch calls, so auth handling and error messages stay
// consistent as more pages get added.

function sheetsBaseUrl(spreadsheetId) {
  return `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
}

// Every Google API call (Sheets here, Drive in js/drive.js) goes through this.
// It always sends the freshest stored token rather than the one a page read
// at load, and when the session has expired (no token, or a 401) it doesn't
// fail: it waits for the Reconnect banner (js/shell.js) and then sends the
// same request again. So a save made after the hour is up just completes
// once you reconnect, with the page and anything typed left as they were.
// `_token` is ignored and only kept so existing callers don't change.
async function googleFetch(url, opts = {}, _token) {
  document.dispatchEvent(new CustomEvent('google-request', { detail: { delta: 1, method: opts.method || 'GET' } }));
  try {
    for (let attempt = 0; ; attempt++) {
      let token = getStoredToken();
      if (!token && window.waitForReconnect) token = await window.waitForReconnect();
      const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
      if (res.status !== 401 || attempt >= 2 || !window.waitForReconnect) return res;
      clearToken();
    }
  } finally {
    document.dispatchEvent(new CustomEvent('google-request', { detail: { delta: -1 } }));
  }
}

async function sheetsHandle(res) {
  if (!res.ok) {
    // statusText is always empty over HTTP/2, so fall back to the status code
    // (a non-JSON 404 usually means a malformed Spreadsheet ID).
    let msg = res.statusText || `HTTP ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

// Reads a range, e.g. "Ingredients!A:O". Returns array of rows (first row = header).
async function sheetsGet(spreadsheetId, range, token) {
  const url = `${sheetsBaseUrl(spreadsheetId)}/values/${encodeURIComponent(range)}`;
  const res = await googleFetch(url);
  const data = await sheetsHandle(res);
  return data.values || [];
}

// Appends a single row to the end of a sheet/range, e.g. "Ingredients!A:O".
async function sheetsAppend(spreadsheetId, range, row, token) {
  const url = `${sheetsBaseUrl(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const res = await googleFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [row] })
  });
  return sheetsHandle(res);
}

// Appends many rows at once (bulk import), e.g. rows = [[...],[...]].
async function sheetsAppendRows(spreadsheetId, range, rows, token) {
  const url = `${sheetsBaseUrl(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;
  const res = await googleFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: rows })
  });
  return sheetsHandle(res);
}

// Overwrites a fixed range, e.g. "Ingredients!A1:O1" for a header row.
async function sheetsUpdateRange(spreadsheetId, range, values, token, valueInputOption = 'RAW') {
  const url = `${sheetsBaseUrl(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=${valueInputOption}`;
  const res = await googleFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values })
  });
  return sheetsHandle(res);
}

// Returns [{ sheetId, title }] for every tab in the spreadsheet.
async function sheetsGetTabs(spreadsheetId, token) {
  const url = `${sheetsBaseUrl(spreadsheetId)}?fields=sheets.properties(sheetId,title)`;
  const res = await googleFetch(url);
  const data = await sheetsHandle(res);
  return (data.sheets || []).map(s => ({ sheetId: s.properties.sheetId, title: s.properties.title }));
}

// Runs a batchUpdate (structural changes: add sheets, formatting, etc).
async function sheetsBatchUpdate(spreadsheetId, requests, token) {
  const url = `${sheetsBaseUrl(spreadsheetId)}:batchUpdate`;
  const res = await googleFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });
  return sheetsHandle(res);
}
