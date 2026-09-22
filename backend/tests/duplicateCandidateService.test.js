// OCR-005-T04 -- Services/ReceiptServices/duplicateCandidateService.js.
//
// Same fast in-memory-fake-model pattern tests/receiptQueryService.test.js
// uses for Receipt -- no real Mongoose, a chainable/thenable fake Query
// (find/findOne/select/lean, sort as a no-op since this service sorts
// candidates itself in application code), and a fake mongoose (ObjectId
// isValid only).
"use strict";

const RECEIPT_MODEL_PATH = "../models/Receipt";
const RULES_PATH = "../utils/duplicateDetectionRules";

const USER_A = "64f1a2b3c4d5e6f7a8b9c0aa";
const USER_B = "64f1a2b3c4d5e6f7a8b9c0bb";

// Accepts a real 24-hex ObjectId OR this test file's own simple fixture
// ids (r1, r2, ...) -- but still rejects the deliberately-malformed test
// values below (all contain a hyphen/space), same convention
// receiptQueryService.test.js uses.
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
  // module directly (same as receiptQueryService.test.js's own
  // SCHEMAS_PATH mock) so the real mongoose Schema constructor is never
  // touched.
  jest.doMock("../config/Schemas", () => ({ ExpenseModel: {} }));

  const service = require("../Services/ReceiptServices/duplicateCandidateService");
  const rules = require(RULES_PATH);
  return { service, receiptStore, rules };
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
      expenseAmount: 12.5,
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
    duplicateSignature: { normalizedMerchant: "cafe nero", normalizedDate: "10/01/2026", amountCents: 1250 },
    duplicateStatus: "unreviewed",
    duplicateOfReceiptId: null,
    ...overrides,
  };
}

afterEach(() => {
  jest.resetModules();
});

