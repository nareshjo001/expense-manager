"use strict";

// CSV import template, limits and session/row state machines.

const IMPORT_TEMPLATE_VERSION = 1;

// Canonical target fields a user's own CSV column headers get mapped onto.
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

// Hard ceilings -- an unbounded CSV parse/preview/commit is still an unbounded one, the same "Large history or maximum allowed input" edge case every feature doc's Technical Design section requires a bound for.
const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_IMPORT_ROWS = 5000;

// Js's own atomic delete already uses) -> COMMITTED (terminal; possibly 0 rows committed if the user accepted none, which is still a valid, successful outcome).
const IMPORT_SESSION_STATUSES = Object.freeze({
  PREVIEWING: "previewing",
  COMMITTING: "committing",
  COMMITTED: "committed",
  EXPIRED: "expired",
});
const IMPORT_SESSION_STATUS_VALUES = Object.freeze(Object.values(IMPORT_SESSION_STATUSES));

// Every row starts PENDING.
const IMPORT_ROW_DECISIONS = Object.freeze({
  PENDING: "pending",
  ACCEPT: "accept",
  SKIP: "skip",
});
const IMPORT_ROW_DECISION_VALUES = Object.freeze(Object.values(IMPORT_ROW_DECISIONS));

// G. js's ERROR_CODES). js's ERROR_CODES).
const IMPORT_ROW_ERROR_CODES = Object.freeze({
  MISSING_DATE: "MISSING_DATE",
  INVALID_DATE: "INVALID_DATE",
  MISSING_AMOUNT: "MISSING_AMOUNT",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  MISSING_MERCHANT: "MISSING_MERCHANT",
});

// An uncommitted preview session is pure UX scaffolding, not a financial record -- nothing of value is lost by expiring it, the user just re-uploads.
const IMPORT_SESSION_RETENTION_HOURS = 24;

// Js's own comment on why COMMITTING is swept too, not just PREVIEWING) and older than the retention window.
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
