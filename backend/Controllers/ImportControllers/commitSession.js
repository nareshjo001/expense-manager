"use strict";

// POST /api/imports/sessions/:id/commit. js already uses).
const mongoose = require("mongoose");
const {
  commitImportSession,
  ERROR_CODES,
} = require("../../Services/ImportServices/importCommitService");

const NOT_FOUND_RESPONSE = {
  success: false,
  message: "Import session not found.",
  errorCode: ERROR_CODES.NOT_FOUND,
};

const commitImportSessionController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const data = await commitImportSession({ userId: req.userId, sessionId: id });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    if (err && err.code === ERROR_CODES.NOT_FOUND) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    if (err && err.code === ERROR_CODES.ALREADY_COMMITTING) {
      return res.status(409).json({
        success: false,
        message: "This import session is already being committed.",
        errorCode: ERROR_CODES.ALREADY_COMMITTING,
      });
    }
    if (err && err.code === ERROR_CODES.SESSION_EXPIRED) {
      return res.status(410).json({
        success: false,
        message: "This import session has expired.",
        errorCode: ERROR_CODES.SESSION_EXPIRED,
      });
    }

    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = { commitImportSessionController };
