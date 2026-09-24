"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;
const {
  RECEIPT_SCHEMA_VERSION,
  RECEIPT_REVIEW_STATUS_VALUES,
  SUPPORTED_RECEIPT_MIME_TYPES,
} = require("../utils/receiptLifecycle");
// OCR-005-T02/T03 -- duplicate-detection contract (reason codes, the
// duplicateStatus state machine, and the normalize*/buildDuplicateSignature
// helpers that compute the three fields below). See that module's own
// header comment for why these are two independent signals, not one.
const { DUPLICATE_STATUS_VALUES } = require("../utils/duplicateDetectionRules");

// OCR-004-T01/T02 -- one document per uploaded receipt. Owns none of the
// actual image bytes (those live in GridFS's own `receipts.files`/
// `receipts.chunks` collections, written only through
// Services/ReceiptServices/receiptStorageAdapter.js) and none of the raw
// OCR text (OCR-003's parseReceipt() output is already fully structured by
// the time it reaches this schema -- see extractedFields below -- so there
// is no raw text/lines array to accidentally over-persist here).
const receiptSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },

    // The GridFS file id (as a string) this receipt's image bytes live
    // under, in the "receipts" bucket -- see receiptStorageAdapter.js.
    // Never sent to the client directly; the inbox/detail APIs resolve it
    // server-side into a streamed response the same way DAT-004's
    // downloadToken pattern never exposes ExportRequest.filePath.
    storageKey: {
      type: String,
      required: true,
      unique: true,
    },

    mimeType: {
      type: String,
      enum: SUPPORTED_RECEIPT_MIME_TYPES,
      required: true,
    },
    sizeBytes: { type: Number, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },

    uploadedAt: { type: Date, required: true, default: Date.now },

    // parseReceipt()'s (Services/BillServices/receiptParser.js) own return
    // value, stored verbatim: { expenseName, expenseAmount, expenseDate,
    // overallConfidence, fieldConfidence, needsReview, reviewReasons,
    // amountCandidates }. Mixed rather than a fully-typed sub-schema for
    // the same reason NotificationPreference.types is Mixed
    // (Services/NotificationServices/notificationPreferenceService.js) --
    // parseReceipt()'s shape is versioned independently (ocrContract.js)
    // and validated in the service layer that reads it, not the schema, so
    // a future additive field never needs a migration here.
    extractedFields: {
      type: Schema.Types.Mixed,
      required: true,
    },
    // Versions the *shape of extractedFields as stored here* -- see
    // utils/receiptLifecycle.js's own comment on why this is a distinct
    // number from ocrContract.js's OCR_RESULT_VERSION.
    extractedFieldsSchemaVersion: {
      type: Number,
      required: true,
      default: RECEIPT_SCHEMA_VERSION,
    },

    reviewStatus: {
      type: String,
      enum: RECEIPT_REVIEW_STATUS_VALUES,
      required: true,
    },
    reviewedAt: { type: Date, default: null },

    // Optional link to the expense this receipt is evidence for. Once set,
    // utils/receiptLifecycle.js's isEligibleForRetentionSweep() permanently
    // excludes this document from the unlinked-retention sweep -- linking
    // is a one-way move out of "orphaned receipt" as far as retention is
    // concerned, even if the expense itself is later edited.
    linkedExpenseId: {
      type: Schema.Types.ObjectId,
      ref: "expenses",
      default: null,
    },
    linkedAt: { type: Date, default: null },

    // OCR-005-T02 -- sha256 of the raw uploaded bytes (see
    // duplicateDetectionRules.js's computeContentHash), set once at
    // ingest time and never recomputed. Powers the EXACT_FILE_MATCH
    // duplicate signal.
    contentHash: {
      type: String,
      required: true,
    },

    // OCR-005-T03 -- the merchant/date/amount candidate-lookup signature,
    // computed once at ingest time by duplicateDetectionRules.js's
    // buildDuplicateSignature() from this same document's own
    // extractedFields, never re-derived ad hoc elsewhere. A field is null
    // whenever OCR couldn't read it -- see isProbableDuplicateMatch()'s
    // own comment on why a null field can never itself count as a match.
    duplicateSignature: {
      normalizedMerchant: { type: String, default: null },
      normalizedDate: { type: String, default: null },
      amountCents: { type: Number, default: null },
    },

    // OCR-005-T04 -- which of the two real choices (see
    // DUPLICATE_STATUSES) the user made after seeing this receipt's
    // duplicate candidates, if any. "unreviewed" is not "not a
    // duplicate" -- it just means no candidate has been surfaced/decided
    // on yet (most receipts: unreviewed forever, because they never had
    // a candidate in the first place).
    duplicateStatus: {
      type: String,
      enum: DUPLICATE_STATUS_VALUES,
      default: "unreviewed",
    },
    // Set only when duplicateStatus is "linked_existing" -- points at the
    // OTHER Receipt document the user confirmed this one duplicates.
    // Never the reverse: linking A to B does not retroactively mark B as
    // a duplicate of A, since B was the original.
    duplicateOfReceiptId: {
      type: Schema.Types.ObjectId,
      ref: "Receipt",
      default: null,
    },
  },
  { timestamps: true }
);

// Real query patterns this feature needs:
// - a user's own inbox, newest first (userId + uploadedAt).
// - "which receipts back this expense" / "is this receipt linked"
//   (userId + linkedExpenseId, e.g. listing only unlinked receipts to
//   offer as link candidates).
// - the retention sweep's own query, across ALL users: unlinked receipts
//   older than the cutoff (linkedExpenseId + uploadedAt, no userId prefix
//   since the cron scans globally the same way DAT-004's exportCleanup.js
//   and NOT-003's staleDeviceCleanup.js do).
receiptSchema.index({ userId: 1, uploadedAt: -1 });
receiptSchema.index({ userId: 1, linkedExpenseId: 1 });
receiptSchema.index({ linkedExpenseId: 1, uploadedAt: 1 });

// OCR-005 -- the two duplicate-candidate lookup patterns, both user-scoped
// (see duplicateDetectionRules.js's module comment on why these never
// cross users):
// - exact-file lookup: "does this user already have a receipt with this
//   content hash".
// - probable-match lookup: "does this user already have a receipt with
//   this merchant+date" (amount is compared in application code once this
//   narrows the candidate set -- see duplicateCandidateService.js).
receiptSchema.index({ userId: 1, contentHash: 1 });
receiptSchema.index({
  userId: 1,
  "duplicateSignature.normalizedMerchant": 1,
  "duplicateSignature.normalizedDate": 1,
});

module.exports = mongoose.model("Receipt", receiptSchema);
