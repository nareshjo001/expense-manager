// OCR-004-T03 -- Services/ReceiptServices/receiptIngestService.js.
//
// Exercised against jest.doMock'd stand-ins for every collaborator
// (validateReceiptFile/preprocessImage/extractTextFromImage/parseReceipt,
// this feature's own receiptStorageAdapter, and the Receipt model itself),
// the same fast no-real-Mongo/no-real-OCR pattern
// exportRequestService.test.js uses for exportGenerationService -- this
// suite proves the orchestration (what gets persisted, in what shape, the
// receiptPersistenceFailure/cleanup contract) rather than re-testing OCR
// parsing or GridFS itself, which are already covered by receiptParser's
// own tests and receiptStorageAdapter.test.js respectively.
"use strict";

const {
  RECEIPT_SCHEMA_VERSION,
  RECEIPT_REVIEW_STATUSES,
} = require("../utils/receiptLifecycle");

const IMAGE_PROCESSOR_PATH = "../Services/BillServices/imageProcessor";
const OCR_SERVICE_PATH = "../Services/BillServices/ocrService";
const RECEIPT_PARSER_PATH = "../Services/BillServices/receiptParser";
const RECEIPT_SECURITY_PATH = "../Services/BillServices/receiptSecurity.service";
const STORAGE_ADAPTER_PATH = "../Services/ReceiptServices/receiptStorageAdapter";
const RECEIPT_MODEL_PATH = "../models/Receipt";
const INGEST_SERVICE_PATH = "../Services/ReceiptServices/receiptIngestService";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

function baseParsedReceipt(overrides = {}) {
  return {
    expenseName: "Fresh Mart",
    expenseAmount: 125.5,
    expenseDate: "2026-01-15",
    overallConfidence: 92,
    fieldConfidence: { expenseName: 91, expenseAmount: 95, expenseDate: 88 },
    needsReview: false,
    reviewReasons: [],
    amountCandidates: [125.5],
    ...overrides,
  };
}

function makeFile(overrides = {}) {
  return {
    buffer: Buffer.from("ORIGINAL-BYTES"),
    mimetype: "image/png",
    size: 14,
    originalname: "receipt.png",
    ...overrides,
  };
}

// Loads receiptIngestService.js fresh with every collaborator mocked.
// Each mock function defaults to a "happy path" implementation and can be
// overridden per test via the matching *Impl option.
function loadService({
  validateImpl,
  preprocessImpl,
  extractImpl,
  parseImpl,
  putImpl,
  deleteImpl,
  createImpl,
} = {}) {
  jest.resetModules();

  const validateReceiptFile = jest.fn(
    validateImpl || (async () => ({ format: "png", width: 800, height: 1200 }))
  );
  // Returns a buffer that is deliberately NOT the same bytes as the
  // original upload, so tests can prove putReceiptObject is called with
  // the ORIGINAL buffer, not this one (see the "stores the original,
  // pre-OCR buffer" test below).
  const preprocessImage = jest.fn(preprocessImpl || (async () => Buffer.from("PROCESSED-FOR-OCR")));
  const extractTextFromImage = jest.fn(extractImpl || (async () => "raw ocr text"));
  const parseReceipt = jest.fn(parseImpl || (() => baseParsedReceipt()));
  const putReceiptObject = jest.fn(
    putImpl || (async () => ({ storageKey: "aaaaaaaaaaaaaaaaaaaaaaaa" }))
  );
  const deleteReceiptObject = jest.fn(deleteImpl || (async () => {}));
  const create = jest.fn(
    createImpl || (async (doc) => ({ ...doc, _id: "64f1a2b3c4d5e6f7a8b9c0ff" }))
  );

  jest.doMock(IMAGE_PROCESSOR_PATH, () => ({ preprocessImage }));
  jest.doMock(OCR_SERVICE_PATH, () => ({ extractTextFromImage }));
  jest.doMock(RECEIPT_PARSER_PATH, () => ({ parseReceipt }));
  jest.doMock(RECEIPT_SECURITY_PATH, () => ({ validateReceiptFile }));
  jest.doMock(STORAGE_ADAPTER_PATH, () => ({ putReceiptObject, deleteReceiptObject }));
  jest.doMock(RECEIPT_MODEL_PATH, () => ({ create }));

  const { ingestReceipt } = require(INGEST_SERVICE_PATH);

  return {
    ingestReceipt,
    mocks: { validateReceiptFile, preprocessImage, extractTextFromImage, parseReceipt, putReceiptObject, deleteReceiptObject, create },
  };
}

