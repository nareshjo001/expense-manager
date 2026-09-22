"use strict";

// OCR-005-T04 -- GET /api/receipts/:id/duplicates. Thin wrapper around
// duplicateCandidateService.findDuplicateCandidates, which is
// ownership-scoped to req.userId. An empty `data` array is the normal
// "no duplicate candidates found" case, not an error -- still a 200.
const mongoose = require("mongoose");
const {
  findDuplicateCandidates,
  ERROR_CODES,
} = require("../../Services/ReceiptServices/duplicateCandidateService");

const NOT_FOUND_RESPONSE = { message: "Receipt not found", success: false };

const getReceiptDuplicatesController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const data = await findDuplicateCandidates({ userId: req.userId, receiptId: id });
    return res.status(200).json({ message: "Duplicate candidates", success: true, data });
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { getReceiptDuplicatesController };
