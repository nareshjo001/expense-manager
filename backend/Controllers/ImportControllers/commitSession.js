"use strict";

// IMP-001-T06 -- POST /api/imports/sessions/:id/commit. Thin HTTP wrapper
// around importCommitService.commitImportSession, which is
// ownership-scoped to req.userId (set by the verifyToken middleware, same
// convention Controllers/Receipts/duplicates.js already uses). All the
// actual commit/idempotency/concurrency logic lives in the service; this
// controller only maps its ERROR_CODES to HTTP status codes and shapes
// the JSON envelope.
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
