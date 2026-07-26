const express = require("express");

const router = express.Router();

const multer = require("multer");
const verifyToken = require("../Middlewares/Auth");
const upload = require("../Middlewares/upload").upload;

const {
  uploadBill,
} = require("../Controllers/BillControllers/billController");

// Report upload validation failures as client errors.
const handleBillUpload = (req, res, next) => {
  upload.single("bill")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: err.message });
    }

    if (err && err.code === "INVALID_FILE_TYPE") {
      return res.status(400).json({ success: false, message: err.message });
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
  handleBillUpload,
  uploadBill
);

module.exports = router;
