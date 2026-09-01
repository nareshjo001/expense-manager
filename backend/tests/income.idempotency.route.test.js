// Remediation Workstream B -- REAL route-level idempotency coverage for
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "income-add-idempotency-route-test-secret";
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
    { email: "income-add-idempotency-route-test@example.test", _id: userId },
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

// A stateful, in-memory stand-in for config/Schemas.js's real IncomeModel --
function makeIncomeModel() {
  const store = new Map(); // key: `${userId}:${idempotencyKey}` -> plain stored doc
  const perKeyChain = new Map();
  let idCounter = 0;

  let saveGate = null;
  let findOneCallCount = 0;

  function IncomeModelMock(doc) {
    Object.assign(this, doc);
    if (this.incomeDate !== undefined) {
      this.incomeDate = new Date(this.incomeDate);
    }

    this.save = async function () {
      if (saveGate) {
        await saveGate.promise;
      }

      const key = `${this.userId}:${this.idempotencyKey}`;

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
            `E11000 duplicate key error collection: test.incomes index: userId_1_idempotencyKey_1 dup key: { userId: "${this.userId}", idempotencyKey: "${this.idempotencyKey}" }`
          );
          err.code = 11000;
          err.name = "MongoServerError";
          err.keyPattern = { userId: 1, idempotencyKey: 1 };
          err.keyValue = { userId: this.userId, idempotencyKey: this.idempotencyKey };
          throw err;
        }
        this._id = `income-doc-${++idCounter}`;
        store.set(key, { ...this });
        return this;
      } finally {
        release();
      }
    };
  }

  IncomeModelMock.findOne = (query) => ({
    lean: async () => {
      findOneCallCount += 1;
      if (saveGate && findOneCallCount >= saveGate.releaseAtCount) {
        saveGate.resolve();
      }
      const key = `${query.userId}:${query.idempotencyKey}`;
      const doc = store.get(key);
      return doc ? { ...doc } : null;
    },
  });

  IncomeModelMock.__store = store;
  IncomeModelMock.__armConcurrentSaveGate = (releaseAtCount) => {
    let resolve;
    const promise = new Promise((res) => {
      resolve = res;
    });
    saveGate = { promise, resolve, releaseAtCount };
  };

  return IncomeModelMock;
}

