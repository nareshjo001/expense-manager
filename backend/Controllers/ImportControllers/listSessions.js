"use strict";

// IMP-001-T04 -- intended route: GET /api/imports/sessions (verifyToken).
// Lightweight list (no `rows`, just rowCount) of this user's own
// ImportSessions, newest first.
const { listImportSessionsSafeShape } = require("../../Services/ImportServices/importSessionService");

const listImportSessionsController = async (req, res) => {
  try {
    const data = await listImportSessionsSafeShape({ userId: req.userId });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = { listImportSessionsController };
