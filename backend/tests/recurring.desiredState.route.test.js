// Recurring-state authority remediation -- REAL route-level coverage for
// PATCH /api/recurring's redesign into an idempotent desired-state
// operation, backed by a STATEFUL in-memory fake RecurringExpenseModel that
// actually enforces the real {userId, expenseId} unique index (including a
// genuine, deterministically-forced E11000 race via a promise-chain mutex,
// the same technique tests/expense.addExpense.idempotency.route.test.js
// uses) rather than a bare call-count stub.
//
// Confirmed defect this closes: a crash between the RecurringExpenseModel
// write and the Expense.isRecurring mirror write left an active,
// cron-processed schedule with no way to disable it through normal use
// (retrying the mark request hit E11000 and returned 400 with no repair).
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const SCHEMAS_PATH = "../config/Schemas";
const RECURRING_MODEL_PATH = "../models/RecurringExpense";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "recurring-desired-state-route-test-secret";
let originalJwtSecret;

beforeAll(() => {
  originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function signToken(userId) {
  return jwt.sign({ email: "recurring-route-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";
const EXPENSE_ID = "64f1a2b3c4d5e6f7a8b9c0cc";
const OTHER_EXPENSE_ID = "64f1a2b3c4d5e6f7a8b9c0dd";

// A stateful, in-memory stand-in for models/RecurringExpense.js's real
// RecurringExpenseModel -- actually enforces the {userId, expenseId} unique
// index and actually tracks documents, rather than a per-test-scripted stub.
function makeRecurringExpenseModel() {
  const store = new Map(); // key: `${userId}:${expenseId}` -> plain doc
  const perKeyChain = new Map();
  let idCounter = 0;

  // Deterministic concurrency control (never a real sleep/timer): when
  // armed via __armConcurrentUpsertGate(n), every findOneAndUpdate call
  // blocks until at least n calls have reached this point -- i.e. until
  // every concurrent request has already begun its own upsert attempt,
  // exactly like two real concurrent requests racing on the same key.
  let gate = null;
  let callCount = 0;

  function key(userId, expenseId) {
    return `${userId}:${String(expenseId)}`;
  }

  async function findOneAndUpdate(filter, update, options) {
    const k = key(filter.userId, filter.expenseId);
    const upsert = !!(options && options.upsert);

    if (gate) {
      callCount += 1;
      if (callCount >= gate.releaseAtCount) gate.resolve();
      await gate.promise;
    }

    const previous = perKeyChain.get(k) || Promise.resolve();
    let release;
    const ownTurn = new Promise((resolve) => {
      release = resolve;
    });
    perKeyChain.set(k, previous.then(() => ownTurn));
    const existedBeforeThisTurn = store.has(k);
    await previous;

    try {
      if (store.has(k)) {
        if (!existedBeforeThisTurn && upsert) {
          // Another concurrent call committed its insert while this one was
          // waiting for its turn -- a genuine race, surfaced as a
          // real-shaped E11000, exactly the scenario recurring.js's
          // catch(err.code===11000) branch exists to handle.
          const err = new Error(
            `E11000 duplicate key error collection: test.recurringExpenses index: userId_1_expenseId_1 dup key: { userId: "${filter.userId}", expenseId: "${filter.expenseId}" }`
          );
          err.code = 11000;
          err.name = "MongoServerError";
          throw err;
        }
        // Already exists -- $setOnInsert must never overwrite it.
        return { ...store.get(k) };
      }
      if (!upsert) return null;
      const doc = { _id: `recdef-${++idCounter}`, userId: filter.userId, expenseId: filter.expenseId, ...update.$setOnInsert };
      store.set(k, doc);
      return { ...doc };
    } finally {
      release();
    }
  }

  async function findOneAndDelete(filter) {
    const k = key(filter.userId, filter.expenseId);
    const existing = store.get(k);
    store.delete(k);
    return existing ? { ...existing } : null;
  }

  async function findOne(filter) {
    const k = key(filter.userId, filter.expenseId);
    const doc = store.get(k);
    return doc ? { ...doc } : null;
  }

  // Supports recurringStateService.js's batched read (`.find({userId,
  // expenseId:{$in:[...]}}).lean()`).
  function find(filter) {
    return {
      lean: async () => {
        const ids = new Set((filter.expenseId && filter.expenseId.$in ? filter.expenseId.$in : []).map(String));
        return [...store.values()].filter(
          (doc) => String(doc.userId) === String(filter.userId) && ids.has(String(doc.expenseId))
        );
      },
    };
  }

  return {
    findOneAndUpdate,
    findOneAndDelete,
    findOne,
    find,
    __store: store,
    __armConcurrentUpsertGate: (releaseAtCount) => {
      let resolve;
      const promise = new Promise((res) => {
        resolve = res;
      });
      gate = { promise, resolve, releaseAtCount };
    },
  };
}

// A stateful, in-memory stand-in for config/Schemas.js's real ExpenseModel,
// scoped to exactly what recurring.js calls: findOne and updateOne.
function makeExpenseModel(seedDocs) {
  const store = new Map();
  for (const doc of seedDocs) store.set(String(doc._id), { ...doc });

  let mirrorUpdateShouldThrow = false;

  return {
    __store: store,
    __setMirrorUpdateShouldThrow: (value) => {
      mirrorUpdateShouldThrow = value;
    },
    findOne: async (query) => {
      const doc = store.get(String(query._id));
      if (!doc || String(doc.userId) !== String(query.userId)) return null;
      return { ...doc };
    },
    updateOne: async (query, update) => {
      if (mirrorUpdateShouldThrow) {
        const err = new Error("simulated mirror-write crash");
        throw err;
      }
      const doc = store.get(String(query._id));
      if (!doc || String(doc.userId) !== String(query.userId)) {
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      }
      Object.assign(doc, update.$set);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    },
  };
}

function loadApp(seedExpenses) {
  jest.resetModules();

  const ExpenseModelMock = makeExpenseModel(seedExpenses);
  const RecurringExpenseModelMock = makeRecurringExpenseModel();

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: jest.fn(async (id) => ({ _id: id })) },
    ExpenseModel: ExpenseModelMock,
    MlFeedbackModel: {},
    BudgetModel: {},
    IncomeModel: {},
  }));

  jest.doMock(RECURRING_MODEL_PATH, () => ({
    RecurringExpenseModel: RecurringExpenseModelMock,
  }));

  const clearUserExpenseCacheMock = jest.fn(async () => {});
  jest.doMock(EXPENSE_CACHE_PATH, () => ({
    clearUserExpenseCache: clearUserExpenseCacheMock,
    setCache: jest.fn(async () => {}),
    getCache: jest.fn(async () => null),
  }));

  const app = require(APP_PATH);
  return { app, ExpenseModelMock, RecurringExpenseModelMock, clearUserExpenseCacheMock };
}

const seedExpense = (overrides = {}) => ({
  _id: EXPENSE_ID,
  userId: USER_ID,
  expenseName: "Netflix",
  expenseCategory: "Entertainment",
  expenseAmount: 15.99,
  expenseDate: new Date("2026-01-05T00:00:00.000Z"),
  isRecurring: false,
  ...overrides,
});

const patchRecurring = (app, userId, body) =>
  request(app)
    .patch("/api/recurring")
    .set("Authorization", `Bearer ${signToken(userId)}`)
    .send(body);

describe("PATCH /api/recurring -- idempotent desired-state operation", () => {
  it("1. valid mark creates exactly one definition and reports success", async () => {
    const { app, RecurringExpenseModelMock, ExpenseModelMock } = loadApp([seedExpense()]);

    const res = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isRecurring).toBe(true);
    expect(RecurringExpenseModelMock.__store.size).toBe(1);
    expect(ExpenseModelMock.__store.get(EXPENSE_ID).isRecurring).toBe(true);
  });

  it("2. valid unmark deletes the definition and reports success", async () => {
    const { app, RecurringExpenseModelMock, ExpenseModelMock } = loadApp([seedExpense({ isRecurring: true })]);
    RecurringExpenseModelMock.__store.set(`${USER_ID}:${EXPENSE_ID}`, {
      _id: "recdef-seed",
      userId: USER_ID,
      expenseId: EXPENSE_ID,
      expenseName: "Netflix",
      expenseCategory: "Entertainment",
      expenseAmount: 15.99,
      lastLoggedDate: new Date("2026-01-05T00:00:00.000Z"),
      nextDueDate: new Date("2026-02-01T00:00:00.000Z"),
    });

    const res = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.isRecurring).toBe(false);
    expect(RecurringExpenseModelMock.__store.size).toBe(0);
    expect(ExpenseModelMock.__store.get(EXPENSE_ID).isRecurring).toBe(false);
  });

  it("3. repeated mark is a successful idempotent replay -- no error, no duplicate definition", async () => {
    const { app, RecurringExpenseModelMock } = loadApp([seedExpense()]);

    const first = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });
    const second = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(second.body.isRecurring).toBe(true);
    expect(RecurringExpenseModelMock.__store.size).toBe(1);
  });

  it("4. repeated unmark is a successful idempotent replay -- absent definition is a safe no-op", async () => {
    const { app, RecurringExpenseModelMock } = loadApp([seedExpense()]);

    const first = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: false });
    const second = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: false });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(second.body.isRecurring).toBe(false);
    expect(RecurringExpenseModelMock.__store.size).toBe(0);
  });

  it("5. mark replay repairs a stale Expense.isRecurring=false left over from a prior crash", async () => {
    // Simulates the exact confirmed defect: the definition already exists
    // (from a prior request whose mirror write never landed), but the
    // Expense document still shows isRecurring:false.
    const { app, RecurringExpenseModelMock, ExpenseModelMock } = loadApp([seedExpense({ isRecurring: false })]);
    RecurringExpenseModelMock.__store.set(`${USER_ID}:${EXPENSE_ID}`, {
      _id: "recdef-precrash",
      userId: USER_ID,
      expenseId: EXPENSE_ID,
      expenseName: "Netflix",
      expenseCategory: "Entertainment",
      expenseAmount: 15.99,
      lastLoggedDate: new Date("2026-01-05T00:00:00.000Z"),
      nextDueDate: new Date("2026-02-01T00:00:00.000Z"),
    });

    const res = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(ExpenseModelMock.__store.get(EXPENSE_ID).isRecurring).toBe(true);
    expect(RecurringExpenseModelMock.__store.size).toBe(1);
  });

  it("6. unmark replay repairs a stale Expense.isRecurring=true left over from a prior crash", async () => {
    const { app, ExpenseModelMock } = loadApp([seedExpense({ isRecurring: true })]);
    // No RecurringExpense definition exists (already durably deleted by a
    // prior crashed request) -- the mirror is the only thing out of sync.

    const res = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: false });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(ExpenseModelMock.__store.get(EXPENSE_ID).isRecurring).toBe(false);
  });

  it("7/8. concurrent mark calls produce exactly one definition -- a genuine E11000 race is re-read and treated as successful state", async () => {
    const { app, RecurringExpenseModelMock } = loadApp([seedExpense()]);
    RecurringExpenseModelMock.__armConcurrentUpsertGate(2);

    const [resA, resB] = await Promise.all([
      patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true }),
      patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true }),
    ]);

    expect([resA.status, resB.status]).toEqual([200, 200]);
    expect(resA.body.success).toBe(true);
    expect(resB.body.success).toBe(true);
    // Never a 400 "Already marked as recurring" -- both concurrent callers
    // observe the same successfully-achieved desired state.
    expect(RecurringExpenseModelMock.__store.size).toBe(1);
  });

  it("9. existing recurring definition fields are not overwritten during a mark replay", async () => {
    const { app, RecurringExpenseModelMock } = loadApp([seedExpense()]);
    const originalNextDueDate = new Date("2099-01-01T00:00:00.000Z"); // deliberately distinct from what the controller would compute today
    RecurringExpenseModelMock.__store.set(`${USER_ID}:${EXPENSE_ID}`, {
      _id: "recdef-preexisting",
      userId: USER_ID,
      expenseId: EXPENSE_ID,
      expenseName: "Custom Name Set By An Earlier Edit",
      expenseCategory: "Entertainment",
      expenseAmount: 999,
      lastLoggedDate: new Date("2020-01-01T00:00:00.000Z"),
      nextDueDate: originalNextDueDate,
    });

    const res = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });

    expect(res.status).toBe(200);
    const stored = RecurringExpenseModelMock.__store.get(`${USER_ID}:${EXPENSE_ID}`);
    expect(stored.expenseName).toBe("Custom Name Set By An Earlier Edit");
    expect(stored.expenseAmount).toBe(999);
    expect(stored.nextDueDate).toEqual(originalNextDueDate);
  });

  it("10. malformed ObjectId returns 400 with no database mutation", async () => {
    const { app, RecurringExpenseModelMock, ExpenseModelMock } = loadApp([seedExpense()]);

    const res = await patchRecurring(app, USER_ID, { expenseId: "not-a-valid-object-id", isRecurring: true });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(RecurringExpenseModelMock.__store.size).toBe(0);
    expect(ExpenseModelMock.__store.get(EXPENSE_ID).isRecurring).toBe(false);
  });

  it("11. missing expenseId returns 400", async () => {
    const { app } = loadApp([seedExpense()]);
    const res = await patchRecurring(app, USER_ID, { isRecurring: true });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("12. missing/non-boolean isRecurring returns 400", async () => {
    const { app } = loadApp([seedExpense()]);

    const missing = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID });
    expect(missing.status).toBe(400);

    const nonBoolean = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: "true" });
    expect(nonBoolean.status).toBe(400);
  });

  it("13. a foreign-owned expense and a nonexistent expense id both return the identical non-disclosing 404", async () => {
    const { app } = loadApp([seedExpense()]);

    const foreign = await patchRecurring(app, OTHER_USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });
    const nonexistent = await patchRecurring(app, USER_ID, { expenseId: OTHER_EXPENSE_ID, isRecurring: true });

    expect(foreign.status).toBe(404);
    expect(nonexistent.status).toBe(404);
    expect(foreign.body).toEqual(nonexistent.body);
  });

  it("14. authoritative mutation success followed by a mirror-write failure remains safely retryable and eventually repairs", async () => {
    const { app, ExpenseModelMock, RecurringExpenseModelMock } = loadApp([seedExpense()]);
    ExpenseModelMock.__setMirrorUpdateShouldThrow(true);

    const failed = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });
    expect(failed.status).toBe(500);
    // The authoritative definition is already committed despite the
    // generic failure response -- it must never be undone based on an
    // ambiguous mirror-write failure.
    expect(RecurringExpenseModelMock.__store.size).toBe(1);
    expect(ExpenseModelMock.__store.get(EXPENSE_ID).isRecurring).toBe(false);

    ExpenseModelMock.__setMirrorUpdateShouldThrow(false);
    const retried = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });
    expect(retried.status).toBe(200);
    expect(retried.body.success).toBe(true);
    expect(RecurringExpenseModelMock.__store.size).toBe(1);
    expect(ExpenseModelMock.__store.get(EXPENSE_ID).isRecurring).toBe(true);
  });

  it("15. no raw database error object/message ever reaches the response body", async () => {
    const { app, ExpenseModelMock } = loadApp([seedExpense()]);
    ExpenseModelMock.__setMirrorUpdateShouldThrow(true);

    const res = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/simulated mirror-write crash/);
    expect(res.body).toEqual({ message: "Internal Server Error", success: false });
  });
});

