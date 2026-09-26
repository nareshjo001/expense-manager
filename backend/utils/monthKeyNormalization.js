// DAT-002-T02 -- single canonical definition of the "MMM YYYY" Budget.month
// key. Every call site that previously built or parsed this string with its
// own inline logic (Services/BudgetServices/budget.service.js,
// Controllers/BudgetControllers/setbudget.js, .../updatebudget.js,
// sia/financialQueryService.js) now goes through this module instead, so
// there is exactly one place that defines what "canonical" means here.
//
// This intentionally does NOT change the persisted format. DAT-002-T01's
// inventory found the actual stored/queried convention is "MMM YYYY" (e.g.
// "Jan 2026"), not "YYYY-MM" as the pre-T01 feature doc had assumed --
// verified against every real construction/parse site in the codebase, not
// guessed. Changing the wire format itself would be a breaking change across
// every one of those call sites and is out of scope for "canonicalize ...
// without over-normalizing MongoDB" (feature doc section 5); this module
// only removes the duplication and adds one shared validator.
//
// MONTH_ABBREVIATIONS is verified byte-for-byte equivalent to
// `date.toLocaleString('default', { month: 'short', year: 'numeric' })`'s
// own output for every month/year combination (checked directly with a real
// Node run, not assumed) -- so building a key from this array instead of a
// locale call is behavior-preserving, and removes an ICU/locale dependency
// from a value three different modules parse by splitting on a space.
const MONTH_ABBREVIATIONS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Same shape the codebase's own pre-existing parser
// (Services/BudgetServices/budget.service.js's getMonthAnchorFromKey) already
// used -- reused here, not redefined, so schema validation and parsing can
// never drift apart. Case-insensitive on the month letters, matching that
// established parser's own tolerance.
const MONTH_KEY_PATTERN = /^([A-Za-z]{3})\s+(\d{4})$/;

// Builds the canonical key from an explicit (year, 1-indexed month) pair --
// the shape sia/financialQueryService.js already had (it resolves year/month
// from a caller-supplied timezone before this point, so it never has a Date
// object to hand in).
function buildMonthKeyFromParts(year, monthIndex1Based) {
  const abbreviation = MONTH_ABBREVIATIONS[monthIndex1Based - 1];
  if (!abbreviation || !Number.isInteger(year)) return null;
  return `${abbreviation} ${year}`;
}

// Builds the canonical key from a Date -- the shape
// Services/BudgetServices/budget.service.js/setbudget.js/updatebudget.js
// already had (they resolve "now" or a month-start Date first).
function getMonthKey(date) {
  return buildMonthKeyFromParts(date.getFullYear(), date.getMonth() + 1);
}

// Inverse of both builders above. Returns { year, monthIndex0Based } or
// null for anything that doesn't match MONTH_KEY_PATTERN or names an
// unrecognized month abbreviation -- same contract
// Services/BudgetServices/budget.service.js's getMonthAnchorFromKey already
// had, reused here as the one parser both that function and the schema
// validator delegate to.
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
