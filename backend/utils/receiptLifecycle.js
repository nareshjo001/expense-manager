"use strict";

// Receipt lifecycle and retention policy. js was written first, by hand, before any of that feature's parallel work started.
const RECEIPT_SCHEMA_VERSION = 1;

// ExtractedFields, which is parseReceipt()'s own return value stored verbatim (see the ingest service).

// ReviewedAt) the way "needsReview: true/false" alone never could.
const RECEIPT_REVIEW_STATUSES = Object.freeze({
  NEEDS_REVIEW: "needs_review",
  REVIEWED: "reviewed",
});

const RECEIPT_REVIEW_STATUS_VALUES = Object.freeze(Object.values(RECEIPT_REVIEW_STATUSES));

// Js's SUPPORTED_RECEIPTS is the enforcement boundary (validateReceiptFile() is the single place a buffer is actually checked against this), this list exists only so the Receipt schema's `mimeType` enum and this feature's own docs/tests don't have to re-derive it by reading that file's object keys.
const SUPPORTED_RECEIPT_MIME_TYPES = Object.freeze(["image/jpeg", "image/png"]);

// An unlinked receipt (never attached to an expense) is auto-deleted after this many days -- same 90-day "nobody claimed this in three months, it's stale" reasoning NOT-003-T06 already established for DeviceToken, not a new number invented for this feature.
const RECEIPT_UNLINKED_RETENTION_DAYS = 90;

// Js) -- this feature does not re-judge OCR confidence with a second, competing threshold; OCR-003 already owns that judgement.
function deriveInitialReviewStatus(parsedReceipt) {
  return parsedReceipt && parsedReceipt.needsReview
    ? RECEIPT_REVIEW_STATUSES.NEEDS_REVIEW
    : RECEIPT_REVIEW_STATUSES.REVIEWED;
}

// True only for a receipt that is BOTH unlinked (linkedExpenseId is null/undefined -- once a user links a receipt to an expense it becomes evidence for a real financial record and this sweep must never touch it again, even if it is old) AND older than the retention window.
function isEligibleForRetentionSweep(receipt, now) {
  if (!receipt || receipt.linkedExpenseId) return false;
  if (!receipt.uploadedAt) return false;
  const ageMs = now.getTime() - new Date(receipt.uploadedAt).getTime();
  const retentionMs = RECEIPT_UNLINKED_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return ageMs > retentionMs;
}

module.exports = {
  RECEIPT_SCHEMA_VERSION,
  RECEIPT_REVIEW_STATUSES,
  RECEIPT_REVIEW_STATUS_VALUES,
  SUPPORTED_RECEIPT_MIME_TYPES,
  RECEIPT_UNLINKED_RETENTION_DAYS,
  deriveInitialReviewStatus,
  isEligibleForRetentionSweep,
};
