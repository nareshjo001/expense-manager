const express = require("express");

const router = express.Router();

const upload = require("../Middlewares/upload").upload;

const {
  uploadBill,
} = require("../Controllers/BillControllers/billController");


router.post(
  "/bill-upload",
  upload.single("bill"),
  uploadBill
);

module.exports = router;