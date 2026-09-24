"use strict";

// OCR-004-T04 -- DELETE /api/receipts/:id. Thin wrapper around
// receiptQueryService.deleteReceipt, which deletes the GridFS blob via the
// storage adapter FIRST and only removes the Mongo document once that
// succeeds (see that service function's own comment).
const mongoose = require("mongoose");
const { deleteReceipt, ERROR_CODES } = require("../../Services/ReceiptServices/receiptQueryService");

const NOT_FOUND_RESPONSE = { message: "Receipt not found", success: false };

const deleteReceiptController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const data = await deleteReceipt({ userId: req.userId, receiptId: id });
    return res.status(200).json({ message: "Receipt deleted", success: true, data });
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { deleteReceiptController };
