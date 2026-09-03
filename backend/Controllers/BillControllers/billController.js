const { preprocessImage } = require("../../Services/BillServices/imageProcessor");
const { extractTextFromImage } = require("../../Services/BillServices/ocrService");
const { parseReceipt } = require("../../Services/BillServices/receiptParser");
const {
  ReceiptUploadError,
  emitReceiptAuditEvent,
  validateReceiptFile,
} = require("../../Services/BillServices/receiptSecurity.service");

const uploadBill = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: "RECEIPT_FILE_REQUIRED",
        message: "Select a receipt image to upload.",
      });
    }

    await validateReceiptFile(req.file);
    const processedImage = await preprocessImage(req.file.buffer);
    const extractedText = await extractTextFromImage(processedImage);
    const parsedReceipt = parseReceipt(extractedText);
    emitReceiptAuditEvent({ req, outcome: "success", code: "RECEIPT_PROCESSED" });

    return res.status(200).json({
      success: true,
      message: "Receipt processed successfully.",
      parsedReceipt,
    });
  } catch (error) {
    if (error instanceof ReceiptUploadError) {
      emitReceiptAuditEvent({ req, outcome: "rejected", code: error.code });
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
      });
    }

    if (error.code === "OCR_PROCESSING_TIMEOUT") {
      emitReceiptAuditEvent({ req, outcome: "timeout", code: error.code });
      return res.status(504).json({
        success: false,
        code: error.code,
        message: "Receipt processing took too long. Please try another image.",
      });
    }

    emitReceiptAuditEvent({ req, outcome: "failed", code: "OCR_PROCESSING_FAILED" });
    return res.status(422).json({
      success: false,
      code: "OCR_PROCESSING_FAILED",
      message: "The receipt image could not be processed.",
    });
  }
};

module.exports = {
  uploadBill,
};
