"use strict";

// OCR-004-T04 -- read/list/detail/link/delete orchestration over persisted
// Receipt documents. This module owns none of the ingest-time creation of
// a Receipt (Services/ReceiptServices/receiptIngestService.js, built by a
// parallel task) and none of the GridFS bytes themselves
// (Services/ReceiptServices/receiptStorageAdapter.js is the only module
// allowed to touch GridFS directly) -- it is the thin layer in between
// that enforces per-user ownership on every read/mutation and shapes
// Receipt documents into a client-safe response, mirroring
// Services/ExportServices/exportRequestService.js's own split (DAT-004).
//
// Error convention: every validation/not-found failure is a thrown Error
// with a `.code` string (see ERROR_CODES below). Controllers/Receipts/*.js
// map `.code` to an HTTP status; nothing in this file talks HTTP.
//
// Ownership convention: every read/mutation filters on BOTH `_id` AND
// `userId` in the same query, so "not yours" and "doesn't exist" collapse
// to the identical NOT_FOUND outcome -- same posture as
// exportRequestService.js's getExportRequestStatus/resolveDownload.
const mongoose = require("mongoose");
const Receipt = require("../../models/Receipt");
const { ExpenseModel } = require("../../config/Schemas");
const { RECEIPT_REVIEW_STATUSES, RECEIPT_REVIEW_STATUS_VALUES } = require("../../utils/receiptLifecycle");

const ERROR_CODES = Object.freeze({
  NOT_FOUND: "NOT_FOUND",
  EXPENSE_NOT_FOUND: "EXPENSE_NOT_FOUND",
  ALREADY_LINKED_TO_ANOTHER_EXPENSE: "ALREADY_LINKED_TO_ANOTHER_EXPENSE",
  INVALID_REVIEW_STATUS_FILTER: "INVALID_REVIEW_STATUS_FILTER",
  INVALID_CORRECTION: "INVALID_CORRECTION",
});

