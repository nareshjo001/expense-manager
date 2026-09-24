// OCR-004-T04 -- security-focused integration tests for the receipt inbox
// read/list/detail/link/unlink/delete layer (Services/ReceiptServices/
// receiptQueryService.js) exercised REAL and un-mocked, mirroring
// tests/exportSecurity.test.js's own coverage style from DAT-004: only
// the Mongoose models (models/Receipt.js, config/Schemas.js's
// ExpenseModel) and the storage adapter are faked, the same no-real-Mongo
// pattern every other test file in this suite uses. This file exists to
// PROVE, not assume, that:
//   1. user B can never list/view/get-the-image-pointer-for/link/unlink/
//      mark-reviewed/delete user A's receipt -- every path collapses to
//      NOT_FOUND, never a distinct "forbidden" outcome that would let a
//      caller tell "not yours" apart from "doesn't exist",
//   2. linking a receipt to an expense owned by a DIFFERENT user is
//      rejected even when the receipt itself belongs to the caller,
//   3. the raw storageKey never appears in any client-shaped result
//      (list/detail/link/unlink/markReviewed all use toSafeShape).
"use strict";

const RECEIPT_MODEL_PATH = "../models/Receipt";
const SCHEMAS_PATH = "../config/Schemas";
const STORAGE_ADAPTER_PATH = "../Services/ReceiptServices/receiptStorageAdapter";

const USER_A = "64f1a2b3c4d5e6f7a8b9c0aa";
const USER_B = "64f1a2b3c4d5e6f7a8b9c0bb";

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

function loadRealService({ receipts = [], expenses = [] } = {}) {
  jest.resetModules();
  const receiptStore = buildReceiptStore(receipts);
  const expenseStore = buildExpenseStore(expenses);
  const deleteReceiptObject = jest.fn(async () => {});
  const getReceiptObjectStream = jest.fn(async () => ({ pipe: jest.fn() }));

  // Accepts a real 24-hex ObjectId OR this test file's own simple fixture
  // ids (r1, e1, ...) so the security scenarios below don't need to spell
  // out full ObjectId-shaped ids everywhere.
  jest.doMock("mongoose", () => ({
    Types: {
      ObjectId: {
        isValid: (id) => {
          const s = String(id);
          return /^[0-9a-fA-F]{24}$/.test(s) || /^[a-zA-Z][a-zA-Z0-9]*$/.test(s);
        },
      },
    },
  }));
  jest.doMock(RECEIPT_MODEL_PATH, () => receiptStore);
  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel: expenseStore }));
  jest.doMock(STORAGE_ADAPTER_PATH, () => ({ deleteReceiptObject, getReceiptObjectStream }));

  const service = require("../Services/ReceiptServices/receiptQueryService");
  return { service, receiptStore, expenseStore, deleteReceiptObject };
}

