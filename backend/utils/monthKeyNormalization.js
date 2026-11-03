// Month key. js) now goes through this module instead, so there is exactly one place that defines what "canonical" means here.
const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Js's getMonthAnchorFromKey) already used -- reused here, not redefined, so schema validation and parsing can never drift apart.
const MONTH_KEY_PATTERN = /^([A-Za-z]{3})\s+(\d{4})$/;

// Js already had (it resolves year/month from a caller-supplied timezone before this point, so it never has a Date object to hand in).
function buildMonthKeyFromParts(year, monthIndex1Based) {
  const abbreviation = MONTH_ABBREVIATIONS[monthIndex1Based - 1];
  if (!abbreviation || !Number.isInteger(year)) return null;
  return `${abbreviation} ${year}`;
}

// Js already had (they resolve "now" or a month-start Date first).
function getMonthKey(date) {
  return buildMonthKeyFromParts(date.getFullYear(), date.getMonth() + 1);
}

// Inverse of both builders above.
function parseMonthKey(monthKey) {
  if (typeof monthKey !== "string") return null;
  const match = monthKey.trim().match(MONTH_KEY_PATTERN);
  if (!match) return null;

  const monthIndex0Based = MONTH_ABBREVIATIONS.indexOf(match[1]);
  if (monthIndex0Based === -1) return null;

  const year = Number(match[2]);
  if (!Number.isFinite(year)) return null;

  return { year, monthIndex0Based };
}

module.exports = {
  MONTH_ABBREVIATIONS,
  MONTH_KEY_PATTERN,
  buildMonthKeyFromParts,
  getMonthKey,
  parseMonthKey,
};
