"use strict";

// OCR-004-T04 -- POST /api/receipts/:id/reviewed. Optional body:
// { corrections: { expenseName?, expenseAmount?, expenseDate? } }. Thin
// wrapper around receiptQueryService.markReceiptReviewed.
const mongoose = require("mongoose");
const { markReceiptReviewed, ERROR_CODES } = require("../../Services/ReceiptServices/receiptQueryService");

const NOT_FOUND_RESPONSE = { message: "Receipt not found", success: false };

const ERROR_MESSAGES = {
  [ERROR_CODES.INVALID_CORRECTION]:
    "corrections.expenseAmount must be a positive number and corrections.expenseDate must be a valid date",
};

const markReceiptReviewedController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const corrections = (req.body || {}).corrections;

    const data = await markReceiptReviewed({ userId: req.userId, receiptId: id, corrections });
    return res.status(200).json({ message: "Receipt marked reviewed", success: true, data });
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    if (err && err.code && ERROR_MESSAGES[err.code]) {
      return res.status(400).json({
        message: ERROR_MESSAGES[err.code],
        success: false,
        errorCode: err.code,
      });
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { markReceiptReviewedController };
