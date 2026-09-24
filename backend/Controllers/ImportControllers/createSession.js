"use strict";

// IMP-001-T04 -- intended route: POST /api/imports/sessions
// (verifyToken, multipart upload: file field "file" + a "columnMapping"
// field carrying a JSON-stringified object -- see
// Middlewares/importUpload.js). Parses/validates every row, enriches
// with T05's duplicate/category suggestions, and persists the preview
// ImportSession.
const {
  createImportSessionPreview,
  ERROR_CODES,
} = require("../../Services/ImportServices/importSessionService");

// Every code createImportSessionPreview can throw is a client input
// problem -- all 400s.
const ERROR_STATUS_MAP = Object.freeze({
  [ERROR_CODES.FILE_TOO_LARGE]: 400,
  [ERROR_CODES.INVALID_MAPPING]: 400,
  [ERROR_CODES.EMPTY_FILE]: 400,
  [ERROR_CODES.TOO_MANY_ROWS]: 400,
  [ERROR_CODES.MALFORMED_ROW]: 400,
});

const createImportSessionController = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: "A CSV file is required.",
        errorCode: "FILE_REQUIRED",
      });
    }

    let columnMapping;
    try {
      columnMapping = JSON.parse(req.body && req.body.columnMapping);
    } catch (parseErr) {
      return res.status(400).json({
        success: false,
        message: "columnMapping must be a JSON-stringified object.",
        errorCode: ERROR_CODES.INVALID_MAPPING,
      });
    }

    const data = await createImportSessionPreview({
      userId: req.userId,
      originalFilename: req.file.originalname || null,
      fileBuffer: req.file.buffer,
      columnMapping,
    });
    return res.status(201).json({ success: true, data });
  } catch (err) {
    const status = ERROR_STATUS_MAP[err && err.code];
    if (status) {
      return res.status(status).json({ success: false, message: err.message, errorCode: err.code });
    }
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = { createImportSessionController };
