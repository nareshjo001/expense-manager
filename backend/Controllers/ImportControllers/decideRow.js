"use strict";

// Intended route: PATCH /api/imports/sessions/:id/rows/:rowIndex (verifyToken).
const mongoose = require("mongoose");
const {
  decideImportRow,
  ERROR_CODES,
} = require("../../Services/ImportServices/importSessionService");

const decideImportRowController = async (req, res) => {
  try {
    const { id, rowIndex } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ success: false, message: "Import session not found.", errorCode: ERROR_CODES.NOT_FOUND });
    }

    const { decision } = req.body || {};

    const data = await decideImportRow({
      userId: req.userId,
      sessionId: id,
      rowIndex: Number(rowIndex),
      decision,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json({ success: false, message: err.message, errorCode: err.code });
    }
    if (err && err.code === ERROR_CODES.SESSION_NOT_PREVIEWING) {
      return res.status(409).json({ success: false, message: err.message, errorCode: err.code });
    }
    if (err && err.code === ERROR_CODES.ROW_NOT_FOUND) {
      return res.status(404).json({ success: false, message: err.message, errorCode: err.code });
    }
    if (err && err.code === ERROR_CODES.INVALID_DECISION) {
      return res.status(400).json({ success: false, message: err.message, errorCode: err.code });
    }
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = { decideImportRowController };