function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isValidObjectId(id) {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

// Shapes one Receipt document for a client response. Deliberately omits
// storageKey (server-side-only GridFS file id, see models/Receipt.js's own
// comment) -- imageUrl is the only way a client ever gets at the bytes,
// resolved server-side by Controllers/Receipts/image.js the same way
// exportRequestService.js's downloadUrl never exposes ExportRequest's
// filePath.
function toSafeShape(doc) {
  return {
    id: String(doc._id),
    uploadedAt: doc.uploadedAt,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    width: doc.width,
    height: doc.height,
    extractedFields: doc.extractedFields,
    reviewStatus: doc.reviewStatus,
    reviewedAt: doc.reviewedAt,
    linkedExpenseId: doc.linkedExpenseId ? String(doc.linkedExpenseId) : null,
    linkedAt: doc.linkedAt,
    imageUrl: `/api/receipts/${String(doc._id)}/image`,
    // OCR-005 -- whether/how the user has already resolved this receipt's
    // duplicate candidates (see utils/duplicateDetectionRules.js's
    // DUPLICATE_STATUSES). "unreviewed" is the default for the vast
    // majority of receipts that never had a candidate to begin with, not
    // a signal that a candidate is pending.
    duplicateStatus: doc.duplicateStatus || "unreviewed",
    duplicateOfReceiptId: doc.duplicateOfReceiptId ? String(doc.duplicateOfReceiptId) : null,
  };
}

// Returns the requesting user's own receipts, newest first, each in the
// client-safe shape. Optional filters:
//   - reviewStatus: one of RECEIPT_REVIEW_STATUS_VALUES, else a validation
//     error -- never silently ignored, matching exportRequestService's
//     "validate before querying" posture for domain/format.
//   - linked: true -> only linkedExpenseId != null, false -> only
//     linkedExpenseId == null, undefined -> no filter at all.
async function listReceipts({ userId, reviewStatus, linked }) {
  const filter = { userId };

  if (reviewStatus !== undefined) {
    if (!RECEIPT_REVIEW_STATUS_VALUES.includes(reviewStatus)) {
      throw makeError(
        `listReceipts: invalid reviewStatus "${reviewStatus}".`,
        ERROR_CODES.INVALID_REVIEW_STATUS_FILTER
      );
    }
    filter.reviewStatus = reviewStatus;
  }

  if (linked === true) {
    filter.linkedExpenseId = { $ne: null };
  } else if (linked === false) {
    filter.linkedExpenseId = null;
  }

  const docs = await Receipt.find(filter).sort({ uploadedAt: -1 }).lean();
  return docs.map(toSafeShape);
}

// Ownership-scoped single-document read (see module header on the
// NOT_FOUND collapsing).
async function getReceiptDetail({ userId, receiptId }) {
  if (!isValidObjectId(receiptId)) {
    throw makeError(`getReceiptDetail: invalid receiptId "${receiptId}".`, ERROR_CODES.NOT_FOUND);
  }
  const doc = await Receipt.findOne({ _id: receiptId, userId }).lean();
  if (!doc) {
    throw makeError(`getReceiptDetail: no receipt "${receiptId}" for this user.`, ERROR_CODES.NOT_FOUND);
  }
  return toSafeShape(doc);
}

// Ownership-scoped resolve of the pointer a controller needs to stream the
// image bytes through the storage adapter. Never returns anything else
// from the document -- callers get exactly storageKey/mimeType, nothing
// client-shaped, since this is consumed server-side only.
async function getReceiptImageRef({ userId, receiptId }) {
  if (!isValidObjectId(receiptId)) {
    throw makeError(`getReceiptImageRef: invalid receiptId "${receiptId}".`, ERROR_CODES.NOT_FOUND);
  }
  const doc = await Receipt.findOne({ _id: receiptId, userId }).select("storageKey mimeType").lean();
  if (!doc) {
    throw makeError(`getReceiptImageRef: no receipt "${receiptId}" for this user.`, ERROR_CODES.NOT_FOUND);
  }
  return { storageKey: doc.storageKey, mimeType: doc.mimeType };
}

// Links a receipt to an expense. Ownership-scoped on BOTH the receipt
// (userId) and the target expense (ExpenseModel.findOne({_id, userId}))
// so a user can never link their receipt to someone else's expense, nor
// link someone else's receipt to their own expense.
//
// Re-linking to the SAME expense it is already linked to is a harmless
// no-op (idempotent). Linking to a DIFFERENT expense while already linked
// is rejected -- an explicit unlink is required first rather than silently
// moving the link, so a caller never loses track of which expense a
// receipt used to back without an explicit step.
async function linkReceiptToExpense({ userId, receiptId, expenseId }) {
  if (!isValidObjectId(receiptId)) {
    throw makeError(`linkReceiptToExpense: invalid receiptId "${receiptId}".`, ERROR_CODES.NOT_FOUND);
  }

  const receipt = await Receipt.findOne({ _id: receiptId, userId });
  if (!receipt) {
    throw makeError(`linkReceiptToExpense: no receipt "${receiptId}" for this user.`, ERROR_CODES.NOT_FOUND);
  }

  if (!isValidObjectId(expenseId)) {
    throw makeError(`linkReceiptToExpense: invalid expenseId "${expenseId}".`, ERROR_CODES.EXPENSE_NOT_FOUND);
  }

  const expense = await ExpenseModel.findOne({ _id: expenseId, userId }).select("_id").lean();
  if (!expense) {
    throw makeError(
      `linkReceiptToExpense: no expense "${expenseId}" for this user.`,
      ERROR_CODES.EXPENSE_NOT_FOUND
    );
  }

  if (receipt.linkedExpenseId && String(receipt.linkedExpenseId) !== String(expenseId)) {
    throw makeError(
      `linkReceiptToExpense: receipt "${receiptId}" is already linked to a different expense.`,
      ERROR_CODES.ALREADY_LINKED_TO_ANOTHER_EXPENSE
    );
  }

  receipt.linkedExpenseId = expenseId;
  receipt.linkedAt = new Date();
  await receipt.save();
  return toSafeShape(receipt.toObject());
}

// Unlinks a receipt from whatever expense it is currently linked to.
// Idempotent -- unlinking an already-unlinked receipt is not an error.
async function unlinkReceiptFromExpense({ userId, receiptId }) {
  if (!isValidObjectId(receiptId)) {
    throw makeError(`unlinkReceiptFromExpense: invalid receiptId "${receiptId}".`, ERROR_CODES.NOT_FOUND);
  }

  const receipt = await Receipt.findOne({ _id: receiptId, userId });
  if (!receipt) {
    throw makeError(`unlinkReceiptFromExpense: no receipt "${receiptId}" for this user.`, ERROR_CODES.NOT_FOUND);
  }

  receipt.linkedExpenseId = null;
  receipt.linkedAt = null;
  await receipt.save();
  return toSafeShape(receipt.toObject());
}

// Only expenseName/expenseAmount/expenseDate (the three checks below) are
// ever merged onto extractedFields. Everything else in extractedFields
// (overallConfidence, fieldConfidence, reviewReasons, amountCandidates) is
// OCR's own record of what it originally produced and must never be
// overwritten by a user correction.
function validateCorrections(corrections) {
  const merged = {};

  if (Object.prototype.hasOwnProperty.call(corrections, "expenseName")) {
    merged.expenseName = corrections.expenseName;
  }

  if (Object.prototype.hasOwnProperty.call(corrections, "expenseAmount")) {
    const amount = corrections.expenseAmount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw makeError(
        `markReceiptReviewed: expenseAmount correction "${amount}" must be a positive finite number.`,
        ERROR_CODES.INVALID_CORRECTION
      );
    }
    merged.expenseAmount = amount;
  }

  if (Object.prototype.hasOwnProperty.call(corrections, "expenseDate")) {
    const date = corrections.expenseDate;
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      throw makeError(
        `markReceiptReviewed: expenseDate correction "${date}" is not a valid date.`,
        ERROR_CODES.INVALID_CORRECTION
      );
    }
    // Stored as given (parseReceipt() itself stores expenseDate as the
    // matched raw string, see Services/BillServices/receiptExtractors.js's
    // extractDate -- a correction keeps that same representation rather
    // than silently reformatting it).
    merged.expenseDate = date;
  }

  return merged;
}