afterEach(() => {
  jest.dontMock(IMAGE_PROCESSOR_PATH);
  jest.dontMock(OCR_SERVICE_PATH);
  jest.dontMock(RECEIPT_PARSER_PATH);
  jest.dontMock(RECEIPT_SECURITY_PATH);
  jest.dontMock(STORAGE_ADAPTER_PATH);
  jest.dontMock(RECEIPT_MODEL_PATH);
  jest.resetModules();
});

describe("ingestReceipt happy path", () => {
  test("runs validate -> preprocess -> OCR -> parse -> store -> save, and returns both results", async () => {
    const { ingestReceipt, mocks } = loadService();
    const file = makeFile();

    const result = await ingestReceipt({ userId: USER_ID, file });

    expect(mocks.validateReceiptFile).toHaveBeenCalledWith(file);
    expect(mocks.preprocessImage).toHaveBeenCalledWith(file.buffer);
    expect(mocks.extractTextFromImage).toHaveBeenCalledWith(Buffer.from("PROCESSED-FOR-OCR"));
    expect(mocks.parseReceipt).toHaveBeenCalledWith("raw ocr text");

    expect(result.parsedReceipt).toEqual(baseParsedReceipt());
    expect(result.receiptId).toBe("64f1a2b3c4d5e6f7a8b9c0ff");
  });

  test("stores the ORIGINAL upload buffer in GridFS, never the pre-processed OCR copy", async () => {
    const { ingestReceipt, mocks } = loadService();
    const file = makeFile();

    await ingestReceipt({ userId: USER_ID, file });

    expect(mocks.putReceiptObject).toHaveBeenCalledWith(file.buffer, {
      contentType: file.mimetype,
      filename: file.originalname,
    });
    // The processed buffer imageProcessor.js produced must never be what
    // gets persisted.
    const [storedBuffer] = mocks.putReceiptObject.mock.calls[0];
    expect(storedBuffer.equals(Buffer.from("PROCESSED-FOR-OCR"))).toBe(false);
    expect(storedBuffer.equals(file.buffer)).toBe(true);
  });

  test("creates the Receipt document with the exact contracted shape", async () => {
    const { ingestReceipt, mocks } = loadService();
    const file = makeFile();

    await ingestReceipt({ userId: USER_ID, file });

    expect(mocks.create).toHaveBeenCalledWith({
      userId: USER_ID,
      storageKey: "aaaaaaaaaaaaaaaaaaaaaaaa",
      mimeType: file.mimetype,
      sizeBytes: file.buffer.length,
      width: 800,
      height: 1200,
      extractedFields: baseParsedReceipt(),
      extractedFieldsSchemaVersion: RECEIPT_SCHEMA_VERSION,
      reviewStatus: RECEIPT_REVIEW_STATUSES.REVIEWED,
      // OCR-005 -- sha256("ORIGINAL-BYTES"), computed independently here
      // (not imported from duplicateDetectionRules.js) so this assertion
      // would actually catch a regression in either module, not just
      // agree with whatever the production code currently does.
      contentHash: "261d8dcf677758b9d99909ea7fdd52eb2a5f06422e62383f90f9f992e448fd85",
      duplicateSignature: {
        normalizedMerchant: "fresh mart",
        normalizedDate: "2026-01-15",
        amountCents: 12550,
      },
    });
  });

  test("derives reviewStatus = needs_review when parseReceipt says needsReview: true", async () => {
    const { ingestReceipt, mocks } = loadService({
      parseImpl: () => baseParsedReceipt({ needsReview: true, reviewReasons: ["NO_AMOUNT_FOUND"] }),
    });

    await ingestReceipt({ userId: USER_ID, file: makeFile() });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ reviewStatus: RECEIPT_REVIEW_STATUSES.NEEDS_REVIEW })
    );
  });

  test("derives reviewStatus = reviewed when parseReceipt says needsReview: false", async () => {
    const { ingestReceipt, mocks } = loadService({
      parseImpl: () => baseParsedReceipt({ needsReview: false }),
    });

    await ingestReceipt({ userId: USER_ID, file: makeFile() });

    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ reviewStatus: RECEIPT_REVIEW_STATUSES.REVIEWED })
    );
  });
});