describe("findDuplicateCandidates", () => {
  test("finds an EXACT_FILE_MATCH candidate by contentHash", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", contentHash: "hash-a", duplicateSignature: { normalizedMerchant: null, normalizedDate: null, amountCents: null } }),
        receiptDoc({ _id: "r2", contentHash: "hash-a", duplicateSignature: { normalizedMerchant: null, normalizedDate: null, amountCents: null } }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r1" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].receiptId).toBe("r2");
    expect(candidates[0].reasonCode).toBe("EXACT_FILE_MATCH");
    expect(candidates[0].imageUrl).toBe("/api/receipts/r2/image");
  });

  test("finds a PROBABLE_MERCHANT_DATE_AMOUNT candidate with same merchant/date/amount but a different hash", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({
          _id: "r1",
          contentHash: "hash-a",
          duplicateSignature: { normalizedMerchant: "cafe nero", normalizedDate: "10/01/2026", amountCents: 1250 },
        }),
        receiptDoc({
          _id: "r2",
          contentHash: "hash-b",
          duplicateSignature: { normalizedMerchant: "cafe nero", normalizedDate: "10/01/2026", amountCents: 1250 },
        }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r1" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].receiptId).toBe("r2");
    expect(candidates[0].reasonCode).toBe("PROBABLE_MERCHANT_DATE_AMOUNT");
  });

  test("a receipt matching both signals is reported once, with EXACT_FILE_MATCH as the reason", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({
          _id: "r1",
          contentHash: "hash-a",
          duplicateSignature: { normalizedMerchant: "cafe nero", normalizedDate: "10/01/2026", amountCents: 1250 },
        }),
        receiptDoc({
          _id: "r2",
          contentHash: "hash-a",
          duplicateSignature: { normalizedMerchant: "cafe nero", normalizedDate: "10/01/2026", amountCents: 1250 },
        }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r1" });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].reasonCode).toBe("EXACT_FILE_MATCH");
  });

  test("returns no candidates when nothing matches", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({
          _id: "r1",
          contentHash: "hash-a",
          duplicateSignature: { normalizedMerchant: "cafe nero", normalizedDate: "10/01/2026", amountCents: 1250 },
        }),
        receiptDoc({
          _id: "r2",
          contentHash: "hash-b",
          duplicateSignature: { normalizedMerchant: "starbucks", normalizedDate: "11/01/2026", amountCents: 500 },
        }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r1" });
    expect(candidates).toEqual([]);
  });

  test("skips the probable-match query entirely when the target's own merchant/date is null", async () => {
    const { service, receiptStore } = loadService({
      receipts: [
        receiptDoc({
          _id: "r1",
          contentHash: "hash-a",
          duplicateSignature: { normalizedMerchant: null, normalizedDate: null, amountCents: null },
        }),
        receiptDoc({
          _id: "r2",
          contentHash: "hash-b",
          duplicateSignature: { normalizedMerchant: null, normalizedDate: null, amountCents: null },
        }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r1" });
    expect(candidates).toEqual([]);
    // find() should only have been called once (the exact-hash query) --
    // the probable-match narrowing query never ran.
    expect(receiptStore.find).toHaveBeenCalledTimes(1);
  });

  test("does not surface another user's receipt, even with a matching hash/signature", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", userId: USER_A, contentHash: "hash-a" }),
        receiptDoc({ _id: "r2", userId: USER_B, contentHash: "hash-a" }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r1" });
    expect(candidates).toEqual([]);
  });

  test("throws NOT_FOUND for a receipt owned by a different user (ownership scoping collapses to 404-equivalent)", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_B })] });

    await expect(service.findDuplicateCandidates({ userId: USER_A, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("throws NOT_FOUND for a malformed id without querying the model", async () => {
    const { service, receiptStore } = loadService({ receipts: [] });

    await expect(
      service.findDuplicateCandidates({ userId: USER_A, receiptId: "not-an-object-id" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(receiptStore.findOne).not.toHaveBeenCalled();
  });

  test("sorts candidates newest-first by uploadedAt", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", contentHash: "hash-a", uploadedAt: new Date("2026-01-01T00:00:00.000Z") }),
        receiptDoc({ _id: "r2", contentHash: "hash-a", uploadedAt: new Date("2026-03-01T00:00:00.000Z") }),
        receiptDoc({ _id: "r3", contentHash: "hash-a", uploadedAt: new Date("2026-02-01T00:00:00.000Z") }),
      ],
    });

    const candidates = await service.findDuplicateCandidates({ userId: USER_A, receiptId: "r1" });
    expect(candidates.map((c) => c.receiptId)).toEqual(["r2", "r3"]);
  });
});

describe("recordDuplicateDecision", () => {
  test("confirmed_new sets duplicateStatus and clears duplicateOfReceiptId", async () => {
    const { service, receiptStore } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, duplicateStatus: "linked_existing", duplicateOfReceiptId: "r2" })],
    });

    const result = await service.recordDuplicateDecision({
      userId: USER_A,
      receiptId: "r1",
      decision: "confirmed_new",
    });

    expect(result.duplicateStatus).toBe("confirmed_new");
    expect(result.duplicateOfReceiptId).toBeNull();
    expect(receiptStore.state[0].save).toHaveBeenCalledTimes(1);
  });

  test("linked_existing sets duplicateStatus and duplicateOfReceiptId when the target is a valid sibling receipt", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", userId: USER_A }),
        receiptDoc({ _id: "r2", userId: USER_A }),
      ],
    });

    const result = await service.recordDuplicateDecision({
      userId: USER_A,
      receiptId: "r1",
      decision: "linked_existing",
      duplicateOfReceiptId: "r2",
    });

    expect(result.duplicateStatus).toBe("linked_existing");
    expect(result.duplicateOfReceiptId).toBe("r2");
  });

  test("throws INVALID_DECISION for a bad decision value", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    await expect(
      service.recordDuplicateDecision({ userId: USER_A, receiptId: "r1", decision: "bogus" })
    ).rejects.toMatchObject({ code: "INVALID_DECISION" });
  });

  test("throws NOT_FOUND when duplicateOfReceiptId does not belong to the same user", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", userId: USER_A }),
        receiptDoc({ _id: "r2", userId: USER_B }),
      ],
    });

    await expect(
      service.recordDuplicateDecision({
        userId: USER_A,
        receiptId: "r1",
        decision: "linked_existing",
        duplicateOfReceiptId: "r2",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("throws NOT_FOUND when duplicateOfReceiptId is missing/malformed for a linked_existing decision", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    await expect(
      service.recordDuplicateDecision({ userId: USER_A, receiptId: "r1", decision: "linked_existing" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("throws NOT_FOUND for another user's receipt", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_B })] });

    await expect(
      service.recordDuplicateDecision({ userId: USER_A, receiptId: "r1", decision: "confirmed_new" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("throws NOT_FOUND for a malformed receiptId without querying the model", async () => {
    const { service, receiptStore } = loadService({ receipts: [] });

    await expect(
      service.recordDuplicateDecision({ userId: USER_A, receiptId: "not-an-id", decision: "confirmed_new" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(receiptStore.findOne).not.toHaveBeenCalled();
  });
});
