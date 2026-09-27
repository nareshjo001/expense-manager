const {
  ReceiptUploadError,
  emitReceiptAuditEvent,
} = require("../../Services/BillServices/receiptSecurity.service");
const { ingestReceipt } = require("../../Services/ReceiptServices/receiptIngestService");

const uploadBill = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        code: "RECEIPT_FILE_REQUIRED",
        message: "Select a receipt image to upload.",
      });
    }

    // OCR-004: ingestReceipt() now runs the full validate -> preprocess ->
    // OCR -> parse pipeline (unchanged from before this feature -- see
    // Services/ReceiptServices/receiptIngestService.js) AND the two new
    // persistence steps this feature adds (GridFS write + Receipt
    // document). Only the persistence half is allowed to degrade the
    // response rather than fail it outright -- see the catch below.
    let parsedReceipt;
    let receiptId = null;

    try {
      const ingestResult = await ingestReceipt({ userId: req.userId, file: req.file });
      parsedReceipt = ingestResult.parsedReceipt;
      receiptId = ingestResult.receiptId;
    } catch (err) {
      // Product decision (OCR-004): a failure in the NEW inbox-persistence
      // step (the GridFS write or the Receipt document write) must not
      // turn an otherwise-successful OCR scan into a failed upload -- the
      // user still gets their parsed fields back and can go add their
      // expense; they just won't have this receipt saved to their inbox
      // this time. receiptIngestService.js marks exactly this case with
      // `.receiptPersistenceFailure` and attaches the already-computed
      // parsedReceipt to the error so it can still be returned here.
      // Anything else -- a validation failure (ReceiptUploadError) or an
      // OCR failure/timeout -- is NOT marked this way and falls through
      // to the outer catch below, failing the request exactly as it
      // always has.
      if (!err || !err.receiptPersistenceFailure) {
        throw err;
      }

      parsedReceipt = err.parsedReceipt;
      emitReceiptAuditEvent({ req, outcome: "persistence_failed", code: "RECEIPT_PERSIST_FAILED" });
    }

    emitReceiptAuditEvent({ req, outcome: "success", code: "RECEIPT_PROCESSED" });

    // OCR-003: parsedReceipt.needsReview (no amount found, or low overall
    // OCR confidence) does not change the HTTP outcome -- the upload and
    // OCR run genuinely succeeded -- but the message should not claim an
    // uncertain parse was a clean success. The client already gets the
    // full confidence detail (overallConfidence/fieldConfidence) to act
    // on regardless of this message.
    return res.status(200).json({
      success: true,
      message: parsedReceipt.needsReview
        ? "Receipt processed, but some fields may need a quick check before you save."
        : "Receipt processed successfully.",
      parsedReceipt,
      // OCR-004: null when persistence failed (see above) -- the client
      // can still show the parsed fields, it just has nothing to link an
      // inbox entry to for this upload.
      receiptId,
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
