// Small shared helpers used by every CRUD page.

// Generates the next sequential ID for a prefix, e.g. nextId(rows, 'SUP') -> 'SUP004'
// based on the highest existing number found in column A of the given rows
// (rows includes the header row as element 0).
function nextId(rows, prefix, padLength = 3) {
  let max = 0;
  for (let i = 1; i < rows.length; i++) {
    const cell = (rows[i][0] || '').toString();
    if (cell.startsWith(prefix)) {
      const n = parseInt(cell.slice(prefix.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(padLength, '0');
}

// Converts a 1-based column number to a spreadsheet column letter (1 -> A, 27 -> AA).
function colLetter(n) {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeHtml(s) {
  return (s ?? '').toString()
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Display label for a stored UNIT value — the sheet keeps the short code
// ('kg', 'pc') so existing rows and dropdown values don't need to change.
function unitLabel(u) {
  return u === 'pc' ? 'Pieces' : (u || '');
}

// Formats a quantity flush against its unit label ('12kg') for kg, since
// that's normal unit notation — everything else ('Pieces') needs a space
// ('6 Pieces') or it reads as one run-together word.
function qtyUnit(qty, unit) {
  return `${qty}${unit === 'kg' ? 'kg' : ' ' + unitLabel(unit)}`;
}

// Search text normalised so accents and case don't matter: "comte" finds
// "Comté", "felicien" finds "St Félicien" (and typing the accent still
// works). NFD splits "é" into "e" plus a combining accent, which is then
// dropped; letters NFD can't split (œ, æ, ø, ß) are spelled out.
function searchNorm(s) {
  return (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE')
    .replace(/ø/g, 'o').replace(/Ø/g, 'O').replace(/ß/g, 'ss')
    .toLowerCase();
}

// True when `text` contains `term`, ignoring accents and case. Pass a term
// already run through searchNorm() when matching it against many texts.
function searchMatch(text, normTerm) {
  return searchNorm(text).includes(normTerm);
}
