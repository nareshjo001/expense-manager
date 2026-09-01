// Phase C.2, requirement 6 -- REAL route-level idempotency replay/conflict
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const RECURRING_MODEL_PATH = "../models/RecurringExpense";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "expense-addexpense-idempotency-route-test-secret";
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
  return jwt.sign(
    { email: "expense-addexpense-idempotency-route-test@example.test", _id: userId },
    TEST_JWT_SECRET
  );
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";

const SYNCHRONIZED_RESULT = {
  status: "synchronized",
  budget: "synchronized",
  report: "synchronized",
  recoveryPending: false,
};

// A stateful, in-memory stand-in for config/Schemas.js's real ExpenseModel
function makeExpenseModel() {
  const store = new Map(); // key: `${userId}:${id}` -> plain stored doc
  const perKeyChain = new Map(); // key -> promise chain, serializes concurrent save() calls per key
  let idCounter = 0;

  // Deterministic concurrency control (never a real sleep/timer): when
  let saveGate = null;
  let findOneCallCount = 0;

  function ExpenseModelMock(doc) {
    Object.assign(this, doc);
    if (this.expenseDate !== undefined) {
      this.expenseDate = new Date(this.expenseDate);
    }

    this.save = async function () {
      if (saveGate) {
        await saveGate.promise;
      }

      const key = `${this.userId}:${this.id}`;

      // Serialize concurrent save() calls for the SAME key through a
      const previous = perKeyChain.get(key) || Promise.resolve();
      let release;
      const ownTurn = new Promise((resolve) => {
        release = resolve;
      });
      perKeyChain.set(
        key,
        previous.then(() => ownTurn)
      );
      await previous;

      try {
        if (store.has(key)) {
          const err = new Error(
            `E11000 duplicate key error collection: test.expenses index: userId_1_id_1 dup key: { userId: "${this.userId}", id: "${this.id}" }`
          );
          err.code = 11000;
          err.name = "MongoServerError";
          err.keyPattern = { userId: 1, id: 1 };
          err.keyValue = { userId: this.userId, id: this.id };
          throw err;
        }
        this._id = `expense-doc-${++idCounter}`;
        store.set(key, { ...this });
        return this;
      } finally {
        release();
      }
    };
  }

  ExpenseModelMock.findOne = (query) => ({
    lean: async () => {
      findOneCallCount += 1;
      if (saveGate && findOneCallCount >= saveGate.releaseAtCount) {
        saveGate.resolve();
      }
      const key = `${query.userId}:${query.id}`;
      const doc = store.get(key);
      return doc ? { ...doc } : null;
    },
  });

  ExpenseModelMock.__store = store;
  ExpenseModelMock.__armConcurrentSaveGate = (releaseAtCount) => {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    saveGate = { promise, resolve, releaseAtCount };
  };

  return ExpenseModelMock;
}

function loadApp() {
  jest.resetModules();

  const findByIdMock = jest.fn(async (id) => ({ _id: id }));
  const ExpenseModelMock = makeExpenseModel();

  const mlFeedbackSaveMock = jest.fn().mockResolvedValue(undefined);
  function MlFeedbackModelMock(doc) {
    Object.assign(this, doc);
    this.save = mlFeedbackSaveMock;
  }

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: findByIdMock },
    ExpenseModel: ExpenseModelMock,
    MlFeedbackModel: MlFeedbackModelMock,
    BudgetModel: {},
    IncomeModel: {},
  }));

  const synchronizeAfterMutationMock = jest.fn(async () => SYNCHRONIZED_RESULT);
  const reserveMock = jest.fn(async () => ({
    budgetReservations: [{ month: new Date("2026-01-01T00:00:00.000Z"), token: "budget-token-1" }],
    reportReservation: { token: "report-token-1" },
  }));
  const abandonMock = jest.fn(async () => null);
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    synchronizeAfterMutation: synchronizeAfterMutationMock,
    reserve: reserveMock,
    abandon: abandonMock,
    confirm: jest.fn(),
    repairIfPending: jest.fn(async () => ({ attempted: false, stillPending: false })),
    markPending: jest.fn(),
    getPendingSync: jest.fn(),
    clearIfRevisionMatches: jest.fn(),
  }));

  const clearUserExpenseCacheMock = jest.fn(async () => {});
  jest.doMock(EXPENSE_CACHE_PATH, () => ({
    clearUserExpenseCache: clearUserExpenseCacheMock,
    setCache: jest.fn(async () => {}),
    getCache: jest.fn(async () => null),
  }));

  // Recurring-state authority remediation -- addexpense.js's replay path
  jest.doMock(RECURRING_MODEL_PATH, () => ({
    RecurringExpenseModel: { find: () => ({ lean: async () => [] }) },
  }));

  const app = require(APP_PATH);
  return {
    app,
    findByIdMock,
    ExpenseModelMock,
    synchronizeAfterMutationMock,
    reserveMock,
    abandonMock,
    clearUserExpenseCacheMock,
  };
}

// expenseDescription is always non-empty so the (unmocked, real) axios ML
// description call in addexpense.js is never reached.
const validAddPayload = (overrides = {}) => ({
  id: "add-1",
  expenseName: "Coffee",
  expenseCategory: "Food",
  expenseAmount: 5.5,
  expenseDate: "2026-01-15",
  expenseDescription: "Morning coffee",
  ...overrides,
});

const postAdd = (app, userId, payload) =>
  request(app)
    .post("/expense/add-expense")
    .set("Authorization", `Bearer ${signToken(userId)}`)
    .send(payload);