describe("validation/OCR failures propagate unchanged", () => {
  test("a validateReceiptFile rejection propagates without touching storage or the Receipt model", async () => {
    const uploadError = Object.assign(new Error("bad file"), { code: "RECEIPT_UNSUPPORTED_FILE", status: 415 });
    const { ingestReceipt, mocks } = loadService({
      validateImpl: async () => { throw uploadError; },
    });

    await expect(ingestReceipt({ userId: USER_ID, file: makeFile() })).rejects.toBe(uploadError);
    expect(mocks.putReceiptObject).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.deleteReceiptObject).not.toHaveBeenCalled();
  });

  test("an OCR timeout propagates unchanged and is not marked as a persistence failure", async () => {
    const timeoutError = Object.assign(new Error("timed out"), { code: "OCR_PROCESSING_TIMEOUT" });
    const { ingestReceipt } = loadService({
      extractImpl: async () => { throw timeoutError; },
    });

    await expect(ingestReceipt({ userId: USER_ID, file: makeFile() })).rejects.toBe(timeoutError);
  });
});

describe("persistence failure handling", () => {
  test("a Receipt.create failure after a successful store marks receiptPersistenceFailure, attaches parsedReceipt, and best-effort cleans up the orphaned object", async () => {
    const dbError = new Error("Mongo write failed");
    const { ingestReceipt, mocks } = loadService({
      createImpl: async () => { throw dbError; },
    });

    let caught;
    try {
      await ingestReceipt({ userId: USER_ID, file: makeFile() });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(dbError);
    expect(caught.receiptPersistenceFailure).toBe(true);
    expect(caught.parsedReceipt).toEqual(baseParsedReceipt());
    expect(mocks.deleteReceiptObject).toHaveBeenCalledWith("aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  test("a putReceiptObject failure marks receiptPersistenceFailure but never attempts cleanup (nothing was stored)", async () => {
    const storageError = new Error("GridFS write failed");
    const { ingestReceipt, mocks } = loadService({
      putImpl: async () => { throw storageError; },
    });

    let caught;
    try {
      await ingestReceipt({ userId: USER_ID, file: makeFile() });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(storageError);
    expect(caught.receiptPersistenceFailure).toBe(true);
    expect(caught.parsedReceipt).toEqual(baseParsedReceipt());
    expect(mocks.deleteReceiptObject).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  test("a failing cleanup delete is swallowed -- the original DB error still propagates", async () => {
    const dbError = new Error("Mongo write failed");
    const cleanupError = new Error("GridFS delete also failed");
    const { ingestReceipt, mocks } = loadService({
      createImpl: async () => { throw dbError; },
      deleteImpl: async () => { throw cleanupError; },
    });

    let caught;
    try {
      await ingestReceipt({ userId: USER_ID, file: makeFile() });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBe(dbError);
    expect(caught.receiptPersistenceFailure).toBe(true);
    expect(mocks.deleteReceiptObject).toHaveBeenCalledTimes(1);
  });
});
