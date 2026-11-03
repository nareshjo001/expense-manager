"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;
const {
  RECEIPT_SCHEMA_VERSION,
  RECEIPT_REVIEW_STATUS_VALUES,
  SUPPORTED_RECEIPT_MIME_TYPES,
} = require("../utils/receiptLifecycle");
// T02/T03 -- duplicate-detection contract (reason codes, the duplicateStatus state machine, and the normalize*/buildDuplicateSignature helpers that compute the three fields below).
const { DUPLICATE_STATUS_VALUES } = require("../utils/duplicateDetectionRules");

// T01/T02 -- one document per uploaded receipt.
const receiptSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },

    // Js. filePath. filePath.
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

    // Js) own return value, stored verbatim: { expenseName, expenseAmount, expenseDate, overallConfidence, fieldConfidence, needsReview, reviewReasons, amountCandidates }.
    extractedFields: {
      type: Schema.Types.Mixed,
      required: true,
    },
    // Js's OCR_RESULT_VERSION.
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

    // Optional link to the expense this receipt is evidence for.
    linkedExpenseId: {
      type: Schema.Types.ObjectId,
      ref: "expenses",
      default: null,
    },
    linkedAt: { type: Date, default: null },

    // Js's computeContentHash), set once at ingest time and never recomputed.
    contentHash: {
      type: String,
      required: true,
    },

    // Js's buildDuplicateSignature() from this same document's own extractedFields, never re-derived ad hoc elsewhere.
    duplicateSignature: {
      normalizedMerchant: { type: String, default: null },
      normalizedDate: { type: String, default: null },
      amountCents: { type: Number, default: null },
    },

    // Which of the two real choices (see DUPLICATE_STATUSES) the user made after seeing this receipt's duplicate candidates, if any.
    duplicateStatus: {
      type: String,
      enum: DUPLICATE_STATUS_VALUES,
      default: "unreviewed",
    },
    // Set only when duplicateStatus is "linked_existing" -- points at the OTHER Receipt document the user confirmed this one duplicates.
    duplicateOfReceiptId: {
      type: Schema.Types.ObjectId,
      ref: "Receipt",
      default: null,
    },
  },
  { timestamps: true }
);

// Real query patterns this feature needs: - a user's own inbox, newest first (userId + uploadedAt).
receiptSchema.index({ userId: 1, uploadedAt: -1 });
receiptSchema.index({ userId: 1, linkedExpenseId: 1 });
receiptSchema.index({ linkedExpenseId: 1, uploadedAt: 1 });

// Js's module comment on why these never cross users): - exact-file lookup: "does this user already have a receipt with this content hash".
receiptSchema.index({ userId: 1, contentHash: 1 });
receiptSchema.index({
  userId: 1,
  "duplicateSignature.normalizedMerchant": 1,
  "duplicateSignature.normalizedDate": 1,
});

module.exports = mongoose.model("Receipt", receiptSchema);
