"use strict";

// Intended route: GET /api/imports/sessions (verifyToken).
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
