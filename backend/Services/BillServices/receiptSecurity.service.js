const sharp = require("sharp");
const { fingerprint } = require("../AuthServices/security.service");

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const MAX_RECEIPT_PIXELS = 20_000_000;
const MAX_RECEIPT_DIMENSION = 10_000;

const SUPPORTED_RECEIPTS = Object.freeze({
  "image/jpeg": {
    format: "jpeg",
    matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  "image/png": {
    format: "png",
    matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
});

class ReceiptUploadError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const detectReceiptType = (buffer) => Object.entries(SUPPORTED_RECEIPTS)
  .find(([, definition]) => definition.matches(buffer));

const receiptError = (code, status, message) => new ReceiptUploadError(code, status, message);

const validateReceiptFile = async (file) => {
  if (!file?.buffer?.length) {
    throw receiptError("RECEIPT_FILE_REQUIRED", 400, "Select a receipt image to upload.");
  }

  if (file.size > MAX_RECEIPT_BYTES || file.buffer.length > MAX_RECEIPT_BYTES) {
    throw receiptError("RECEIPT_FILE_TOO_LARGE", 413, "Receipt images must be 5 MB or smaller.");
  }

  const detected = detectReceiptType(file.buffer);
  if (!detected) {
    throw receiptError("RECEIPT_UNSUPPORTED_FILE", 415, "Upload a valid JPEG or PNG receipt image.");
  }

  const [detectedMime, definition] = detected;
  if (file.mimetype !== detectedMime) {
    throw receiptError("RECEIPT_MIME_MISMATCH", 415, "Upload a valid JPEG or PNG receipt image.");
  }

  let metadata;
  try {
    metadata = await sharp(file.buffer, { limitInputPixels: MAX_RECEIPT_PIXELS }).metadata();
  } catch (error) {
    if (/pixel limit|too many pixels/i.test(error.message)) {
      throw receiptError("RECEIPT_IMAGE_TOO_LARGE", 413, "Receipt image dimensions are too large.");
    }

    throw receiptError("RECEIPT_IMAGE_INVALID", 422, "The receipt image could not be read.");
  }

  if (metadata.format !== definition.format || !metadata.width || !metadata.height) {
    throw receiptError("RECEIPT_IMAGE_INVALID", 422, "The receipt image could not be read.");
  }

  if (metadata.width > MAX_RECEIPT_DIMENSION || metadata.height > MAX_RECEIPT_DIMENSION) {
    throw receiptError("RECEIPT_IMAGE_TOO_LARGE", 413, "Receipt image dimensions are too large.");
  }

  if (metadata.width * metadata.height > MAX_RECEIPT_PIXELS || (metadata.pages && metadata.pages > 1)) {
    throw receiptError("RECEIPT_IMAGE_TOO_LARGE", 413, "Receipt image dimensions are too large.");
  }

  return { format: metadata.format, width: metadata.width, height: metadata.height };
};

const emitReceiptAuditEvent = ({ req, outcome, code }) => {
  console.info(JSON.stringify({
    type: "receipt_security_event",
    featureId: "OCR-001",
    outcome,
    code,
    userHash: fingerprint(req?.userId),
    requestId: String(req?.get?.("X-Request-ID") || "").slice(0, 128) || undefined,
    occurredAt: new Date().toISOString(),
  }));
};

module.exports = {
  MAX_RECEIPT_BYTES,
  MAX_RECEIPT_DIMENSION,
  MAX_RECEIPT_PIXELS,
  ReceiptUploadError,
  emitReceiptAuditEvent,
  validateReceiptFile,
};
