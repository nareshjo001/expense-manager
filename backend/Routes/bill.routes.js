const express = require("express");

const router = express.Router();

const multer = require("multer");
const verifyToken = require("../Middlewares/Auth");
const upload = require("../Middlewares/upload").upload;
const { receiptLimiter } = require("../utils/rateLimiter");

const {
  uploadBill,
} = require("../Controllers/BillControllers/billController");

const handleBillUpload = (req, res, next) => {
  upload.single("bill")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const isTooLarge = err.code === "LIMIT_FILE_SIZE";
      return res.status(isTooLarge ? 413 : 400).json({
        success: false,
        code: isTooLarge ? "RECEIPT_FILE_TOO_LARGE" : "RECEIPT_UPLOAD_INVALID",
        message: isTooLarge ? "Receipt images must be 5 MB or smaller." : "Upload exactly one receipt image.",
      });
    }

    if (err && err.code === "INVALID_FILE_TYPE") {
      return res.status(415).json({
        success: false,
        code: "RECEIPT_UNSUPPORTED_FILE_TYPE",
        message: "Upload a JPEG or PNG receipt image.",
      });
    }

    if (err) {
      return next(err);
    }

    next();
  });
};

router.post(
  "/bill-upload",
  verifyToken,
  receiptLimiter || ((_req, _res, next) => next()),
  handleBillUpload,
  uploadBill
);

module.exports = router;
