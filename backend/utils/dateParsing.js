"use strict";

// Validates year/month/day calendar validity via UTC date round-trip
// (prevents rolling Feb 31 over into March) and formats as YYYY-MM-DD.
function toIsoIfValid(year, monthIndex, day) {
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11 || !Number.isFinite(day)) return null;
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Parses common CSV date formats into canonical YYYY-MM-DD:
// 1. ISO: YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD (optionally with time)
// 2. Day-first / Month-first numeric: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, MM/DD/YYYY
//    (In INR/Indian context, ambiguous D/M <= 12 uses standard day-first convention)
// 3. Native Date parse fallback (e.g. "25 Oct 2026", "October 25, 2026")
function parseCsvDate(value) {
  const text = String(value == null ? "" : value).trim();
  if (!text) return null;

  // 1. ISO: YYYY-MM-DD or YYYY/MM/DD or YYYY.MM.DD
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (iso) {
    return toIsoIfValid(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  // 2. Numeric with delimiter: DD-MM-YYYY, DD/MM/YYYY, DD.MM.YYYY, MM-DD-YYYY, etc.
  const numeric = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (numeric) {
    const p1 = Number(numeric[1]);
    const p2 = Number(numeric[2]);
    const yStr = numeric[3];
    const year = yStr.length <= 2 ? Number(yStr) + 2000 : Number(yStr);

    if (p1 > 12 && p2 <= 12) {
      // Unambiguous DD-MM-YYYY (e.g. 25-10-2026)
      return toIsoIfValid(year, p2 - 1, p1);
    } else if (p1 <= 12 && p2 > 12) {
      // Unambiguous MM-DD-YYYY (e.g. 10-25-2026)
      return toIsoIfValid(year, p1 - 1, p2);
    } else {
      // Ambiguous (e.g. 05-10-2026). Indian / standard international convention: day first (DD-MM-YYYY)
      return toIsoIfValid(year, p2 - 1, p1);
    }
  }

  // 3. Fallback for textual dates (e.g. '25 Oct 2026', 'October 25, 2026')
  const d = new Date(text);
  if (!Number.isNaN(d.getTime())) {
    return toIsoIfValid(d.getFullYear(), d.getMonth(), d.getDate());
  }

  return null;
}

module.exports = {
  toIsoIfValid,
  parseCsvDate,
};
