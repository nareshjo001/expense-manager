"use strict";

// Orchestrates the full durable-receipt pipeline for one validated upload.
const { preprocessImage } = require("../BillServices/imageProcessor");
const { extractTextFromImage } = require("../BillServices/ocrService");
const { parseReceipt } = require("../BillServices/receiptParser");
const { validateReceiptFile } = require("../BillServices/receiptSecurity.service");
const { putReceiptObject, deleteReceiptObject } = require("./receiptStorageAdapter");
const { RECEIPT_SCHEMA_VERSION, deriveInitialReviewStatus } = require("../../utils/receiptLifecycle");
// Js's own header comment for why both signals exist and what each one is for).
const { computeContentHash, buildDuplicateSignature } = require("../../utils/duplicateDetectionRules");

// Js itself requires Mongoose at its top level, so requiring it eagerly here would mean importing this service module always pays Mongoose's module-load cost, even for a request that never gets past validation.
let ReceiptModel = null;
function getReceiptModel() {
  if (!ReceiptModel) {
    ReceiptModel = require("../../models/Receipt");
  }
  return ReceiptModel;
}

// Runs the full pipeline for `file` (a multer memory-storage file object: { buffer, mimetype, size, originalname, ...
async function ingestReceipt({ userId, file }) {
  // Js, just relocated here. validateReceiptFile() throws ReceiptUploadError on failure and extractTextFromImage()/the OCR layer can throw its o.
  const { width, height } = await validateReceiptFile(file);
  const processedImage = await preprocessImage(file.buffer);
  const ocrResult = await extractTextFromImage(processedImage);
  const parsedReceipt = parseReceipt(ocrResult);

  // Step 5-6: the new, OCR-004 persistence steps.
  let storageKey = null;
  try {
    const stored = await putReceiptObject(file.buffer, {
      contentType: file.mimetype,
      filename: file.originalname || "receipt",
    });
    storageKey = stored.storageKey;

    const receiptDoc = await getReceiptModel().create({
      userId,
      storageKey,
      mimeType: file.mimetype,
      sizeBytes: file.buffer.length,
      width,
      height,
      extractedFields: parsedReceipt,
      extractedFieldsSchemaVersion: RECEIPT_SCHEMA_VERSION,
      reviewStatus: deriveInitialReviewStatus(parsedReceipt),
      // Buffer` persisted to GridFS above (not the preprocessed OCR input), and derived from this same parsedReceipt so the signature always matches what extractedFields actually says.
      contentHash: computeContentHash(file.buffer),
      duplicateSignature: buildDuplicateSignature(parsedReceipt),
    });

    return { parsedReceipt, receiptId: String(receiptDoc._id) };
  } catch (persistErr) {
    // If the GridFS write above already succeeded (storageKey is set) but the Receipt document write failed, the GridFS object is now orphaned -- nothing in Receipt points at it and nothing else will ever clean it up.
    if (storageKey) {
      try {
        await deleteReceiptObject(storageKey);
      } catch {
        // best-effort only -- see comment above.
      }
    }

    const err = persistErr instanceof Error ? persistErr : new Error(String(persistErr));
    err.receiptPersistenceFailure = true;
    err.parsedReceipt = parsedReceipt;
    throw err;
  }
}

module.exports = {
  ingestReceipt,
};
