"use strict";

// IMP-001-T03/T04 -- intended route: POST /api/imports/headers
// (verifyToken, multipart upload, field name "file", multer memory
// storage -- see Middlewares/importUpload.js). Lets the frontend show the
// user's own CSV columns and a best-effort suggested mapping BEFORE any
// ImportSession is created.
const {
  previewImportHeaders,
  ERROR_CODES,
} = require("../../Services/ImportServices/importSessionService");

// Every code previewImportHeaders can throw is a client input problem
// (oversized file, empty/malformed/too-large CSV) -- all 400s.
const ERROR_STATUS_MAP = Object.freeze({
  [ERROR_CODES.FILE_TOO_LARGE]: 400,
  [ERROR_CODES.EMPTY_FILE]: 400,
  [ERROR_CODES.TOO_MANY_ROWS]: 400,
  [ERROR_CODES.MALFORMED_ROW]: 400,
});

const previewImportHeadersController = async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: "A CSV file is required.",
        errorCode: "FILE_REQUIRED",
      });
    }

    const { headerRow, suggestedMapping } = await previewImportHeaders({ fileBuffer: req.file.buffer });
    return res.status(200).json({ success: true, headerRow, suggestedMapping });
  } catch (err) {
    const status = ERROR_STATUS_MAP[err && err.code];
    if (status) {
      return res.status(status).json({ success: false, message: err.message, errorCode: err.code });
    }
    console.error(err);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

module.exports = { previewImportHeadersController };
