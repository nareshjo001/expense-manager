// IMP-001-T06 -- Services/ImportServices/importCommitService.js.
//
// Same fast in-memory-fake-model pattern
// tests/duplicateCandidateService.test.js uses -- no real Mongoose, a
// small in-memory store standing in for ImportSession's
// findOneAndUpdate/findOne (so the previewing->committing CAS is
// exercised for real, against real mutable shared state, not just
// asserted-by-inspection), and a minimal ExpenseModel constructor mock
// (new ExpenseModel(doc) + a shared prototype.save + a static findOne)
// mirroring the one tests/expense.mutationReliability.test.js already
// uses for the same model.
"use strict";

const SESSION_MODEL_PATH = "../models/ImportSession";
const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_PATH = "../Services/syncRecoveryService";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const CATEGORY_NORMALIZATION_PATH = "../utils/categoryNormalization";
const SERVICE_PATH = "../Services/ImportServices/importCommitService";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0ff";
const SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0bb";

function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));
}

function buildImportSessionStore(sessions = []) {
  const store = sessions;
  const findOneAndUpdate = jest.fn(async (filter, update) => {
    const doc = store.find((d) => matchesFilter(d, filter));
    if (!doc) return null;
    if (update.$set) Object.assign(doc, update.$set);
    return doc;
  });
  const findOne = jest.fn(async (filter) => {
    const doc = store.find((d) => matchesFilter(d, filter));
    return doc || null;
  });
  return { store, findOneAndUpdate, findOne };
}

function makeSession({
  id = SESSION_ID,
  userId = USER_ID,
  status = "previewing",
  rows = [],
  committedAt = null,
  committedCount = 0,
  skippedCount = 0,
} = {}) {
  return {
    _id: id,
    userId,
    status,
    committedAt,
    committedCount,
    skippedCount,
    rows,
    save: jest.fn(async function save() {
      return this;
    }),
  };
}

function makeRow({
  rowIndex,
  expenseName = "Coffee Shop",
  expenseAmount = 5.5,
  expenseDate = "2026-01-05",
  expenseCategory = "food",
  validationErrors = [],
  decision = "accept",
  committedExpenseId = null,
} = {}) {
  return {
    rowIndex,
    raw: [expenseName, String(expenseAmount), expenseDate, expenseCategory],
    mapped: { expenseName, expenseAmount, expenseDate, expenseCategory },
    validationErrors,
    decision,
    committedExpenseId,
  };
}