// Marks a receipt reviewed. `corrections` is an optional partial
// {expenseName, expenseAmount, expenseDate} a user typed in while
// reviewing a low-confidence receipt -- when provided, only those three
// keys are merged onto extractedFields (see validateCorrections above).
async function markReceiptReviewed({ userId, receiptId, corrections }) {
  if (!isValidObjectId(receiptId)) {
    throw makeError(`markReceiptReviewed: invalid receiptId "${receiptId}".`, ERROR_CODES.NOT_FOUND);
  }

  const receipt = await Receipt.findOne({ _id: receiptId, userId });
  if (!receipt) {
    throw makeError(`markReceiptReviewed: no receipt "${receiptId}" for this user.`, ERROR_CODES.NOT_FOUND);
  }

  if (corrections && typeof corrections === "object") {
    const validated = validateCorrections(corrections);
    if (Object.keys(validated).length > 0) {
      receipt.extractedFields = { ...(receipt.extractedFields || {}), ...validated };
      // extractedFields is Schema.Types.Mixed -- Mongoose does not
      // auto-detect an in-place object replacement like this one, so the
      // change is explicitly flagged for save() the way Mixed fields
      // always require (see Mongoose's own Mixed-type caveat).
      receipt.markModified("extractedFields");
    }
  }

  receipt.reviewStatus = RECEIPT_REVIEW_STATUSES.REVIEWED;
  receipt.reviewedAt = new Date();
  await receipt.save();
  return toSafeShape(receipt.toObject());
}

// Ownership-scoped delete. Deletes the GridFS object FIRST (via the
// storage adapter's own deleteReceiptObject, which is documented as
// idempotent -- "already gone" is not an error there) and only removes the
// Mongo document once that succeeds. If deleteReceiptObject throws for any
// other reason, that error propagates here and the Mongo document is left
// intact -- an orphaned-but-still-referenced blob can be retried, a
// dangling storageKey pointing at nothing cannot.
//
// A linked receipt CAN still be explicitly deleted here -- this is a
// user-initiated delete of their own data, not the automatic
// unlinked-only retention sweep utils/receiptLifecycle.js's
// isEligibleForRetentionSweep() governs (that sweep never touches linked
// receipts; this explicit delete applies regardless of link state).
//
// receiptStorageAdapter is required lazily, inside the function body
// rather than at module load time, so that Controllers/Receipts/index.js
// (and therefore Routes/api.routes.js) can still load cleanly even before
// that module exists on disk -- see this file's own header note and the
// OCR-004-T04 build report for why.
async function deleteReceipt({ userId, receiptId }) {
  if (!isValidObjectId(receiptId)) {
    throw makeError(`deleteReceipt: invalid receiptId "${receiptId}".`, ERROR_CODES.NOT_FOUND);
  }

  const receipt = await Receipt.findOne({ _id: receiptId, userId });
  if (!receipt) {
    throw makeError(`deleteReceipt: no receipt "${receiptId}" for this user.`, ERROR_CODES.NOT_FOUND);
  }

  const { deleteReceiptObject } = require("./receiptStorageAdapter");
  await deleteReceiptObject(receipt.storageKey);

  await Receipt.deleteOne({ _id: receipt._id });
  return { id: String(receipt._id) };
}

module.exports = {
  ERROR_CODES,
  toSafeShape,
  listReceipts,
  getReceiptDetail,
  getReceiptImageRef,
  linkReceiptToExpense,
  unlinkReceiptFromExpense,
  markReceiptReviewed,
  deleteReceipt,
};
