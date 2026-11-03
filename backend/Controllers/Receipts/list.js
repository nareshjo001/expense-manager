"use strict";

// GET /api/receipts. linked=true|false.
const { listReceipts, ERROR_CODES } = require("../../Services/ReceiptServices/receiptQueryService");

// Maps a thrown service error's `.code` to a response message, matching
// Controllers/Export/create.js's own ERROR_MESSAGES convention.
const ERROR_MESSAGES = {
  [ERROR_CODES.INVALID_REVIEW_STATUS_FILTER]: "reviewStatus must be one of: needs_review, reviewed",
};

// Linked= query param into true/false/undefined.
function parseLinkedFilter(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

const listReceiptsController = async (req, res) => {
  try {
    const query = req.query || {};
    const reviewStatus = query.reviewStatus !== undefined ? query.reviewStatus : undefined;
    const linked = parseLinkedFilter(query.linked);

    const data = await listReceipts({ userId: req.userId, reviewStatus, linked });
    return res.status(200).json({ message: "Success", success: true, data });
  } catch (err) {
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

module.exports = { listReceiptsController };
