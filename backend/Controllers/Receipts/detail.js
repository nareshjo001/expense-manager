"use strict";

// OCR-004-T04 -- GET /api/receipts/:id. Thin wrapper around
// receiptQueryService.getReceiptDetail, which scopes the lookup to BOTH
// the receipt id AND req.userId -- so fetching another user's receipt
// here always 404s, the same generic "not found" a nonexistent id gets
// (see that service function's own comment: it deliberately never
// distinguishes the two). Mirrors Controllers/Export/status.js's own
// malformed-id short-circuit.
const mongoose = require("mongoose");
const { getReceiptDetail, ERROR_CODES } = require("../../Services/ReceiptServices/receiptQueryService");

const NOT_FOUND_RESPONSE = { message: "Receipt not found", success: false };

const getReceiptDetailController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const data = await getReceiptDetail({ userId: req.userId, receiptId: id });
    return res.status(200).json({ message: "Success", success: true, data });
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { getReceiptDetailController };
