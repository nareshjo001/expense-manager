"use strict";

// IMP-001-T01 -- CSV import template, limits and session/row state
// machines. The single contract every import module (parser, mapping/
// validation, session model, duplicate/merchant-rule integration, commit,
// frontend) is built against, the same "write the contract by hand before
// any parallel work starts" approach every prior feature this codebase
// has parallelized (DAT-004, OCR-004, OCR-005) already used.

const IMPORT_TEMPLATE_VERSION = 1;

// Canonical target fields a user's own CSV column headers get mapped
// onto. `category` is optional -- an unmapped category falls through to
// a CAT-001 MerchantCategoryRule suggestion (T05) or is left for the user
// to fill in per row, the same way a manually-added expense's category
// can be corrected before saving; date/amount/merchant mirror
// addexpense.js's own required-field set for a manually-added expense.
const IMPORT_TARGET_FIELDS = Object.freeze({
  DATE: "date",
  AMOUNT: "amount",
  MERCHANT: "merchant",
  CATEGORY: "category",
});
const IMPORT_TARGET_FIELD_VALUES = Object.freeze(Object.values(IMPORT_TARGET_FIELDS));
const IMPORT_REQUIRED_TARGET_FIELDS = Object.freeze([
  IMPORT_TARGET_FIELDS.DATE,
  IMPORT_TARGET_FIELDS.AMOUNT,
  IMPORT_TARGET_FIELDS.MERCHANT,
]);

// Hard ceilings -- an unbounded CSV parse/preview/commit is still an
// unbounded one, the same "Large history or maximum allowed input" edge
// case every feature doc's Technical Design section requires a bound for.
// Ballparked against this codebase's existing bounds: MAX_RECEIPT_BYTES
// (receiptSecurity.service.js) is 5MB for a single image; a CSV of
// transaction rows is plain text and far more information-dense per
// byte, so a smaller ceiling here still comfortably covers a multi-year,
// multi-thousand-row export from another tool. MAX_IMPORT_ROWS is
// intentionally the same ballpark as DAT-004's own SYNC_ROW_LIMIT
// (exportTypes.js) -- "handle it inline, no background job" territory.
const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_IMPORT_ROWS = 5000;

// A preview session moves through exactly these states, in exactly this
// order (never backward): PREVIEWING (rows parsed/validated, collecting
// per-row decisions) -> COMMITTING (T06's batch commit is in flight --
// this is what makes a second concurrent commit attempt a no-op rather
// than a double-commit, the same CAS-guarded transition discipline
// cron/receiptRetention.js's own atomic delete already uses) ->
// COMMITTED (terminal; possibly 0 rows committed if the user accepted
// none, which is still a valid, successful outcome). EXPIRED is the one
// state reachable from PREVIEWING by something OTHER than the user: the
// retention sweep, for a session nobody ever came back to finish.
const IMPORT_SESSION_STATUSES = Object.freeze({
  PREVIEWING: "previewing",
  COMMITTING: "committing",
  COMMITTED: "committed",
  EXPIRED: "expired",
});
const IMPORT_SESSION_STATUS_VALUES = Object.freeze(Object.values(IMPORT_SESSION_STATUSES));

// Every row starts PENDING. The user (or, per T05, a sensible default --
// see that task) moves it to exactly one of ACCEPT/SKIP before commit;
// PENDING rows still present at commit time are treated as SKIP (an
// explicit, documented default -- commit never silently accepts a row
// nobody looked at).
const IMPORT_ROW_DECISIONS = Object.freeze({
  PENDING: "pending",
  ACCEPT: "accept",
  SKIP: "skip",
});
const IMPORT_ROW_DECISION_VALUES = Object.freeze(Object.values(IMPORT_ROW_DECISIONS));

// Machine-stable per-row validation error codes -- never free text, same
// convention as every other *_CODES contract in this codebase (e.g.
// receiptQueryService.js's ERROR_CODES). A row can carry more than one.
const IMPORT_ROW_ERROR_CODES = Object.freeze({
  MISSING_DATE: "MISSING_DATE",
  INVALID_DATE: "INVALID_DATE",
  MISSING_AMOUNT: "MISSING_AMOUNT",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  MISSING_MERCHANT: "MISSING_MERCHANT",
});

// An uncommitted preview session is pure UX scaffolding, not a financial
// record -- nothing of value is lost by expiring it, the user just
// re-uploads. Same 24h "generous but bounded" window DAT-004's own
// EXPORT_EXPIRY_HOURS (exportTypes.js) uses for its own ephemeral,
// non-authoritative artifact.
const IMPORT_SESSION_RETENTION_HOURS = 24;

// True only for a session that is still in-flight (PREVIEWING or stuck
// mid-COMMITTING past a crash -- see cron/importSessionRetention.js's own
// comment on why COMMITTING is swept too, not just PREVIEWING) and older
// than the retention window. A COMMITTED or already-EXPIRED session is
// never touched again.
function isSessionEligibleForRetentionSweep(session, now) {
  if (!session) return false;
  if (session.status === IMPORT_SESSION_STATUSES.COMMITTED) return false;
  if (session.status === IMPORT_SESSION_STATUSES.EXPIRED) return false;
  if (!session.createdAt) return false;
  const ageMs = now.getTime() - new Date(session.createdAt).getTime();
  return ageMs > IMPORT_SESSION_RETENTION_HOURS * 60 * 60 * 1000;
}

module.exports = {
  IMPORT_TEMPLATE_VERSION,
  IMPORT_TARGET_FIELDS,
  IMPORT_TARGET_FIELD_VALUES,
  IMPORT_REQUIRED_TARGET_FIELDS,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_ROWS,
  IMPORT_SESSION_STATUSES,
  IMPORT_SESSION_STATUS_VALUES,
  IMPORT_ROW_DECISIONS,
  IMPORT_ROW_DECISION_VALUES,
  IMPORT_ROW_ERROR_CODES,
  IMPORT_SESSION_RETENTION_HOURS,
  isSessionEligibleForRetentionSweep,
};
