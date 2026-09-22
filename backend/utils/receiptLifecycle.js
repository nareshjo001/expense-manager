"use strict";

// OCR-004-T01 -- receipt lifecycle and retention policy. This is the fixed
// contract every OCR-004 module (the storage adapter, the ingest service,
// the inbox/link APIs, the retention cron, and the frontend) is built
// against, mirroring how DAT-004-T01's utils/exportTypes.js was written
// first, by hand, before any of that feature's parallel work started.
//
// Scope note on "secure storage adapter" (T03): this feature's own
// Technical design section is explicit that "new vendors are UNKNOWN/not
// approved and require an architecture/privacy decision." So the concrete
// storage backend is MongoDB GridFS (via the `mongodb` driver already
// bundled inside the existing `mongoose` dependency -- no new package),
// accessed only through Services/ReceiptServices/receiptStorageAdapter.js's
// adapter interface. That interface is what lets a real object store (S3,
// GCS, ...) be swapped in later behind an ADR without touching every
// caller -- nothing outside that one adapter module may import GridFS
// directly.
const RECEIPT_SCHEMA_VERSION = 1;

// Mirrors OCR-003's parseReceipt()/ocrContract.js versioning convention
// (bump only when an existing field's MEANING changes or disappears;
// adding a field never needs a bump) -- this stamps the shape of
// Receipt.extractedFields, which is parseReceipt()'s own return value
// stored verbatim (see the ingest service). It is a SEPARATE version
// number from ocrContract.js's OCR_RESULT_VERSION: that one versions the
// raw OCR result (text/lines/confidence) that this feature deliberately
// never persists (see the "no raw-text overcollection" note below); this
// one versions the already-structured, already-persisted parseReceipt()
// output.

// Reviewed vs needs-review is a two-state machine, not a boolean, so a
// review event has a place to leave a timestamp (Receipt.reviewedAt) the
// way "needsReview: true/false" alone never could. The two values below
// are the ONLY legal values of Receipt.reviewStatus.
const RECEIPT_REVIEW_STATUSES = Object.freeze({
  NEEDS_REVIEW: "needs_review",
  REVIEWED: "reviewed",
});

const RECEIPT_REVIEW_STATUS_VALUES = Object.freeze(Object.values(RECEIPT_REVIEW_STATUSES));

// The two image types this whole receipt pipeline has ever accepted --
// Services/BillServices/receiptSecurity.service.js's SUPPORTED_RECEIPTS is
// the enforcement boundary (validateReceiptFile() is the single place a
// buffer is actually checked against this), this list exists only so the
// Receipt schema's `mimeType` enum and this feature's own docs/tests don't
// have to re-derive it by reading that file's object keys. If
// SUPPORTED_RECEIPTS ever gains a type, this list must be updated in the
// same change -- there is no dynamic import between the two on purpose
// (a schema enum has to be a static list).
const SUPPORTED_RECEIPT_MIME_TYPES = Object.freeze(["image/jpeg", "image/png"]);

// An unlinked receipt (never attached to an expense) is auto-deleted after
// this many days -- same 90-day "nobody claimed this in three months, it's
// stale" reasoning NOT-003-T06 already established for DeviceToken, not a
// new number invented for this feature. A LINKED receipt (evidence for a
// real expense) is never touched by this sweep -- see
// isEligibleForRetentionSweep below -- and is only removed by an explicit
// user delete or account deletion (PRV-001's Tier B purge).
const RECEIPT_UNLINKED_RETENTION_DAYS = 90;

// Derives the initial reviewStatus for a freshly-ingested receipt directly
// from parseReceipt()'s own needsReview verdict (Services/BillServices/
// receiptParser.js) -- this feature does not re-judge OCR confidence with
// a second, competing threshold; OCR-003 already owns that judgement.
function deriveInitialReviewStatus(parsedReceipt) {
  return parsedReceipt && parsedReceipt.needsReview
    ? RECEIPT_REVIEW_STATUSES.NEEDS_REVIEW
    : RECEIPT_REVIEW_STATUSES.REVIEWED;
}

// True only for a receipt that is BOTH unlinked (linkedExpenseId is
// null/undefined -- once a user links a receipt to an expense it becomes
// evidence for a real financial record and this sweep must never touch it
// again, even if it is old) AND older than the retention window. Takes
// `now` as a parameter (not `new Date()` internally) so callers/tests can
// pass a fixed clock rather than depending on wall-clock time.
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
