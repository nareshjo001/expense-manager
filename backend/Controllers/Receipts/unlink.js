"use strict";

// OCR-004-T04 -- POST /api/receipts/:id/unlink. Thin wrapper around
// receiptQueryService.unlinkReceiptFromExpense, which is idempotent --
// unlinking an already-unlinked receipt still 200s.
const mongoose = require("mongoose");
const { unlinkReceiptFromExpense, ERROR_CODES } = require("../../Services/ReceiptServices/receiptQueryService");

const NOT_FOUND_RESPONSE = { message: "Receipt not found", success: false };

const unlinkReceiptController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const data = await unlinkReceiptFromExpense({ userId: req.userId, receiptId: id });
    return res.status(200).json({ message: "Receipt unlinked", success: true, data });
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { unlinkReceiptController };