describe("POST /expense/add-expense -- real route-level idempotency (Phase C.2, requirement 6)", () => {
  it("1. first add succeeds and persists exactly one document", async () => {
    const { app, ExpenseModelMock, synchronizeAfterMutationMock } = loadApp();

    const res = await postAdd(app, USER_ID, validAddPayload({ id: "first-add" }));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.replayed).toBe(false);
    expect(ExpenseModelMock.__store.size).toBe(1);
    expect(synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
  });

  it("2/3/4. a replay with an equivalent normalized payload (same user+id) returns replayed:true and creates no second document", async () => {
    const { app, ExpenseModelMock } = loadApp();

    const first = await postAdd(app, USER_ID, validAddPayload({ id: "replay-1" }));
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    expect(ExpenseModelMock.__store.size).toBe(1);

    // Same economic identity (name/category/amount/date), differing only in
    const replay = await postAdd(
      app,
      USER_ID,
      validAddPayload({ id: "replay-1", expenseName: "  Coffee  " })
    );

    expect(replay.status).toBe(201);
    expect(replay.body.success).toBe(true);
    expect(replay.body.replayed).toBe(true);
    // Only one document ever exists for this user+id.
    expect(ExpenseModelMock.__store.size).toBe(1);
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:replay-1`);
    expect(stored.expenseName).toBe("Coffee");
    expect(stored._id).toBe(first.body.data._id);
  });

  it("5. same user+id with a materially different payload returns 409 IDEMPOTENCY_KEY_CONFLICT, never mutates the original, and never re-runs sync", async () => {
    const { app, ExpenseModelMock, synchronizeAfterMutationMock } = loadApp();

    const first = await postAdd(app, USER_ID, validAddPayload({ id: "conflict-1" }));
    expect(first.status).toBe(201);
    synchronizeAfterMutationMock.mockClear();

    const conflict = await postAdd(
      app,
      USER_ID,
      validAddPayload({ id: "conflict-1", expenseAmount: 999 })
    );

    expect(conflict.status).toBe(409);
    expect(conflict.body.success).toBe(false);
    expect(conflict.body.errorCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
    // Exactly one document, completely unmutated by the conflicting attempt.
    expect(ExpenseModelMock.__store.size).toBe(1);
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:conflict-1`);
    expect(stored.expenseAmount).toBe(5.5);
    expect(stored._id).toBe(first.body.data._id);
    // No extra derived-data synchronization for a rejected conflict.
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();
  });

  it("6. a different authenticated user may independently reuse the exact same id", async () => {
    const { app, ExpenseModelMock } = loadApp();

    const first = await postAdd(app, USER_ID, validAddPayload({ id: "shared-id" }));
    const second = await postAdd(app, OTHER_USER_ID, validAddPayload({ id: "shared-id" }));

    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    expect(second.status).toBe(201);
    expect(second.body.replayed).toBe(false);

    // Two independent documents -- ownership-scoped, never cross-user.
    expect(ExpenseModelMock.__store.size).toBe(2);
    expect(ExpenseModelMock.__store.has(`${USER_ID}:shared-id`)).toBe(true);
    expect(ExpenseModelMock.__store.has(`${OTHER_USER_ID}:shared-id`)).toBe(true);
  });

  it("7a. a genuine concurrent E11000 race (same id, same payload) resolves as exactly one commit + one replay, never two documents", async () => {
    const { app, ExpenseModelMock } = loadApp();
    // Both requests' pre-write idempotency check must run before either
    ExpenseModelMock.__armConcurrentSaveGate(2);

    const payload = validAddPayload({ id: "race-same-payload" });
    const [resA, resB] = await Promise.all([
      postAdd(app, USER_ID, payload),
      postAdd(app, USER_ID, payload),
    ]);

    const responses = [resA, resB];
    expect(responses.every((r) => r.status === 201)).toBe(true);
    expect(responses.every((r) => r.body.success === true)).toBe(true);

    const replayedFlags = responses.map((r) => r.body.replayed).sort();
    // Exactly one genuine commit, one reconciled replay.
    expect(replayedFlags).toEqual([false, true]);

    // The real unique index (simulated here) never allows two documents to
    // exist for the same { userId, id }.
    expect(ExpenseModelMock.__store.size).toBe(1);
  });

  it("7b. a genuine concurrent E11000 race (same id, different payload) resolves as exactly one commit + one 409 conflict, never two documents", async () => {
    const { app, ExpenseModelMock } = loadApp();
    ExpenseModelMock.__armConcurrentSaveGate(2);

    const [resA, resB] = await Promise.all([
      postAdd(app, USER_ID, validAddPayload({ id: "race-conflict", expenseAmount: 5.5 })),
      postAdd(app, USER_ID, validAddPayload({ id: "race-conflict", expenseAmount: 999 })),
    ]);

    const responses = [resA, resB];
    const statuses = responses.map((r) => r.status).sort();
    // One genuine commit (201), one rejected as a conflict (409) -- never
    // two silently-created documents, and never a 500.
    expect(statuses).toEqual([201, 409]);

    const conflictRes = responses.find((r) => r.status === 409);
    expect(conflictRes.body.errorCode).toBe("IDEMPOTENCY_KEY_CONFLICT");

    expect(ExpenseModelMock.__store.size).toBe(1);
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:race-conflict`);
    // The stored document belongs to whichever request actually won the
    expect([5.5, 999]).toContain(stored.expenseAmount);
  });
});
