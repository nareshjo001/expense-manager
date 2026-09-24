// OCR-004-T04 -- Services/ReceiptServices/receiptQueryService.js.
//
// Exercised against a small in-memory fake Receipt model and fake
// ExpenseModel (find/findOne/select/lean/save/markModified/deleteOne), the
// same fast no-real-Mongo pattern tests/exportRequestService.test.js uses
// for exportRequestService.js -- plus a fake receiptStorageAdapter (mocked
// at its OWN path, since receiptQueryService.js requires it lazily inside
// deleteReceipt, not at module load time -- see that function's own
// comment on why). mongoose itself is faked too (ObjectId.isValid only),
// matching tests/exportControllers.test.js's documented reason: the real
// package is measurably slow to require in this sandbox.
"use strict";

const RECEIPT_MODEL_PATH = "../models/Receipt";
const SCHEMAS_PATH = "../config/Schemas";
const STORAGE_ADAPTER_PATH = "../Services/ReceiptServices/receiptStorageAdapter";

const USER_A = "64f1a2b3c4d5e6f7a8b9c0aa";
const USER_B = "64f1a2b3c4d5e6f7a8b9c0bb";

// Accepts a real 24-hex ObjectId OR this test file's own simple fixture
// ids (r1, e1, req1, ...) -- but still rejects the deliberately-malformed
// test values used below (all of which contain a hyphen/space), so the
// "malformed id" tests below still exercise the real rejection path.
function isValidObjectId(id) {
  const s = String(id);
  return /^[0-9a-fA-F]{24}$/.test(s) || /^[a-zA-Z][a-zA-Z0-9]*$/.test(s);
}

function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    const value = doc[key];
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

// A chainable, thenable fake Mongoose Query -- supports .select()/.sort()
// (no-ops beyond returning itself) and .lean() (switches the resolved
// value to a plain-object copy), and is awaitable directly (resolves to
// the live document, methods included, for the mutation call sites that
// never call .lean()).
function applySort(arr, sortSpec) {
  if (!sortSpec) return arr;
  const entries = Object.entries(sortSpec);
  return [...arr].sort((a, b) => {
    for (const [key, dir] of entries) {
      const av = a[key];
      const bv = b[key];
      const at = av instanceof Date ? av.getTime() : av;
      const bt = bv instanceof Date ? bv.getTime() : bv;
      if (at < bt) return dir < 0 ? 1 : -1;
      if (at > bt) return dir < 0 ? -1 : 1;
    }
    return 0;
  });
}

function makeQuery(resultGetter) {
  let leanMode = false;
  let sortSpec = null;
  const query = {
    select() {
      return query;
    },
    sort(spec) {
      sortSpec = spec || null;
      return query;
    },
    lean() {
      leanMode = true;
      return query;
    },
    then(resolve, reject) {
      let raw = resultGetter();
      if (Array.isArray(raw) && sortSpec) raw = applySort(raw, sortSpec);
      const val = leanMode ? leanify(raw) : raw;
      return Promise.resolve(val).then(resolve, reject);
    },
    catch(reject) {
      return query.then(undefined, reject);
    },
  };
  return query;
}

// A live "document" -- save/toObject/markModified are non-enumerable so a
// `{ ...doc }` (or .lean()'s leanify) spread naturally drops them, the
// same way a real Mongoose lean() result never carries instance methods.
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
  Object.defineProperty(doc, "markModified", {
    value: jest.fn(),
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
    deleteOne: jest.fn(async (filter = {}) => {
      const idx = state.findIndex((d) => matchesFilter(d, filter));
      if (idx >= 0) state.splice(idx, 1);
      return { acknowledged: true, deletedCount: idx >= 0 ? 1 : 0 };
    }),
  };
}

function buildExpenseStore(seedDocs = []) {
  const state = seedDocs.map((d) => ({ ...d }));
  return {
    state,
    findOne: jest.fn((filter = {}) => makeQuery(() => state.find((d) => matchesFilter(d, filter)) || null)),
  };
}

