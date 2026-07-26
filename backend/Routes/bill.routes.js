const express = require("express");

const router = express.Router();

const multer = require("multer");
const verifyToken = require("../Middlewares/Auth");
const upload = require("../Middlewares/upload").upload;

const {
  uploadBill,
} = require("../Controllers/BillControllers/billController");

// Wrap multer so upload-specific errors (wrong file type, oversized file)
// report as 400 — they're client input errors — instead of falling through
// to the global error handler's generic 500 default. Any other error (a
// real server-side failure) is passed to next(err) unchanged, so
// Middlewares/error.middleware.js's existing behavior for every other
// route in the app is untouched. Response shape matches every other error
// response in this module: { success: false, message }.
const handleBillUpload = (req, res, next) => {
  upload.single("bill")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      // e.g. LIMIT_FILE_SIZE -> "File too large"
      return res.status(400).json({ success: false, message: err.message });
    }

    if (err && err.code === "INVALID_FILE_TYPE") {
      // fileFilter's rejection (wrong MIME type) — see Middlewares/upload.js
      return res.status(400).json({ success: false, message: err.message });
    }

    if (err) {
      // Any other error (e.g. a genuine disk I/O failure) is not a client
      // input problem — pass it through unchanged so the existing global
      // error handler continues to return 500 for it, exactly as before.
      return next(err);
    }

    next();
  });
};

router.post(
  "/bill-upload",
  verifyToken,
  handleBillUpload,
  uploadBill
);

module.exports = router;
