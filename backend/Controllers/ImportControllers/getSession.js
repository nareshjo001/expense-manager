"use strict";

// IMP-001-T04 -- intended route: GET /api/imports/sessions/:id
// (verifyToken). Ownership-scoped -- a session belonging to another user
// 404s exactly the same as a nonexistent one (see
// getImportSessionSafeShape's own contract).
const mongoose = require("mongoose");
const { getImportSessionSafeShape } = require("../../Services/ImportServices/importSessionService");

const NOT_FOUND_RESPONSE = { success: false, message: "Import session not found.", errorCode: "NOT_FOUND" };

const getImportSessionController = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }

    const data = await getImportSessionSafeShape({ userId: req.userId, sessionId: id });
    if (!data) {
      return res.status(404).json(NOT_FOUND_RESPONSE);
    }
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = { getImportSessionController };
