"use strict";

// POST /api/receipts/:id/duplicate-decision. Body: { decision, duplicateOfReceiptId?
const mongoose = require("mongoose");
const {
  recordDuplicateDecision,
  ERROR_CODES,
} = require("../../Services/ReceiptServices/duplicateCandidateService");
const { emitDuplicateDecisionEvent } = require("../../Services/ReceiptServices/duplicateDecisionAudit");

const NOT_FOUND_RESPONSE = { message: "Receipt not found", success: false };

const recordDuplicateDecisionController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const { decision, duplicateOfReceiptId } = req.body || {};
    if (!decision) {
      return res.status(400).json({
        message: "decision is required",
        success: false,
        errorCode: "MISSING_FIELDS",
      });
    }

    const data = await recordDuplicateDecision({
      userId: req.userId,
      receiptId: id,
      decision,
      duplicateOfReceiptId,
    });
    // Fire-and-log observability event for override-rate measurement.
    emitDuplicateDecisionEvent({ req, receiptId: id, decision, matchedReasonCode: null });
    return res.status(200).json({ message: "Duplicate decision recorded", success: true, data });
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    if (err && err.code === ERROR_CODES.INVALID_DECISION) {
      return res.status(400).json({
        message: 'decision must be one of "confirmed_new" or "linked_existing"',
        success: false,
        errorCode: ERROR_CODES.INVALID_DECISION,
      });
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { recordDuplicateDecisionController };
