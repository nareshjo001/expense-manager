"use strict";

// IMP-001-T03/T04 -- multer memory-storage config for CSV import
// uploads, same convention as Middlewares/upload.js (receipt images):
// memoryStorage (every upload in this app is buffer-in-memory, never
// disk -- see csvStreamParser.js's own header comment), a fileFilter
// that tags a rejected file with error.code = "INVALID_FILE_TYPE" so the
// route layer can turn it into a clean 415 the same way
// Routes/bill.routes.js's handleBillUpload already does for receipts,
// and limits.fileSize pinned to this feature's own MAX_IMPORT_FILE_BYTES
// (importTypes.js) rather than the receipt upload's 5MB.
//
// Not reusing Middlewares/upload.js itself: it's hard-coded to
// image/jpeg|png and `fields: 0` (rejects any non-file field), which
// would reject createSession's own "columnMapping" text field. Two
// exports here instead: `importHeadersUpload` (file only, mirrors
// upload.js's own fields:0) for POST /api/imports/headers, and
// `importSessionUpload` (file + one extra field) for
// POST /api/imports/sessions.
const multer = require("multer");
const { MAX_IMPORT_FILE_BYTES } = require("../utils/importTypes");

const ALLOWED_CSV_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "text/plain",
];

const fileFilter = (req, file, cb) => {
  if (ALLOWED_CSV_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    const error = new Error("Only CSV files are allowed.");
    error.code = "INVALID_FILE_TYPE";
    cb(error, false);
  }
};

const importHeadersUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: MAX_IMPORT_FILE_BYTES,
    files: 1,
    fields: 0,
  },
});

const importSessionUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: MAX_IMPORT_FILE_BYTES,
    files: 1,
    fields: 1,
  },
});

module.exports = { importHeadersUpload, importSessionUpload };
