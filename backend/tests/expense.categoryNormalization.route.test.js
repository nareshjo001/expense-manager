// Category Normalization -- single implementation pass, required test
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const mongoose = require("mongoose");

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const RECURRING_MODEL_PATH = "../models/RecurringExpense";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "expense-category-normalization-route-test-secret";
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
    { email: "expense-category-normalization-route-test@example.test", _id: userId },
    TEST_JWT_SECRET
  );
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

const SYNCHRONIZED_RESULT = {
  status: "synchronized",
  budget: "synchronized",
  report: "synchronized",
  recoveryPending: false,
};

// Stateful in-memory ExpenseModel stand-in, same shape as
function makeExpenseModel() {
  const store = new Map();
  let idCounter = 0;

  function ExpenseModelMock(doc) {
    Object.assign(this, doc);
    if (this.expenseDate !== undefined) {
      this.expenseDate = new Date(this.expenseDate);
    }

    this.save = async function () {
      const key = `${this.userId}:${this.id}`;
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
    };
  }

  // Supports both call shapes used across the two controllers:
  ExpenseModelMock.findOne = (query) => {
    const resolve = async () => {
      if (query.id !== undefined) {
        const key = `${query.userId}:${query.id}`;
        const doc = store.get(key);
        return doc ? { ...doc } : null;
      }
      // Lookup by _id (editExpense.js's shape: { _id, userId }).
      for (const doc of store.values()) {
        if (String(doc._id) === String(query._id) && String(doc.userId) === String(query.userId)) {
          return { ...doc };
        }
      }
      return null;
    };
    return {
      lean: resolve,
      then: (onFulfilled, onRejected) => resolve().then(onFulfilled, onRejected),
    };
  };

  // Minimal findOneAndUpdate for the edit route: looks the doc up by _id,
  ExpenseModelMock.findOneAndUpdate = async (query, update) => {
    let foundKey = null;
    let foundDoc = null;
    for (const [key, doc] of store.entries()) {
      if (String(doc._id) === String(query._id) && String(doc.userId) === String(query.userId)) {
        foundKey = key;
        foundDoc = doc;
        break;
      }
    }
    if (!foundDoc) return null;

    const prior = { ...foundDoc };
    const updated = { ...foundDoc, ...(update.$set || {}) };
    store.set(foundKey, updated);
    return { ...prior, toObject: () => ({ ...prior }) };
  };

  ExpenseModelMock.__store = store;
  // Real mongoose (unmocked) validates expenseId via
  ExpenseModelMock.__seed = (doc) => {
    const key = `${doc.userId}:${doc.id}`;
    const _id = doc._id || new mongoose.Types.ObjectId().toString();
    store.set(key, { ...doc, _id });
    return _id;
  };

  return ExpenseModelMock;
}

