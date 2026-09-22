"use strict";

// OCR-005-T04 -- duplicate-candidate lookup and decision recording over
// persisted Receipt documents. Same layering as
// Services/ReceiptServices/receiptQueryService.js (thin service on top of
// the Receipt model, `.code`-tagged thrown errors, ownership always
// scoped to {_id, userId} together so "not yours" and "doesn't exist"
// collapse to the identical NOT_FOUND outcome) -- this module owns only
// the two new duplicate-detection endpoints (OCR-005-T05's frontend is the
// consumer), not the read/list/link/delete surface receiptQueryService.js
// already owns.
//
// The candidate contract itself (reason codes, duplicateStatus values,
// isProbableDuplicateMatch's null-field-never-matches rule) is fixed by
// utils/duplicateDetectionRules.js -- see that module's own header comment
// for the full design rationale. This file only wires that contract to
// Mongo queries.
const mongoose = require("mongoose");
const Receipt = require("../../models/Receipt");
const { toSafeShape } = require("./receiptQueryService");
const {
  DUPLICATE_REASON_CODES,
  DUPLICATE_STATUSES,
  isProbableDuplicateMatch,
} = require("../../utils/duplicateDetectionRules");

const ERROR_CODES = Object.freeze({
  NOT_FOUND: "NOT_FOUND",
  INVALID_DECISION: "INVALID_DECISION",
});

function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isValidObjectId(id) {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

// Finds other receipts belonging to the SAME user that are duplicate
// candidates for the target receipt, combining two independent signals
// (see duplicateDetectionRules.js):
//   - EXACT_FILE_MATCH: same contentHash.
//   - PROBABLE_MERCHANT_DATE_AMOUNT: narrowed via a Mongo query on
//     {normalizedMerchant, normalizedDate} (skipped entirely when the
//     target's own signature has a null merchant or date, since
//     isProbableDuplicateMatch would reject every candidate anyway), then
//     the exact amount check is applied in application code to that
//     narrowed set.
// A receipt satisfying both signals is reported once, with
// EXACT_FILE_MATCH as its reason code -- the stronger of the two signals.
async function findDuplicateCandidates({ userId, receiptId }) {
  if (!isValidObjectId(receiptId)) {
    throw makeError(`findDuplicateCandidates: invalid receiptId "${receiptId}".`, ERROR_CODES.NOT_FOUND);
  }

  const target = await Receipt.findOne({ _id: receiptId, userId }).lean();
  if (!target) {
    throw makeError(`findDuplicateCandidates: no receipt "${receiptId}" for this user.`, ERROR_CODES.NOT_FOUND);
  }

  const exactMatches = await Receipt.find({
    userId,
    _id: { $ne: receiptId },
    contentHash: target.contentHash,
  }).lean();

  let probableMatches = [];
  const targetSignature = target.duplicateSignature || {};
  if (targetSignature.normalizedMerchant != null && targetSignature.normalizedDate != null) {
    const narrowed = await Receipt.find({
      userId,
      _id: { $ne: receiptId },
      "duplicateSignature.normalizedMerchant": targetSignature.normalizedMerchant,
      "duplicateSignature.normalizedDate": targetSignature.normalizedDate,
    }).lean();

    probableMatches = narrowed.filter((doc) => isProbableDuplicateMatch(targetSignature, doc.duplicateSignature));
  }

  const byId = new Map();

  for (const doc of exactMatches) {
    byId.set(String(doc._id), { doc, reasonCode: DUPLICATE_REASON_CODES.EXACT_FILE_MATCH });
  }

  for (const doc of probableMatches) {
    const id = String(doc._id);
    if (!byId.has(id)) {
      byId.set(id, { doc, reasonCode: DUPLICATE_REASON_CODES.PROBABLE_MERCHANT_DATE_AMOUNT });
    }
  }

  const candidates = Array.from(byId.values()).map(({ doc, reasonCode }) => ({
    receiptId: String(doc._id),
    reasonCode,
    uploadedAt: doc.uploadedAt,
    imageUrl: `/api/receipts/${String(doc._id)}/image`,
    extractedFields: doc.extractedFields,
  }));

  candidates.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  return candidates;
}

// Records the user's decision on a receipt's duplicate candidate(s).
// `decision` must be one of DUPLICATE_STATUSES.CONFIRMED_NEW or
// DUPLICATE_STATUSES.LINKED_EXISTING -- anything else is INVALID_DECISION.
//
// "linked_existing" requires duplicateOfReceiptId to resolve to ANOTHER
// receipt owned by the same user (ownership-scoped lookup, mirroring how
// linkReceiptToExpense in receiptQueryService.js validates its own
// foreign id) -- reuses the same NOT_FOUND code rather than inventing a
// second one, since an unresolvable duplicateOfReceiptId is exactly the
// same kind of failure as an unresolvable receiptId.
//
// "confirmed_new" clears duplicateOfReceiptId back to null, so re-deciding
// a receipt that was previously linked_existing cleanly resets it.
async function recordDuplicateDecision({ userId, receiptId, decision, duplicateOfReceiptId }) {
  if (!isValidObjectId(receiptId)) {
    throw makeError(`recordDuplicateDecision: invalid receiptId "${receiptId}".`, ERROR_CODES.NOT_FOUND);
  }

  const receipt = await Receipt.findOne({ _id: receiptId, userId });
  if (!receipt) {
    throw makeError(`recordDuplicateDecision: no receipt "${receiptId}" for this user.`, ERROR_CODES.NOT_FOUND);
  }

  if (decision !== DUPLICATE_STATUSES.CONFIRMED_NEW && decision !== DUPLICATE_STATUSES.LINKED_EXISTING) {
    throw makeError(`recordDuplicateDecision: invalid decision "${decision}".`, ERROR_CODES.INVALID_DECISION);
  }

  if (decision === DUPLICATE_STATUSES.LINKED_EXISTING) {
    if (
      !isValidObjectId(duplicateOfReceiptId) ||
      String(duplicateOfReceiptId) === String(receiptId)
    ) {
      throw makeError(
        `recordDuplicateDecision: invalid duplicateOfReceiptId "${duplicateOfReceiptId}".`,
        ERROR_CODES.NOT_FOUND
      );
    }

    const other = await Receipt.findOne({ _id: duplicateOfReceiptId, userId }).select("_id").lean();
    if (!other) {
      throw makeError(
        `recordDuplicateDecision: no receipt "${duplicateOfReceiptId}" for this user.`,
        ERROR_CODES.NOT_FOUND
      );
    }

    receipt.duplicateStatus = DUPLICATE_STATUSES.LINKED_EXISTING;
    receipt.duplicateOfReceiptId = duplicateOfReceiptId;
  } else {
    receipt.duplicateStatus = DUPLICATE_STATUSES.CONFIRMED_NEW;
    receipt.duplicateOfReceiptId = null;
  }

  await receipt.save();
  return toSafeShape(receipt.toObject());
}

module.exports = {
  ERROR_CODES,
  findDuplicateCandidates,
  recordDuplicateDecision,
};