function loadApp() {
  jest.resetModules();

  const findByIdMock = jest.fn(async (id) => ({ _id: id }));
  const IncomeModelMock = makeIncomeModel();

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: findByIdMock },
    IncomeModel: IncomeModelMock,
    ExpenseModel: {},
    BudgetModel: {},
    MlFeedbackModel: {},
  }));

  const synchronizeAfterMutationMock = jest.fn(async () => SYNCHRONIZED_RESULT);
  const reserveMock = jest.fn(async () => ({
    budgetReservations: [],
    reportReservation: { token: "report-token-1" },
    userWideReservation: null,
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

  const app = require(APP_PATH);
  return {
    app,
    findByIdMock,
    IncomeModelMock,
    synchronizeAfterMutationMock,
    reserveMock,
    abandonMock,
  };
}

const validIncomePayload = (overrides = {}) => ({
  id: "income-add-1",
  incomeSource: "Salary",
  incomeAmount: 5000,
  incomeDate: "2026-01-15",
  ...overrides,
});

const postAdd = (app, userId, payload) =>
  request(app)
    .post("/income/add")
    .set("Authorization", `Bearer ${signToken(userId)}`)
    .send(payload);

describe("POST /income/add -- real route-level idempotency (Remediation Workstream B)", () => {
  it("1. first add succeeds and persists exactly one document", async () => {
    const { app, IncomeModelMock, synchronizeAfterMutationMock } = loadApp();

    const res = await postAdd(app, USER_ID, validIncomePayload({ id: "first-add" }));

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.replayed).toBe(false);
    expect(IncomeModelMock.__store.size).toBe(1);
    expect(synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
  });

  it("2/3. same key + same normalized payload replays safely, never creates a second document", async () => {
    const { app, IncomeModelMock } = loadApp();

    const first = await postAdd(app, USER_ID, validIncomePayload({ id: "replay-1" }));
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);

    const replay = await postAdd(
      app,
      USER_ID,
      validIncomePayload({ id: "replay-1", incomeSource: "  Salary  " })
    );

    expect(replay.status).toBe(201);
    expect(replay.body.replayed).toBe(true);
    expect(IncomeModelMock.__store.size).toBe(1);
    const stored = IncomeModelMock.__store.get(`${USER_ID}:replay-1`);
    expect(stored._id).toBe(first.body.data._id);
  });

  it("3b. same key + conflicting payload returns 409 conflict, never mutates the original", async () => {
    const { app, IncomeModelMock, synchronizeAfterMutationMock } = loadApp();

    const first = await postAdd(app, USER_ID, validIncomePayload({ id: "conflict-1" }));
    expect(first.status).toBe(201);
    synchronizeAfterMutationMock.mockClear();

    const conflict = await postAdd(
      app,
      USER_ID,
      validIncomePayload({ id: "conflict-1", incomeAmount: 999 })
    );

    expect(conflict.status).toBe(409);
    expect(conflict.body.errorCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(IncomeModelMock.__store.size).toBe(1);
    const stored = IncomeModelMock.__store.get(`${USER_ID}:conflict-1`);
    expect(stored.incomeAmount).toBe(5000);
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();
  });

  it("4. a genuine concurrent same-key race (same payload) resolves as one commit + one replay, never two documents", async () => {
    const { app, IncomeModelMock } = loadApp();
    IncomeModelMock.__armConcurrentSaveGate(2);

    const payload = validIncomePayload({ id: "race-same-payload" });
    const [resA, resB] = await Promise.all([
      postAdd(app, USER_ID, payload),
      postAdd(app, USER_ID, payload),
    ]);

    const responses = [resA, resB];
    expect(responses.every((r) => r.status === 201)).toBe(true);
    const replayedFlags = responses.map((r) => r.body.replayed).sort();
    expect(replayedFlags).toEqual([false, true]);
    expect(IncomeModelMock.__store.size).toBe(1);
  });

  it("5. E11000 race resolves deterministically as one commit + one 409, never a 500", async () => {
    const { app, IncomeModelMock } = loadApp();
    IncomeModelMock.__armConcurrentSaveGate(2);

    const [resA, resB] = await Promise.all([
      postAdd(app, USER_ID, validIncomePayload({ id: "race-conflict", incomeAmount: 5000 })),
      postAdd(app, USER_ID, validIncomePayload({ id: "race-conflict", incomeAmount: 999 })),
    ]);

    const statuses = [resA, resB].map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    expect(IncomeModelMock.__store.size).toBe(1);
  });

  it("6. same key for different users remains isolated", async () => {
    const { app, IncomeModelMock } = loadApp();

    const first = await postAdd(app, USER_ID, validIncomePayload({ id: "shared-id" }));
    const second = await postAdd(app, OTHER_USER_ID, validIncomePayload({ id: "shared-id" }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.replayed).toBe(false);
    expect(IncomeModelMock.__store.size).toBe(2);
    expect(IncomeModelMock.__store.has(`${USER_ID}:shared-id`)).toBe(true);
    expect(IncomeModelMock.__store.has(`${OTHER_USER_ID}:shared-id`)).toBe(true);
  });

  it("7. a missing id is rejected by the real Joi middleware before reaching the controller", async () => {
    const { app, IncomeModelMock } = loadApp();

    const res = await postAdd(app, USER_ID, { incomeSource: "Salary", incomeAmount: 100, incomeDate: "2026-01-15" });

    expect(res.status).toBe(400);
    expect(IncomeModelMock.__store.size).toBe(0);
  });

  it("8. a non-string id (object) is rejected with a controlled 400, never reaches the database as a query operator", async () => {
    const { app, IncomeModelMock } = loadApp();

    // Joi's `id: Joi.string().required()` already rejects a non-string at
    const res = await postAdd(app, USER_ID, validIncomePayload({ id: { $ne: null } }));

    expect(res.status).toBe(400);
    expect(IncomeModelMock.__store.size).toBe(0);
  });

  it("9. an oversized id is rejected by the controller's own bounded-length check", async () => {
    const { app, IncomeModelMock } = loadApp();

    const res = await postAdd(app, USER_ID, validIncomePayload({ id: "x".repeat(500) }));

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_IDEMPOTENCY_KEY");
    expect(IncomeModelMock.__store.size).toBe(0);
  });
});