function loadService({ receipts = [], expenses = [], deleteReceiptObjectImpl } = {}) {
  jest.resetModules();
  const receiptStore = buildReceiptStore(receipts);
  const expenseStore = buildExpenseStore(expenses);
  const deleteReceiptObject = jest.fn(deleteReceiptObjectImpl || (async () => {}));

  jest.doMock("mongoose", () => ({
    Types: { ObjectId: { isValid: (id) => isValidObjectId(String(id)) } },
  }));
  jest.doMock(RECEIPT_MODEL_PATH, () => receiptStore);
  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel: expenseStore }));
  jest.doMock(STORAGE_ADAPTER_PATH, () => ({ deleteReceiptObject }));

  const service = require("../Services/ReceiptServices/receiptQueryService");
  return { service, receiptStore, expenseStore, deleteReceiptObject };
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
      overallConfidence: 0.4,
      fieldConfidence: { expenseAmount: 0.4 },
      needsReview: true,
      reviewReasons: ["LOW_AMOUNT_CONFIDENCE"],
      amountCandidates: [{ value: 12.5, matchedText: "12.50" }],
    },
    extractedFieldsSchemaVersion: 1,
    reviewStatus: "needs_review",
    reviewedAt: null,
    linkedExpenseId: null,
    linkedAt: null,
    ...overrides,
  };
}

afterEach(() => {
  jest.resetModules();
});

