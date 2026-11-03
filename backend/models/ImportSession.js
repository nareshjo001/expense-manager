"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;
const {
  IMPORT_TEMPLATE_VERSION,
  IMPORT_SESSION_STATUS_VALUES,
  IMPORT_ROW_DECISION_VALUES,
} = require("../utils/importTypes");

// T01/T04 -- one document per CSV upload's preview-through-commit lifecycle.
const importRowSchema = new Schema(
  {
    // 0-based position in the ORIGINAL file's DATA rows (header excluded) -- lets the preview UI and any error message point back at "row 12 of your file", not at this array's own index after any future filtering.
    rowIndex: { type: Number, required: true },
    // The row's original, unmapped cell values, in the file's own column order -- kept so the preview UI can show "what your file actually said" beside the mapped/normalized fields below, and so a mapping correction (re-mapping a column) never needs a re-upload.
    raw: { type: [String], required: true },

    mapped: {
      expenseName: { type: String, default: null },
      expenseAmount: { type: Number, default: null },
      expenseDate: { type: String, default: null },
      expenseCategory: { type: String, default: null },
    },

    // Js's IMPORT_ROW_ERROR_CODES -- never free text.
    validationErrors: { type: [String], default: [] },

    // Js is reused here (not reimplemented) against this user's EXISTING expenses -- see T05's own module comment for why ExpenseModel's field names already match buildDuplicateSignature()'s expected shape with zero adaptation needed.
    duplicateCandidateExpenseId: { type: Schema.Types.ObjectId, ref: "expenses", default: null },
    // ExpenseCategory`; the user (or T05's own sensible default, see that task) decides whether to accept it.
    suggestedCategory: { type: String, default: null },

    decision: {
      type: String,
      enum: IMPORT_ROW_DECISION_VALUES,
      default: "pending",
    },
    // Set only once, at commit time, for a row that was actually inserted -- never cleared, so a committed session's rows remain a durable record of exactly which expense each accepted row became.
    committedExpenseId: { type: Schema.Types.ObjectId, ref: "expenses", default: null },
  },
  { _id: false }
);

const importSessionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    templateVersion: {
      type: Number,
      required: true,
      default: IMPORT_TEMPLATE_VERSION,
    },
    // For the user's own reference in a session list -- never used for anything security- or logic-relevant (never a file path, never trusted as safe to display without the same escaping any other user-supplied string gets).
    originalFilename: { type: String, default: null },
    // G. { date: "Transaction Date", amount: "Amount", merchant: "Description" }.
    columnMapping: { type: Schema.Types.Mixed, required: true },

    rows: { type: [importRowSchema], required: true },

    status: {
      type: String,
      enum: IMPORT_SESSION_STATUS_VALUES,
      required: true,
      default: "previewing",
    },
    committedAt: { type: Date, default: null },
    committedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Real query patterns this feature needs: - a user's own session list/lookup, newest first.
importSessionSchema.index({ userId: 1, createdAt: -1 });
importSessionSchema.index({ status: 1, createdAt: 1 });

module.exports = mongoose.model("ImportSession", importSessionSchema);
