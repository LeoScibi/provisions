// Google Drive helpers backing the Products bulk photo upload feature.
// Uses the drive.file scope (see js/config.js) — the app can only ever see
// files it created itself, never the user's wider Drive. All product photos
// live in one app-created folder; each photo is named "<Product code>.<ext>"
// so re-uploading a code just replaces that file's content (same file id,
// same URL — no dangling old files, no permission re-setup needed).

const DRIVE_FOLDER_NAME = 'Provisions Product Photos';
const DRIVE_FOLDER_ID_KEY = 'provisions_photosFolderId';

// Requests go through googleFetch (js/sheets.js), so an expired session
// waits for Reconnect instead of failing mid-upload.
async function driveHandle(res) {
  if (!res.ok) {
    let msg = res.statusText || `HTTP ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

// Finds (and verifies) the cached photos folder, or creates a fresh one.
// Caches the id in localStorage so repeat visits don't need to search Drive
// (drive.file's restricted visibility makes searching by name unreliable
// across sessions anyway — the app can only find folders it created).
async function driveEnsureFolder(token) {
  const cached = localStorage.getItem(DRIVE_FOLDER_ID_KEY);
  if (cached) {
    const res = await googleFetch(`https://www.googleapis.com/drive/v3/files/${cached}?fields=id,trashed`);
    if (res.ok) {
      const meta = await res.json();
      if (!meta.trashed) return cached;
    }
    // Cached folder is gone or trashed — fall through and create a new one.
  }
  const created = await driveHandle(await googleFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  }));
  localStorage.setItem(DRIVE_FOLDER_ID_KEY, created.id);
  return created.id;
}

// Looks for a file already named `name` inside `folderId` (i.e. a previous
// photo for the same product code), so a re-upload can replace it in place.
async function driveFindFileByName(folderId, name, token) {
  const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `name = '${safeName}' and '${folderId}' in parents and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`;
  const data = await driveHandle(await googleFetch(url));
  return (data.files || [])[0] || null;
}

// Grants anyone-with-the-link read access so the file can be embedded as a
// plain <img src>. Only needed once per file, right after creation.
async function driveSetPublicReadable(fileId, token) {
  await driveHandle(await googleFetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  }));
}

// Multipart create (new file) or media update (existing file id) — same
// request shape either way, just a different URL/method.
async function driveUploadFileBytes({ folderId, name, mimeType, blob, existingFileId, token }) {
  const boundary = 'provisions-' + Math.random().toString(36).slice(2);
  const metadata = existingFileId ? { name } : { name, parents: [folderId] };
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Blob([head, blob, tail]);

  const url = existingFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;

  return driveHandle(await googleFetch(url, {
    method: existingFileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body
  }));
}

// A publicly-readable Drive file's id can be turned into a directly
// embeddable image URL via Drive's thumbnail endpoint.
function driveImageUrl(fileId) {
  return `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
}

// Separate folder for non-photo product documents (tech sheets), so they
// don't mix with the photos folder above.
const DRIVE_DOCS_FOLDER_NAME = 'Provisions Product Docs';
const DRIVE_DOCS_FOLDER_ID_KEY = 'provisions_docsFolderId';

async function driveEnsureDocsFolder(token) {
  const cached = localStorage.getItem(DRIVE_DOCS_FOLDER_ID_KEY);
  if (cached) {
    const res = await googleFetch(`https://www.googleapis.com/drive/v3/files/${cached}?fields=id,trashed`);
    if (res.ok) {
      const meta = await res.json();
      if (!meta.trashed) return cached;
    }
    // Cached folder is gone or trashed — fall through and create a new one.
  }
  const created = await driveHandle(await googleFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_DOCS_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' })
  }));
  localStorage.setItem(DRIVE_DOCS_FOLDER_ID_KEY, created.id);
  return created.id;
}

// High-level entry point used by the Products detail dialog's Tech sheet
// upload: uploads `file` as the tech sheet for `productCode`, reusing
// (overwriting) any existing file for that code, and returns a link staff
// can open directly (Drive's file-view page, since these aren't images).
async function driveUploadProductDoc(folderId, productCode, file, token) {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const driveName = `${productCode || 'untitled'}.${ext}`;
  const existing = await driveFindFileByName(folderId, driveName, token);
  const result = await driveUploadFileBytes({
    folderId,
    name: driveName,
    mimeType: file.type || 'application/octet-stream',
    blob: file,
    existingFileId: existing ? existing.id : null,
    token
  });
  if (!existing) await driveSetPublicReadable(result.id, token);
  return `https://drive.google.com/file/d/${result.id}/view`;
}

// High-level entry point used by the Products bulk upload dialog: uploads
// `file` as the photo for `productCode`, reusing (overwriting) any existing
// photo file for that code, and returns the image URL to store in the sheet.
async function driveUploadProductPhoto(folderId, productCode, file, token) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const driveName = `${productCode}.${ext}`;
  const existing = await driveFindFileByName(folderId, driveName, token);
  const result = await driveUploadFileBytes({
    folderId,
    name: driveName,
    mimeType: file.type || 'image/jpeg',
    blob: file,
    existingFileId: existing ? existing.id : null,
    token
  });
  if (!existing) await driveSetPublicReadable(result.id, token);
  return driveImageUrl(result.id);
}
