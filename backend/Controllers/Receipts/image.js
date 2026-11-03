"use strict";

// GET /api/receipts/:id/image. js is the only module allowed to).
const mongoose = require("mongoose");
const { getReceiptImageRef, ERROR_CODES } = require("../../Services/ReceiptServices/receiptQueryService");

const NOT_FOUND_RESPONSE = { message: "Receipt not found", success: false };

const getReceiptImageController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const { storageKey, mimeType } = await getReceiptImageRef({ userId: req.userId, receiptId: id });

    let stream;
    try {
      const { getReceiptObjectStream } = require("../../Services/ReceiptServices/receiptStorageAdapter");
      stream = await getReceiptObjectStream(storageKey);
    } catch (streamErr) {
      // The DB record says this receipt exists but the blob itself couldn't be opened (already swept, never written, adapter error) -- same generic 404 as any other unresolvable receipt, never a 500 that would hint the record itself was valid.
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    if (!stream || typeof stream.pipe !== "function") {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    res.setHeader("Content-Type", mimeType);

    let responded = false;
    stream.on("error", () => {
      if (!res.headersSent && !responded) {
        responded = true;
        res.status(404).json(NOT_FOUND_RESPONSE);
      } else {
        res.end();
      }
    });

    return stream.pipe(res);
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { getReceiptImageController };