describe("listReceipts", () => {
  test("returns only the requesting user's own receipts, newest first, client-safe", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", userId: USER_A, uploadedAt: new Date("2026-01-01T00:00:00.000Z") }),
        receiptDoc({ _id: "r2", userId: USER_A, uploadedAt: new Date("2026-02-01T00:00:00.000Z") }),
        receiptDoc({ _id: "r3", userId: USER_B }),
      ],
    });

    const list = await service.listReceipts({ userId: USER_A });

    expect(list.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(list[0].storageKey).toBeUndefined();
    expect(list[0].imageUrl).toBe("/api/receipts/r2/image");
  });

  test("rejects an invalid reviewStatus filter", async () => {
    const { service } = loadService({ receipts: [receiptDoc()] });

    await expect(service.listReceipts({ userId: USER_A, reviewStatus: "bogus" })).rejects.toMatchObject({
      code: "INVALID_REVIEW_STATUS_FILTER",
    });
  });

  test("filters by reviewStatus", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", reviewStatus: "needs_review" }),
        receiptDoc({ _id: "r2", reviewStatus: "reviewed" }),
      ],
    });

    const list = await service.listReceipts({ userId: USER_A, reviewStatus: "reviewed" });
    expect(list.map((r) => r.id)).toEqual(["r2"]);
  });

  test("linked:true returns only linked receipts, linked:false only unlinked", async () => {
    const { service } = loadService({
      receipts: [
        receiptDoc({ _id: "r1", linkedExpenseId: "e1" }),
        receiptDoc({ _id: "r2", linkedExpenseId: null }),
      ],
    });

    const linked = await service.listReceipts({ userId: USER_A, linked: true });
    expect(linked.map((r) => r.id)).toEqual(["r1"]);

    const unlinked = await service.listReceipts({ userId: USER_A, linked: false });
    expect(unlinked.map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("getReceiptDetail", () => {
  test("returns the safe shape for the owner's own receipt", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    const detail = await service.getReceiptDetail({ userId: USER_A, receiptId: "r1" });
    expect(detail.id).toBe("r1");
    expect(detail.extractedFields.expenseName).toBe("Cafe Nero");
  });

  test("throws NOT_FOUND for a receipt owned by a different user", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_B })] });

    await expect(service.getReceiptDetail({ userId: USER_A, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("throws NOT_FOUND for a malformed id without querying the model", async () => {
    const { service, receiptStore } = loadService({ receipts: [] });

    await expect(
      service.getReceiptDetail({ userId: USER_A, receiptId: "not-an-object-id" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(receiptStore.findOne).not.toHaveBeenCalled();
  });
});

describe("getReceiptImageRef", () => {
  test("returns exactly storageKey/mimeType for the owner", async () => {
    const { service } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, storageKey: "sk-1", mimeType: "image/png" })],
    });

    const ref = await service.getReceiptImageRef({ userId: USER_A, receiptId: "r1" });
    expect(ref).toEqual({ storageKey: "sk-1", mimeType: "image/png" });
  });

  test("throws NOT_FOUND for another user's receipt", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_B })] });

    await expect(service.getReceiptImageRef({ userId: USER_A, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("linkReceiptToExpense", () => {
  test("links a receipt to the caller's own expense", async () => {
    const { service, receiptStore } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, linkedExpenseId: null, linkedAt: null })],
      expenses: [{ _id: "e1", userId: USER_A }],
    });

    const result = await service.linkReceiptToExpense({ userId: USER_A, receiptId: "r1", expenseId: "e1" });

    expect(result.linkedExpenseId).toBe("e1");
    expect(result.linkedAt).toBeInstanceOf(Date);
    expect(receiptStore.state[0].save).toHaveBeenCalledTimes(1);
  });

  test("throws EXPENSE_NOT_FOUND when the expense does not belong to the caller", async () => {
    const { service } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A })],
      expenses: [{ _id: "e1", userId: USER_B }],
    });

    await expect(
      service.linkReceiptToExpense({ userId: USER_A, receiptId: "r1", expenseId: "e1" })
    ).rejects.toMatchObject({ code: "EXPENSE_NOT_FOUND" });
  });

  test("throws EXPENSE_NOT_FOUND for a malformed expenseId", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    await expect(
      service.linkReceiptToExpense({ userId: USER_A, receiptId: "r1", expenseId: "not-an-id" })
    ).rejects.toMatchObject({ code: "EXPENSE_NOT_FOUND" });
  });

  test("re-linking to the SAME expense it is already linked to is a harmless no-op", async () => {
    const { service } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, linkedExpenseId: "e1" })],
      expenses: [{ _id: "e1", userId: USER_A }],
    });

    const result = await service.linkReceiptToExpense({ userId: USER_A, receiptId: "r1", expenseId: "e1" });
    expect(result.linkedExpenseId).toBe("e1");
  });

  test("rejects linking to a DIFFERENT expense while already linked", async () => {
    const { service } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, linkedExpenseId: "e1" })],
      expenses: [
        { _id: "e1", userId: USER_A },
        { _id: "e2", userId: USER_A },
      ],
    });

    await expect(
      service.linkReceiptToExpense({ userId: USER_A, receiptId: "r1", expenseId: "e2" })
    ).rejects.toMatchObject({ code: "ALREADY_LINKED_TO_ANOTHER_EXPENSE" });
  });

  test("throws NOT_FOUND when the receipt itself isn't owned by the caller", async () => {
    const { service } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_B })],
      expenses: [{ _id: "e1", userId: USER_A }],
    });

    await expect(
      service.linkReceiptToExpense({ userId: USER_A, receiptId: "r1", expenseId: "e1" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("unlinkReceiptFromExpense", () => {
  test("unlinks a linked receipt", async () => {
    const { service } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, linkedExpenseId: "e1", linkedAt: new Date() })],
    });

    const result = await service.unlinkReceiptFromExpense({ userId: USER_A, receiptId: "r1" });
    expect(result.linkedExpenseId).toBeNull();
    expect(result.linkedAt).toBeNull();
  });

  test("is idempotent for an already-unlinked receipt", async () => {
    const { service } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, linkedExpenseId: null, linkedAt: null })],
    });

    await expect(service.unlinkReceiptFromExpense({ userId: USER_A, receiptId: "r1" })).resolves.toMatchObject({
      linkedExpenseId: null,
    });
  });

  test("throws NOT_FOUND for another user's receipt", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_B })] });

    await expect(service.unlinkReceiptFromExpense({ userId: USER_A, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("markReceiptReviewed", () => {
  test("marks reviewed with no corrections, leaving extractedFields untouched", async () => {
    const { service, receiptStore } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, reviewStatus: "needs_review", reviewedAt: null })],
    });

    const result = await service.markReceiptReviewed({ userId: USER_A, receiptId: "r1" });

    expect(result.reviewStatus).toBe("reviewed");
    expect(result.reviewedAt).toBeInstanceOf(Date);
    expect(result.extractedFields.expenseName).toBe("Cafe Nero");
    expect(receiptStore.state[0].markModified).not.toHaveBeenCalled();
  });

  test("merges corrections onto extractedFields without touching OCR's own confidence record", async () => {
    const { service, receiptStore } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A })],
    });

    const result = await service.markReceiptReviewed({
      userId: USER_A,
      receiptId: "r1",
      corrections: { expenseName: "Corrected Cafe", expenseAmount: 15.75, expenseDate: "2026-01-11" },
    });

    expect(result.extractedFields.expenseName).toBe("Corrected Cafe");
    expect(result.extractedFields.expenseAmount).toBe(15.75);
    expect(result.extractedFields.expenseDate).toBe("2026-01-11");
    // OCR's own record of what it originally produced must survive.
    expect(result.extractedFields.overallConfidence).toBe(0.4);
    expect(result.extractedFields.fieldConfidence).toEqual({ expenseAmount: 0.4 });
    expect(result.extractedFields.reviewReasons).toEqual(["LOW_AMOUNT_CONFIDENCE"]);
    expect(result.extractedFields.amountCandidates).toEqual([{ value: 12.5, matchedText: "12.50" }]);
    expect(receiptStore.state[0].markModified).toHaveBeenCalledWith("extractedFields");
  });

  test.each([
    ["a negative amount", { expenseAmount: -5 }],
    ["a zero amount", { expenseAmount: 0 }],
    ["a non-finite amount", { expenseAmount: Infinity }],
    ["a non-numeric amount", { expenseAmount: "12.50" }],
  ])("rejects %s with INVALID_CORRECTION", async (_label, corrections) => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    await expect(
      service.markReceiptReviewed({ userId: USER_A, receiptId: "r1", corrections })
    ).rejects.toMatchObject({ code: "INVALID_CORRECTION" });
  });

  test("rejects an unparseable expenseDate correction with INVALID_CORRECTION", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    await expect(
      service.markReceiptReviewed({ userId: USER_A, receiptId: "r1", corrections: { expenseDate: "not-a-date" } })
    ).rejects.toMatchObject({ code: "INVALID_CORRECTION" });
  });

  test("throws NOT_FOUND for another user's receipt", async () => {
    const { service } = loadService({ receipts: [receiptDoc({ _id: "r1", userId: USER_B })] });

    await expect(service.markReceiptReviewed({ userId: USER_A, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("deleteReceipt", () => {
  test("deletes the storage object first, then the Mongo document", async () => {
    const callOrder = [];
    const { service, receiptStore, deleteReceiptObject } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, storageKey: "sk-1" })],
      deleteReceiptObjectImpl: async () => {
        callOrder.push("storage-delete");
      },
    });
    receiptStore.deleteOne.mockImplementation(async (filter) => {
      callOrder.push("mongo-delete");
      const idx = receiptStore.state.findIndex((d) => String(d._id) === String(filter._id));
      if (idx >= 0) receiptStore.state.splice(idx, 1);
      return { acknowledged: true, deletedCount: 1 };
    });

    const result = await service.deleteReceipt({ userId: USER_A, receiptId: "r1" });

    expect(result).toEqual({ id: "r1" });
    expect(deleteReceiptObject).toHaveBeenCalledWith("sk-1");
    expect(receiptStore.deleteOne).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(["storage-delete", "mongo-delete"]);
    expect(receiptStore.state).toHaveLength(0);
  });

  test("a linked receipt CAN still be explicitly deleted", async () => {
    const { service, receiptStore } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, linkedExpenseId: "e1", linkedAt: new Date() })],
    });

    await service.deleteReceipt({ userId: USER_A, receiptId: "r1" });
    expect(receiptStore.state).toHaveLength(0);
  });

  test("when the storage delete throws, the Mongo document is NOT removed and the error propagates", async () => {
    const { service, receiptStore } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, storageKey: "sk-1" })],
      deleteReceiptObjectImpl: async () => {
        throw new Error("GridFS bucket unreachable");
      },
    });

    await expect(service.deleteReceipt({ userId: USER_A, receiptId: "r1" })).rejects.toThrow(
      "GridFS bucket unreachable"
    );
    expect(receiptStore.deleteOne).not.toHaveBeenCalled();
    expect(receiptStore.state).toHaveLength(1);
  });

  test("throws NOT_FOUND for another user's receipt, calling neither storage nor Mongo delete", async () => {
    const { service, receiptStore, deleteReceiptObject } = loadService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_B })],
    });

    await expect(service.deleteReceipt({ userId: USER_A, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(deleteReceiptObject).not.toHaveBeenCalled();
    expect(receiptStore.deleteOne).not.toHaveBeenCalled();
  });
});
