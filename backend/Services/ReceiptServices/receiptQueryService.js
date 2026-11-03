"use strict";

// Read/list/detail/link/delete orchestration over persisted Receipt documents.
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

// Shapes one Receipt document for a client response. js's downloadUrl never exposes ExportRequest's filePath.
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
    // Js's DUPLICATE_STATUSES).
    duplicateStatus: doc.duplicateStatus || "unreviewed",
    duplicateOfReceiptId: doc.duplicateOfReceiptId ? String(doc.duplicateOfReceiptId) : null,
  };
}

// Returns the requesting user's own receipts, newest first, each in the client-safe shape.
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

// Ownership-scoped resolve of the pointer a controller needs to stream the image bytes through the storage adapter.
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

// Links a receipt to an expense.
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

// Only expenseName/expenseAmount/expenseDate (the three checks below) are ever merged onto extractedFields.
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
    // Js's extractDate -- a correction keeps that same representation rather than silently reformatting it).
    merged.expenseDate = date;
  }

  return merged;
}

// Marks a receipt reviewed.
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
      // Mixed -- Mongoose does not auto-detect an in-place object replacement like this one, so the change is explicitly flagged for save() the way Mixed fields always require (see Mongoose's own Mixed-type caveat).
      receipt.markModified("extractedFields");
    }
  }

  receipt.reviewStatus = RECEIPT_REVIEW_STATUSES.REVIEWED;
  receipt.reviewedAt = new Date();
  await receipt.save();
  return toSafeShape(receipt.toObject());
}

// Ownership-scoped delete. Deletes the GridFS object FIRST (via the storage adapter's own deleteReceiptObject, which is documented as idempote.
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
