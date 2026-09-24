// OCR-005-T07 -- integration-level "product story" tests for duplicate
// detection, exercised through the full findDuplicateCandidates() service
// call (Receipt model mocked, but the real duplicateCandidateService.js +
// utils/duplicateDetectionRules.js run end to end). This is deliberately
// separate from tests/duplicateCandidateService.test.js (that file already
// covers the service's mechanics with mocks in full) -- this file instead
// tells the three narrative scenarios T07 asks for, plus the two edge
// cases worth re-proving at the full-service level rather than only at
// the pure isProbableDuplicateMatch() level (already covered exhaustively
// by tests/duplicateDetectionRules.test.js).
//
// Same fast in-memory-fake-Receipt-model harness as
// tests/duplicateCandidateService.test.js and tests/receiptQueryService.test.js
// -- a chainable/thenable fake Query (find/findOne/select/lean) and a fake
// mongoose (ObjectId.isValid only), copied verbatim from that convention
// rather than inventing a new one.
"use strict";

const RECEIPT_MODEL_PATH = "../models/Receipt";

const USER_A = "64f1a2b3c4d5e6f7a8b9c0aa";
const USER_B = "64f1a2b3c4d5e6f7a8b9c0bb";

// Accepts a real 24-hex ObjectId OR this test file's own simple fixture
// ids (r1, r2, ...) -- but still rejects deliberately-malformed values,
// same convention duplicateCandidateService.test.js uses.
function isValidObjectId(id) {
  const s = String(id);
  return /^[0-9a-fA-F]{24}$/.test(s) || /^[a-zA-Z][a-zA-Z0-9]*$/.test(s);
}

function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = key.includes(".") ? key.split(".").reduce((o, k) => (o == null ? o : o[k]), doc) : doc[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      if ("$ne" in cond) {
        const target = cond.$ne;
        if (target === null) return value !== null && value !== undefined;
        return String(value) !== String(target);
      }
      return true;
    }
    if (cond === null) return value === null || value === undefined;
    return String(value) === String(cond);
  });
}

function leanify(raw) {
  if (raw === null || raw === undefined) return raw;
  if (Array.isArray(raw)) return raw.map((d) => ({ ...d }));
  return { ...raw };
}

function makeQuery(resultGetter) {
  let leanMode = false;
  const query = {
    select() {
      return query;
    },
    sort() {
      return query;
    },
    lean() {
      leanMode = true;
      return query;
    },
    then(resolve, reject) {
      const raw = resultGetter();
      const val = leanMode ? leanify(raw) : raw;
      return Promise.resolve(val).then(resolve, reject);
    },
    catch(reject) {
      return query.then(undefined, reject);
    },
  };
  return query;
}

function makeReceiptDoc(data) {
  const doc = { ...data };
  Object.defineProperty(doc, "save", {
    value: jest.fn(async function save() {
      return doc;
    }),
    enumerable: false,
  });
  Object.defineProperty(doc, "toObject", {
    value: () => ({ ...doc }),
    enumerable: false,
  });
  return doc;
}

function buildReceiptStore(seedDocs = []) {
  const state = seedDocs.map((d) => makeReceiptDoc(d));
  return {
    state,
    find: jest.fn((filter = {}) => makeQuery(() => state.filter((d) => matchesFilter(d, filter)))),
    findOne: jest.fn((filter = {}) => makeQuery(() => state.find((d) => matchesFilter(d, filter)) || null)),
  };
}

function loadService({ receipts = [] } = {}) {
  jest.resetModules();
  const receiptStore = buildReceiptStore(receipts);

  jest.doMock("mongoose", () => ({
    Types: { ObjectId: { isValid: (id) => isValidObjectId(String(id)) } },
  }));
  jest.doMock(RECEIPT_MODEL_PATH, () => receiptStore);
  // duplicateCandidateService.js requires receiptQueryService.js (for
  // toSafeShape), which in turn requires config/Schemas.js -- mock that
  // directly so the real mongoose Schema constructor is never touched
  // (same as duplicateCandidateService.test.js's own SCHEMAS_PATH mock).
  jest.doMock("../config/Schemas", () => ({ ExpenseModel: {} }));

  const service = require("../Services/ReceiptServices/duplicateCandidateService");
  return { service, receiptStore };
}