// Default: strings normalize to their own trimmed value, empty/non-string
// normalize to null -- enough to exercise the real normalizeCategory
// contract (reject blank/invalid) without depending on its full alias
// table.
function defaultNormalizeCategoryImpl(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

function defaultReserveImpl({ budgetDates = [], reserveReport = false } = {}) {
  return Promise.resolve({
    budgetReservations: budgetDates.map((d, i) => ({ month: d, token: `budget-tok-${i}` })),
    reportReservation: reserveReport ? { token: "report-tok" } : null,
  });
}

function buildExpenseModelMock(seedExpenses = [], { saveImpl } = {}) {
  const store = seedExpenses.map((e) => ({ ...e }));
  let counter = 1;

  function ExpenseModelMock(doc) {
    Object.assign(this, doc);
    this._id = `exp-${counter++}`;
  }

  function defaultSaveImpl() {
    const dup = store.find((e) => String(e.userId) === String(this.userId) && e.id === this.id);
    if (dup) {
      const err = new Error("E11000 duplicate key error collection: expenses index: userId_1_id_1");
      err.code = 11000;
      throw err;
    }
    store.push({ ...this });
    return this;
  }

  const saveMock = jest.fn(saveImpl || defaultSaveImpl);
  ExpenseModelMock.prototype.save = saveMock;

  ExpenseModelMock.findOne = jest.fn((filter) => {
    const found = store.find((e) => matchesFilter(e, filter));
    return { lean: jest.fn(async () => (found ? { ...found } : null)) };
  });

  return { ExpenseModelMock, store, saveMock };
}

function loadService({
  sessions = [],
  expenses = [],
  expenseSaveImpl,
  normalizeCategoryImpl,
  reserveImpl,
  synchronizeAfterMutationImpl,
} = {}) {
  jest.resetModules();

  const importSessionMock = buildImportSessionStore(sessions);
  jest.doMock(SESSION_MODEL_PATH, () => importSessionMock);

  const expenseMockBundle = buildExpenseModelMock(expenses, { saveImpl: expenseSaveImpl });
  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel: expenseMockBundle.ExpenseModelMock }));

  const reserve = jest.fn(reserveImpl || defaultReserveImpl);
  const abandon = jest.fn(async () => null);
  const synchronizeAfterMutation = jest.fn(
    synchronizeAfterMutationImpl || (async () => ({ status: "synchronized" }))
  );
  jest.doMock(SYNC_RECOVERY_PATH, () => ({ reserve, abandon, synchronizeAfterMutation }));

  const clearUserExpenseCache = jest.fn(async () => {});
  jest.doMock(EXPENSE_CACHE_PATH, () => ({ clearUserExpenseCache }));

  const normalizeCategory = jest.fn(normalizeCategoryImpl || defaultNormalizeCategoryImpl);
  jest.doMock(CATEGORY_NORMALIZATION_PATH, () => ({ normalizeCategory }));

  const service = require(SERVICE_PATH);
  return {
    service,
    importSessionMock,
    expenseMockBundle,
    mocks: { reserve, abandon, synchronizeAfterMutation, clearUserExpenseCache, normalizeCategory },
  };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("commitImportSession", () => {
  test("commits every accept+valid row into an expense; skip/pending/invalid-despite-accept rows are never committed", async () => {
    const rows = [
      makeRow({ rowIndex: 0, decision: "accept", expenseDate: "2026-01-05" }),
      makeRow({ rowIndex: 1, decision: "skip" }),
      makeRow({ rowIndex: 2, decision: "pending" }),
      makeRow({ rowIndex: 3, decision: "accept", validationErrors: ["INVALID_AMOUNT"] }),
      makeRow({ rowIndex: 4, decision: "accept", expenseDate: "2026-02-10", expenseName: "Groceries" }),
    ];
    const session = makeSession({ rows });
    const { service, mocks } = loadService({ sessions: [session] });

    const result = await service.commitImportSession({ userId: USER_ID, sessionId: SESSION_ID });

    expect(result.status).toBe("committed");
    expect(result.committedCount).toBe(2);
    expect(result.skippedCount).toBe(3);
    expect(result.committedAt).toBeTruthy();

    expect(result.rows[0].committedExpenseId).toBeTruthy();
    expect(result.rows[4].committedExpenseId).toBeTruthy();
    expect(result.rows[1].committedExpenseId).toBeNull();
    expect(result.rows[2].committedExpenseId).toBeNull();
    expect(result.rows[3].committedExpenseId).toBeNull();

    // Reserve/sync/cache each run exactly ONCE for the whole batch, not
    // once per row.
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledWith({
      userId: USER_ID,
      budgetDates: [new Date("2026-01-05"), new Date("2026-02-10")],
      reserveReport: true,
    });
    expect(mocks.synchronizeAfterMutation).toHaveBeenCalledTimes(1);
    expect(mocks.synchronizeAfterMutation).toHaveBeenCalledWith({
      userId: USER_ID,
      budgetDates: [new Date("2026-01-05"), new Date("2026-02-10")],
      budgetTokens: ["budget-tok-0", "budget-tok-1"],
      reportToken: "report-tok",
    });
    expect(mocks.clearUserExpenseCache).toHaveBeenCalledTimes(1);
    expect(mocks.clearUserExpenseCache).toHaveBeenCalledWith(USER_ID);
    expect(mocks.abandon).not.toHaveBeenCalled();
  });

  test("a row with validationErrors is never committed even when decision is accept", async () => {
    const rows = [makeRow({ rowIndex: 0, decision: "accept", validationErrors: ["MISSING_AMOUNT"] })];
    const session = makeSession({ rows });
    const { service, expenseMockBundle, mocks } = loadService({ sessions: [session] });

    const result = await service.commitImportSession({ userId: USER_ID, sessionId: SESSION_ID });

    expect(result.committedCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.rows[0].committedExpenseId).toBeNull();
    expect(expenseMockBundle.saveMock).not.toHaveBeenCalled();
    // Zero eligible rows -- reserve is still called (and then immediately
    // released) but nothing is ever synced/cached, since nothing changed.
    expect(mocks.abandon).toHaveBeenCalledTimes(1);
    expect(mocks.synchronizeAfterMutation).not.toHaveBeenCalled();
    expect(mocks.clearUserExpenseCache).not.toHaveBeenCalled();
  });

  test("replaying an already-committed session returns the same result without creating new expenses", async () => {
    const committedAt = new Date("2026-01-06T00:00:00.000Z");
    const rows = [
      makeRow({ rowIndex: 0, decision: "accept", committedExpenseId: "exp-existing-1" }),
      makeRow({ rowIndex: 1, decision: "skip", committedExpenseId: null }),
    ];
    const session = makeSession({
      status: "committed",
      rows,
      committedAt,
      committedCount: 1,
      skippedCount: 1,
    });
    const { service, expenseMockBundle, mocks, importSessionMock } = loadService({ sessions: [session] });

    const result = await service.commitImportSession({ userId: USER_ID, sessionId: SESSION_ID });

    expect(result.status).toBe("committed");
    expect(result.committedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.committedAt).toBe(committedAt);
    expect(result.rows[0].committedExpenseId).toBe("exp-existing-1");

    expect(importSessionMock.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(importSessionMock.findOne).toHaveBeenCalledTimes(1);
    expect(expenseMockBundle.saveMock).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.synchronizeAfterMutation).not.toHaveBeenCalled();
    expect(mocks.clearUserExpenseCache).not.toHaveBeenCalled();
  });

  test("a session already committing (CAS miss) returns ALREADY_COMMITTING", async () => {
    const session = makeSession({ status: "committing" });
    const { service } = loadService({ sessions: [session] });

    await expect(
      service.commitImportSession({ userId: USER_ID, sessionId: SESSION_ID })
    ).rejects.toMatchObject({ code: "ALREADY_COMMITTING" });
  });

  test("an expired session returns SESSION_EXPIRED", async () => {
    const session = makeSession({ status: "expired" });
    const { service } = loadService({ sessions: [session] });

    await expect(
      service.commitImportSession({ userId: USER_ID, sessionId: SESSION_ID })
    ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  });

  test("a session not found or not owned by this user returns NOT_FOUND", async () => {
    const { service: serviceEmpty } = loadService({ sessions: [] });
    await expect(
      serviceEmpty.commitImportSession({ userId: USER_ID, sessionId: SESSION_ID })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const otherUsersSession = makeSession({ userId: OTHER_USER_ID });
    const { service: serviceWrongOwner } = loadService({ sessions: [otherUsersSession] });
    await expect(
      serviceWrongOwner.commitImportSession({ userId: USER_ID, sessionId: SESSION_ID })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a duplicate-key (11000) error on one row's save reuses the existing expense instead of failing the batch", async () => {
    const rows = [
      makeRow({ rowIndex: 0, decision: "accept", expenseName: "Already Committed Row" }),
      makeRow({ rowIndex: 1, decision: "accept", expenseName: "Fresh Row" }),
    ];
    const session = makeSession({ rows });
    const preExistingExpense = {
      _id: "exp-preexisting",
      userId: USER_ID,
      id: `import:${SESSION_ID}:0`,
      expenseName: "Already Committed Row",
    };
    const { service, expenseMockBundle, mocks } = loadService({
      sessions: [session],
      expenses: [preExistingExpense],
    });

    const result = await service.commitImportSession({ userId: USER_ID, sessionId: SESSION_ID });

    expect(result.committedCount).toBe(2);
    expect(result.skippedCount).toBe(0);
    expect(result.rows[0].committedExpenseId).toBe("exp-preexisting");
    expect(result.rows[1].committedExpenseId).toBeTruthy();
    expect(result.rows[1].committedExpenseId).not.toBe("exp-preexisting");

    expect(expenseMockBundle.ExpenseModelMock.findOne).toHaveBeenCalledWith({
      userId: USER_ID,
      id: `import:${SESSION_ID}:0`,
    });
    // The batch still finishes and syncs normally -- a per-row duplicate
    // is handled inline, never treated as a batch-level failure.
    expect(mocks.synchronizeAfterMutation).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("committed");
  });

  test("an unexpected non-duplicate error mid-loop reverts the session to previewing, keeps partial progress, and still rejects", async () => {
    const rows = [
      makeRow({ rowIndex: 0, decision: "accept", expenseName: "Succeeds First" }),
      makeRow({ rowIndex: 1, decision: "accept", expenseName: "FAIL_ROW" }),
    ];
    const session = makeSession({ rows });

    function flakySaveImpl() {
      if (this.expenseName === "FAIL_ROW") {
        throw new Error("simulated primary write failure");
      }
      return this;
    }

    const { service, mocks, importSessionMock } = loadService({
      sessions: [session],
      expenseSaveImpl: flakySaveImpl,
    });

    await expect(
      service.commitImportSession({ userId: USER_ID, sessionId: SESSION_ID })
    ).rejects.toThrow("simulated primary write failure");

    const persisted = importSessionMock.store[0];
    expect(persisted.status).toBe("previewing");
    // The row that succeeded before the failure keeps its
    // committedExpenseId even though the session-level counts were never
    // finalized -- the next retry's per-row idempotency key makes
    // re-attempting it safe.
    expect(persisted.rows[0].committedExpenseId).toBeTruthy();
    expect(persisted.rows[1].committedExpenseId).toBeNull();

    // Best-effort sync/cache still run even on the failure path.
    expect(mocks.synchronizeAfterMutation).toHaveBeenCalledTimes(1);
    expect(mocks.clearUserExpenseCache).toHaveBeenCalledTimes(1);
  });
});
