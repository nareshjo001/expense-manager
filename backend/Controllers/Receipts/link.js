"use strict";

// OCR-004-T04 -- POST /api/receipts/:id/link. Body: { expenseId }. Thin
// wrapper around receiptQueryService.linkReceiptToExpense, which enforces
// ownership on BOTH the receipt and the target expense (see that
// function's own comment).
const mongoose = require("mongoose");
const { linkReceiptToExpense, ERROR_CODES } = require("../../Services/ReceiptServices/receiptQueryService");

const NOT_FOUND_RESPONSE = { message: "Receipt not found", success: false };

// Maps a thrown service error's `.code` to a response message. Only the
// two error codes linkReceiptToExpense can throw besides NOT_FOUND (which
// is handled separately, as a 404) are listed here.
const ERROR_MESSAGES = {
  [ERROR_CODES.EXPENSE_NOT_FOUND]: "expenseId does not refer to one of your expenses",
  [ERROR_CODES.ALREADY_LINKED_TO_ANOTHER_EXPENSE]:
    "This receipt is already linked to a different expense. Unlink it first.",
};

const linkReceiptController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const { expenseId } = req.body || {};
    if (!expenseId) {
      return res.status(400).json({
        message: "expenseId is required",
        success: false,
        errorCode: "MISSING_FIELDS",
      });
    }

    const data = await linkReceiptToExpense({ userId: req.userId, receiptId: id, expenseId });
    return res.status(200).json({ message: "Receipt linked", success: true, data });
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

module.exports = { linkReceiptController };