function receiptDoc(overrides = {}) {
  return {
    _id: "r1",
    userId: USER_A,
    storageKey: "gridfs-file-id-1",
    mimeType: "image/jpeg",
    sizeBytes: 12345,
    width: 800,
    height: 600,
    uploadedAt: new Date("2026-01-10T00:00:00.000Z"),
    extractedFields: {
      expenseName: "Cafe Nero",
      expenseAmount: 4.5,
      expenseDate: "10/01/2026",
      overallConfidence: 0.9,
      fieldConfidence: {},
      needsReview: false,
      reviewReasons: [],
      amountCandidates: [],
    },
    extractedFieldsSchemaVersion: 1,
    reviewStatus: "needs_review",
    reviewedAt: null,
    linkedExpenseId: null,
    linkedAt: null,
    contentHash: "hash-a",
    duplicateSignature: { normalizedMerchant: "cafe nero", normalizedDate: "10/01/2026", amountCents: 450 },
    duplicateStatus: "unreviewed",
    duplicateOfReceiptId: null,
    ...overrides,
  };
}

afterEach(() => {
  jest.resetModules();
});

describe("duplicate-detection product scenarios", () => {
  test("same-file: uploading identical bytes twice is reported as an EXACT_FILE_MATCH candidate", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", contentHash: "same-bytes-hash", uploadedAt: new Date("2026-01-10T00:00:00.000Z") }),
        receiptDoc({ _id: "r2", contentHash: "same-bytes-hash", uploadedAt: new Date("2026-01-11T00:00:00.000Z") }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r2" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ receiptId: "r1", reasonCode: "EXACT_FILE_MATCH" });
  });

  test("re-encoded: a re-saved/re-compressed photo of the same receipt (different bytes, same merchant/date/amount) is PROBABLE_MERCHANT_DATE_AMOUNT, not EXACT_FILE_MATCH", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", contentHash: "hash-original-jpeg", uploadedAt: new Date("2026-01-10T00:00:00.000Z") }),
        receiptDoc({
          _id: "r2",
          contentHash: "hash-recompressed-jpeg",
          uploadedAt: new Date("2026-01-11T00:00:00.000Z"),
        }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r2" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ receiptId: "r1", reasonCode: "PROBABLE_MERCHANT_DATE_AMOUNT" });
  });

  test("legitimate repeat: same coffee shop, same $4.50, a genuinely different day is NOT reported as any kind of duplicate", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", contentHash: "hash-visit-1", uploadedAt: new Date("2026-01-10T00:00:00.000Z") }),
        receiptDoc({
          _id: "r2",
          contentHash: "hash-visit-2",
          uploadedAt: new Date("2026-02-01T00:00:00.000Z"),
          duplicateSignature: { normalizedMerchant: "cafe nero", normalizedDate: "01/02/2026", amountCents: 450 },
        }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r2" });
    expect(candidates).toEqual([]);
  });

  test("an unreadable field (null amountCents) on the candidate's signature never matches, even against an otherwise-identical receipt, through the full service call", async () => {
    const { service } = loadService({
      receipts: [
        // Target: a fully-readable signature, so the probable-match query
        // runs (it's skipped entirely when the TARGET's own merchant/date
        // is null -- see duplicateCandidateService.js -- so this shape is
        // what actually reaches isProbableDuplicateMatch's null-rejection
        // check in application code, rather than being filtered out
        // earlier by the Mongo narrowing query).
        receiptDoc({ _id: "r1", contentHash: "hash-a", uploadedAt: new Date("2026-01-10T00:00:00.000Z") }),
        // Candidate: same merchant/date (passes the Mongo narrowing), but
        // OCR couldn't read the amount -- amountCents is null.
        receiptDoc({
          _id: "r2",
          contentHash: "hash-b",
          uploadedAt: new Date("2026-01-11T00:00:00.000Z"),
          duplicateSignature: { normalizedMerchant: "cafe nero", normalizedDate: "10/01/2026", amountCents: null },
        }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r1" });
    expect(candidates).toEqual([]);
  });

  test("ownership scoping holds even for an exact contentHash/signature match against a different user's receipt", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", userId: USER_B, contentHash: "shared-hash", uploadedAt: new Date("2026-01-10T00:00:00.000Z") }),
        receiptDoc({ _id: "r2", userId: USER_A, contentHash: "shared-hash", uploadedAt: new Date("2026-01-11T00:00:00.000Z") }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r2" });
    expect(candidates).toEqual([]);
  });
});