describe("PATCH /api/recurring -- crash-sequence regression (confirmed defect closure)", () => {
  it("mark crash: definition commit succeeds, mirror update fails, subsequent read reports active state, retry succeeds, mirror repairs, user can then unmark, no duplicate definition is ever created", async () => {
    const { app, ExpenseModelMock, RecurringExpenseModelMock } = loadApp([seedExpense()]);
    ExpenseModelMock.__setMirrorUpdateShouldThrow(true);

    // 1-2. Definition commit succeeds; mirror update fails/"crashes".
    const crashed = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });
    expect(crashed.status).toBe(500);
    expect(RecurringExpenseModelMock.__store.size).toBe(1);

    // 3. Subsequent authoritative read (what the new annotation helper
    // exposes) reports active recurring state despite the stale mirror.
    const { annotateRecurringState } = require("../Services/RecurringServices/recurringStateService");
    const annotated = await annotateRecurringState(USER_ID, { _id: EXPENSE_ID });
    expect(annotated.isRecurring).toBe(true);

    // 4-5. UI-equivalent retry (same mark request) succeeds and repairs the mirror.
    ExpenseModelMock.__setMirrorUpdateShouldThrow(false);
    const retried = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: true });
    expect(retried.status).toBe(200);
    expect(ExpenseModelMock.__store.get(EXPENSE_ID).isRecurring).toBe(true);

    // 6. User can subsequently unmark.
    const unmarked = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: false });
    expect(unmarked.status).toBe(200);
    expect(RecurringExpenseModelMock.__store.size).toBe(0);

    // 7. No duplicate definition was ever created across this whole sequence.
    expect(RecurringExpenseModelMock.__store.size).toBe(0);
  });

  it("unmark crash: definition deletion succeeds, mirror update fails, subsequent read reports inactive state, retry succeeds and repairs the mirror", async () => {
    const { app, ExpenseModelMock, RecurringExpenseModelMock } = loadApp([seedExpense({ isRecurring: true })]);
    RecurringExpenseModelMock.__store.set(`${USER_ID}:${EXPENSE_ID}`, {
      _id: "recdef-seed",
      userId: USER_ID,
      expenseId: EXPENSE_ID,
      expenseName: "Netflix",
      expenseCategory: "Entertainment",
      expenseAmount: 15.99,
      lastLoggedDate: new Date("2026-01-05T00:00:00.000Z"),
      nextDueDate: new Date("2026-02-01T00:00:00.000Z"),
    });
    ExpenseModelMock.__setMirrorUpdateShouldThrow(true);

    // 1-2. Definition deletion succeeds; mirror update fails/"crashes".
    const crashed = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: false });
    expect(crashed.status).toBe(500);
    expect(RecurringExpenseModelMock.__store.size).toBe(0);

    // 3. Subsequent authoritative read reports inactive state.
    const { annotateRecurringState } = require("../Services/RecurringServices/recurringStateService");
    const annotated = await annotateRecurringState(USER_ID, { _id: EXPENSE_ID });
    expect(annotated.isRecurring).toBe(false);

    // 4-5. Retry succeeds and repairs the mirror.
    ExpenseModelMock.__setMirrorUpdateShouldThrow(false);
    const retried = await patchRecurring(app, USER_ID, { expenseId: EXPENSE_ID, isRecurring: false });
    expect(retried.status).toBe(200);
    expect(ExpenseModelMock.__store.get(EXPENSE_ID).isRecurring).toBe(false);
  });
});