function loadApp() {
  jest.resetModules();

  const findByIdMock = jest.fn(async (id) => ({ _id: id }));
  const ExpenseModelMock = makeExpenseModel();

  const mlFeedbackSaveMock = jest.fn().mockResolvedValue(undefined);
  const mlFeedbackDocs = [];
  function MlFeedbackModelMock(doc) {
    Object.assign(this, doc);
    mlFeedbackDocs.push(this);
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
    userWideReservation: { token: "user-wide-token-1" },
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
  return { app, ExpenseModelMock, mlFeedbackDocs };
}

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

const putEdit = (app, userId, editID, payload) =>
  request(app)
    .put("/expense/update-expense")
    .query({ editID })
    .set("Authorization", `Bearer ${signToken(userId)}`)
    .send(payload);

describe("Category Normalization: POST /expense/add-expense stores canonical category (#7)", () => {
  // Verification-remediation note (narrowly scoped, evidence-based --
  it("stores the canonical, alias-resolved, Title-Cased category rather than the raw submitted string", async () => {
    const { app, ExpenseModelMock } = loadApp();

    const res = await postAdd(app, USER_ID, validAddPayload({ id: "cat-canonical-1", expenseCategory: "  medical  " }));

    expect(res.status).toBe(201);
    expect(res.body.data.expenseCategory).toBe("Health");
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:cat-canonical-1`);
    expect(stored.expenseCategory).toBe("Health");
  }, 20000);

  it("returns a controlled 400 (never a 500) for an invalid/empty category", async () => {
    const { app } = loadApp();

    const res = await postAdd(app, USER_ID, validAddPayload({ id: "cat-invalid-1", expenseCategory: "   " }));

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe("INVALID_CATEGORY");
  });
});

describe("Category Normalization: PUT /expense/update-expense stores canonical category (#8)", () => {
  it("normalizes and persists the canonical category when expenseCategory is present in the update", async () => {
    const { app, ExpenseModelMock } = loadApp();
    const seededId = ExpenseModelMock.__seed({
      userId: USER_ID,
      id: "edit-seed-1",
      expenseName: "Groceries run",
      expenseCategory: "Food",
      expenseAmount: 40,
      expenseDate: new Date("2026-01-10"),
      expenseDescription: "Weekly groceries",
    });

    const res = await putEdit(app, USER_ID, seededId, {
      expenseCategory: "  UTILITIES  ",
    });

    expect(res.status).toBe(200);
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:edit-seed-1`);
    expect(stored.expenseCategory).toBe("Bills");
  });

  it("returns a controlled 400 for an explicitly-supplied invalid category on edit", async () => {
    const { app, ExpenseModelMock } = loadApp();
    const seededId = ExpenseModelMock.__seed({
      userId: USER_ID,
      id: "edit-seed-invalid",
      expenseName: "Groceries run",
      expenseCategory: "Food",
      expenseAmount: 40,
      expenseDate: new Date("2026-01-10"),
      expenseDescription: "Weekly groceries",
    });

    const res = await putEdit(app, USER_ID, seededId, {
      expenseCategory: "   ",
    });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe("INVALID_CATEGORY");
  });

  it("does not require expenseCategory for edits that don't modify it", async () => {
    const { app, ExpenseModelMock } = loadApp();
    const seededId = ExpenseModelMock.__seed({
      userId: USER_ID,
      id: "edit-seed-no-category",
      expenseName: "Groceries run",
      expenseCategory: "Food",
      expenseAmount: 40,
      expenseDate: new Date("2026-01-10"),
      expenseDescription: "Weekly groceries",
    });

    const res = await putEdit(app, USER_ID, seededId, {
      expenseName: "Groceries run (updated)",
    });

    expect(res.status).toBe(200);
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:edit-seed-no-category`);
    expect(stored.expenseCategory).toBe("Food");
    expect(stored.expenseName).toBe("Groceries run (updated)");
  });
});

describe("Category Normalization: idempotent replay across alias/case/whitespace variants (#9)", () => {
  it("a replay whose only difference is a case/whitespace/alias-equivalent category succeeds as a true replay, not a conflict", async () => {
    const { app, ExpenseModelMock } = loadApp();

    const first = await postAdd(app, USER_ID, validAddPayload({ id: "replay-cat-1", expenseCategory: "Health" }));
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);

    const replay = await postAdd(
      app,
      USER_ID,
      validAddPayload({ id: "replay-cat-1", expenseCategory: "  medical  " })
    );

    expect(replay.status).toBe(201);
    expect(replay.body.replayed).toBe(true);
    expect(ExpenseModelMock.__store.size).toBe(1);
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:replay-cat-1`);
    expect(stored.expenseCategory).toBe("Health");
  });

  // Casing-correction fix -- an UNKNOWN/custom category replayed with a
  it("a replay of a custom category using a full-caps casing variant ('PET CARE' vs 'Pet Care') succeeds as a true replay, not a conflict", async () => {
    const { app, ExpenseModelMock } = loadApp();

    const first = await postAdd(
      app,
      USER_ID,
      validAddPayload({ id: "replay-custom-cat-1", expenseCategory: "Pet Care" })
    );
    expect(first.status).toBe(201);
    expect(first.body.replayed).toBe(false);
    expect(first.body.data.expenseCategory).toBe("Pet Care");

    const replay = await postAdd(
      app,
      USER_ID,
      validAddPayload({ id: "replay-custom-cat-1", expenseCategory: "PET CARE" })
    );

    expect(replay.status).toBe(201);
    expect(replay.body.replayed).toBe(true);
    expect(ExpenseModelMock.__store.size).toBe(1);
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:replay-custom-cat-1`);
    expect(stored.expenseCategory).toBe("Pet Care");
  });
});

describe("Category Normalization: genuinely different categories still conflict (#10)", () => {
  it("a replay with a genuinely different (non-alias-equivalent) category returns 409 IDEMPOTENCY_KEY_CONFLICT", async () => {
    const { app, ExpenseModelMock } = loadApp();

    const first = await postAdd(app, USER_ID, validAddPayload({ id: "conflict-cat-1", expenseCategory: "Food" }));
    expect(first.status).toBe(201);

    const conflict = await postAdd(
      app,
      USER_ID,
      validAddPayload({ id: "conflict-cat-1", expenseCategory: "Transport" })
    );

    expect(conflict.status).toBe(409);
    expect(conflict.body.errorCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(ExpenseModelMock.__store.size).toBe(1);
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:conflict-cat-1`);
    expect(stored.expenseCategory).toBe("Food");
  });

  // Casing-correction fix -- confirms the fix does not turn genuinely
  it("a genuinely different custom category ('Pet Care' vs 'Dog Care') still returns 409 IDEMPOTENCY_KEY_CONFLICT", async () => {
    const { app, ExpenseModelMock } = loadApp();

    const first = await postAdd(
      app,
      USER_ID,
      validAddPayload({ id: "conflict-custom-cat-1", expenseCategory: "Pet Care" })
    );
    expect(first.status).toBe(201);

    const conflict = await postAdd(
      app,
      USER_ID,
      validAddPayload({ id: "conflict-custom-cat-1", expenseCategory: "Dog Care" })
    );

    expect(conflict.status).toBe(409);
    expect(conflict.body.errorCode).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(ExpenseModelMock.__store.size).toBe(1);
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:conflict-custom-cat-1`);
    expect(stored.expenseCategory).toBe("Pet Care");
  });
});

describe("Category Normalization: ML feedback alias-awareness (#11, #12)", () => {
  it("an already-canonical ML prediction round-trips unchanged and is not treated as a correction when the user picks the same category", async () => {
    const { app, mlFeedbackDocs } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "ml-roundtrip-1",
        expenseCategory: "Health",
        mlPredictedCategory: "Health",
        mlConfidence: 0.92,
      })
    );

    expect(res.status).toBe(201);
    expect(mlFeedbackDocs).toHaveLength(1);
    const feedback = mlFeedbackDocs[0];
    expect(feedback.actualCategory).toBe("Health");
    expect(feedback.corrected).toBe(false);
  });

  it("an alias-equivalent predicted/actual pair (predicted Health, entered Medical) is NOT falsely reported as a correction", async () => {
    const { app, mlFeedbackDocs } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "ml-alias-1",
        expenseCategory: "Medical",
        mlPredictedCategory: "Health",
        mlConfidence: 0.85,
      })
    );

    expect(res.status).toBe(201);
    expect(res.body.data.expenseCategory).toBe("Health");
    expect(mlFeedbackDocs).toHaveLength(1);
    expect(mlFeedbackDocs[0].corrected).toBe(false);
  });

  it("a genuinely different user-selected category is still reported as a correction", async () => {
    const { app, mlFeedbackDocs } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "ml-correction-1",
        expenseCategory: "Transport",
        mlPredictedCategory: "Food",
        mlConfidence: 0.7,
      })
    );

    expect(res.status).toBe(201);
    expect(mlFeedbackDocs).toHaveLength(1);
    expect(mlFeedbackDocs[0].corrected).toBe(true);
  });

  it("a new, unknown (non-aliased) category is still storable even though it is outside the current ML taxonomy", async () => {
    const { app, ExpenseModelMock } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({ id: "unknown-cat-1", expenseCategory: "Pet Supplies" })
    );

    expect(res.status).toBe(201);
    expect(res.body.data.expenseCategory).toBe("Pet Supplies");
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:unknown-cat-1`);
    expect(stored.expenseCategory).toBe("Pet Supplies");
  });
});
