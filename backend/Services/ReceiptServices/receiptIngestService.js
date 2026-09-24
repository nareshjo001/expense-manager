"use strict";

// OCR-004-T03 -- orchestrates the full durable-receipt pipeline for one
// validated upload. Reuses OCR-003's existing validate/preprocess/OCR/
// parse steps as-is (this module owns none of that logic) and adds the two
// steps OCR-004 introduces on top: writing the image to durable storage
// (receiptStorageAdapter.js -- the only module that touches GridFS
// directly) and creating the Receipt document that indexes it. Shaped
// like Services/ExportServices/exportRequestService.js: a thin
// orchestration service wrapping lower-level pieces, returning a plain
// result object, with failures marked via `.code`/custom flags on a plain
// Error rather than a bespoke exception hierarchy.
const { preprocessImage } = require("../BillServices/imageProcessor");
const { extractTextFromImage } = require("../BillServices/ocrService");
const { parseReceipt } = require("../BillServices/receiptParser");
const { validateReceiptFile } = require("../BillServices/receiptSecurity.service");
const { putReceiptObject, deleteReceiptObject } = require("./receiptStorageAdapter");
const { RECEIPT_SCHEMA_VERSION, deriveInitialReviewStatus } = require("../../utils/receiptLifecycle");
// OCR-005-T02/T03 -- computed once, here, at the single write path that
// creates a Receipt document, so every stored document's contentHash/
// duplicateSignature is derived the exact same way (see
// duplicateDetectionRules.js's own header comment for why both signals
// exist and what each one is for).
const { computeContentHash, buildDuplicateSignature } = require("../../utils/duplicateDetectionRules");

// Required lazily (see receiptStorageAdapter.js's own comment on
// getMongoose() for the full reasoning) -- models/Receipt.js itself
// requires Mongoose at its top level, so requiring it eagerly here would
// mean importing this service module always pays Mongoose's module-load
// cost, even for a request that never gets past validation. Deferred to
// first actual use, inside the persistence step below.
let ReceiptModel = null;
function getReceiptModel() {
  if (!ReceiptModel) {
    ReceiptModel = require("../../models/Receipt");
  }
  return ReceiptModel;
}

// Runs the full pipeline for `file` (a multer memory-storage file object:
// { buffer, mimetype, size, originalname, ... }) uploaded by `userId`, and
// returns { parsedReceipt, receiptId }.
//
// Storage choice (a real product tradeoff, not an incidental detail): the
// ORIGINAL validated buffer (`file.buffer`) is what gets persisted to
// GridFS below, never the pre-processed one preprocessImage() produces.
// preprocessImage() resizes/grayscales/normalizes/sharpens the image
// purely to make Tesseract's OCR pass more accurate -- it is tuned for a
// machine reader, not a human one, and would be a visually-degraded,
// resized stand-in for "what my receipt actually looks like" the first
// time a user opens it from their inbox later to double check a figure or
// attach it as evidence. The original is the canonical record; the
// processed copy is a disposable OCR input this pipeline never stores.
async function ingestReceipt({ userId, file }) {
  // Step 1-4: identical to the pre-OCR-004 flow in billController.js,
  // just relocated here. validateReceiptFile() throws ReceiptUploadError
  // on failure and extractTextFromImage()/the OCR layer can throw its own
  // OCR_PROCESSING_TIMEOUT-coded error -- both propagate unchanged, since
  // neither is a persistence failure and both must still fail the request
  // exactly as they did before this feature existed.
  const { width, height } = await validateReceiptFile(file);
  const processedImage = await preprocessImage(file.buffer);
  const ocrResult = await extractTextFromImage(processedImage);
  const parsedReceipt = parseReceipt(ocrResult);

  // Step 5-6: the new, OCR-004 persistence steps. Kept in their own
  // try/catch so a failure here -- and ONLY here -- can be tagged
  // `receiptPersistenceFailure` and handed back with the already-computed
  // parsedReceipt attached, letting billController.js make the product
  // decision (see its own comment) to still return the OCR result to the
  // user rather than fail the whole upload over the new inbox-persistence
  // step breaking.
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
      // OCR-005 -- hashed from the same original `file.buffer` persisted
      // to GridFS above (not the preprocessed OCR input), and derived
      // from this same parsedReceipt so the signature always matches what
      // extractedFields actually says.
      contentHash: computeContentHash(file.buffer),
      duplicateSignature: buildDuplicateSignature(parsedReceipt),
    });

    return { parsedReceipt, receiptId: String(receiptDoc._id) };
  } catch (persistErr) {
    // If the GridFS write above already succeeded (storageKey is set) but
    // the Receipt document write failed, the GridFS object is now
    // orphaned -- nothing in Receipt points at it and nothing else will
    // ever clean it up. Best-effort delete it so a broken Mongo write
    // does not also leak storage. This cleanup is explicitly secondary:
    // if it ALSO fails, swallow that second error so the original
    // persistErr -- the thing that actually needs to be logged and acted
    // on -- is what propagates, not a confusing "cleanup of a cleanup"
    // error that hides the real failure.
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