function receiptDoc(overrides = {}) {
  return {
    _id: "r1",
    userId: USER_A,
    storageKey: "TOP-SECRET-GRIDFS-KEY-do-not-leak",
    mimeType: "image/jpeg",
    sizeBytes: 999,
    width: 400,
    height: 300,
    uploadedAt: new Date("2026-01-05T00:00:00.000Z"),
    extractedFields: { expenseName: "Grocery", expenseAmount: 40, expenseDate: "05/01/2026" },
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

describe("1. cross-user authorization -- user B against user A's receipt", () => {
  test("listReceipts never returns user A's receipt in user B's own list", async () => {
    const { service } = loadRealService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    const bList = await service.listReceipts({ userId: USER_B });
    expect(bList.find((r) => r.id === "r1")).toBeUndefined();
  });

  test("getReceiptDetail 404s (NOT_FOUND) for user B, never revealing user A's data", async () => {
    const { service } = loadRealService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    await expect(service.getReceiptDetail({ userId: USER_B, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("getReceiptImageRef 404s (NOT_FOUND) for user B", async () => {
    const { service } = loadRealService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    await expect(service.getReceiptImageRef({ userId: USER_B, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("linkReceiptToExpense 404s (NOT_FOUND) for user B even with a valid expenseId of their own", async () => {
    const { service } = loadRealService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A })],
      expenses: [{ _id: "e1", userId: USER_B }],
    });

    await expect(
      service.linkReceiptToExpense({ userId: USER_B, receiptId: "r1", expenseId: "e1" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("unlinkReceiptFromExpense 404s (NOT_FOUND) for user B", async () => {
    const { service } = loadRealService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, linkedExpenseId: "e1" })],
    });

    await expect(service.unlinkReceiptFromExpense({ userId: USER_B, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("markReceiptReviewed 404s (NOT_FOUND) for user B", async () => {
    const { service } = loadRealService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    await expect(service.markReceiptReviewed({ userId: USER_B, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("deleteReceipt 404s (NOT_FOUND) for user B and never touches storage or the document", async () => {
    const { service, receiptStore, deleteReceiptObject } = loadRealService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A })],
    });

    await expect(service.deleteReceipt({ userId: USER_B, receiptId: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(deleteReceiptObject).not.toHaveBeenCalled();
    expect(receiptStore.state).toHaveLength(1);
  });

  test("the legitimate owner, by contrast, can read/link/unlink/review/delete their own receipt", async () => {
    const { service } = loadRealService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A })],
      expenses: [{ _id: "e1", userId: USER_A }],
    });

    await expect(service.getReceiptDetail({ userId: USER_A, receiptId: "r1" })).resolves.toMatchObject({
      id: "r1",
    });
    await expect(
      service.linkReceiptToExpense({ userId: USER_A, receiptId: "r1", expenseId: "e1" })
    ).resolves.toMatchObject({ linkedExpenseId: "e1" });
    await expect(service.unlinkReceiptFromExpense({ userId: USER_A, receiptId: "r1" })).resolves.toMatchObject({
      linkedExpenseId: null,
    });
    await expect(service.markReceiptReviewed({ userId: USER_A, receiptId: "r1" })).resolves.toMatchObject({
      reviewStatus: "reviewed",
    });
    await expect(service.deleteReceipt({ userId: USER_A, receiptId: "r1" })).resolves.toMatchObject({ id: "r1" });
  });
});

describe("2. linking across users is rejected even when the receipt is the caller's own", () => {
  test("user A cannot link their own receipt to user B's expense", async () => {
    const { service } = loadRealService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A })],
      expenses: [{ _id: "e1", userId: USER_B }],
    });

    await expect(
      service.linkReceiptToExpense({ userId: USER_A, receiptId: "r1", expenseId: "e1" })
    ).rejects.toMatchObject({ code: "EXPENSE_NOT_FOUND" });
  });

  test("a made-up/guessed expenseId also rejects with EXPENSE_NOT_FOUND, not a 500", async () => {
    const { service } = loadRealService({ receipts: [receiptDoc({ _id: "r1", userId: USER_A })] });

    await expect(
      service.linkReceiptToExpense({
        userId: USER_A,
        receiptId: "r1",
        expenseId: "64f1a2b3c4d5e6f7a8b9c0ff",
      })
    ).rejects.toMatchObject({ code: "EXPENSE_NOT_FOUND" });
  });
});

describe("3. storageKey never leaks into any client-shaped result", () => {
  test("listReceipts/getReceiptDetail/link/unlink/markReviewed results have no storageKey property at all", async () => {
    const { service } = loadRealService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, storageKey: "leak-me-not" })],
      expenses: [{ _id: "e1", userId: USER_A }],
    });

    const list = await service.listReceipts({ userId: USER_A });
    const detail = await service.getReceiptDetail({ userId: USER_A, receiptId: "r1" });
    const linked = await service.linkReceiptToExpense({ userId: USER_A, receiptId: "r1", expenseId: "e1" });
    const unlinked = await service.unlinkReceiptFromExpense({ userId: USER_A, receiptId: "r1" });
    const reviewed = await service.markReceiptReviewed({ userId: USER_A, receiptId: "r1" });

    for (const shape of [list[0], detail, linked, unlinked, reviewed]) {
      expect(Object.prototype.hasOwnProperty.call(shape, "storageKey")).toBe(false);
      expect(JSON.stringify(shape)).not.toContain("leak-me-not");
    }
  });

  test("getReceiptImageRef DOES return storageKey (it is the one server-side-only exception), proving the omission above is deliberate, not accidental", async () => {
    const { service } = loadRealService({
      receipts: [receiptDoc({ _id: "r1", userId: USER_A, storageKey: "sk-for-streaming" })],
    });

    const ref = await service.getReceiptImageRef({ userId: USER_A, receiptId: "r1" });
    expect(ref.storageKey).toBe("sk-for-streaming");
  });
});
