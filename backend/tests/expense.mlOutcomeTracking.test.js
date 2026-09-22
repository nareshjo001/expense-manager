// ML-003-T05 -- Record viewed/accepted/corrected/abstained outcomes.
//
// Covers the new `mlAbstained` request field and the server-derived
// `abstained`/`outcome` fields written onto MlFeedbackModel, plus the
// mirrored `wasMlAbstained` field on ExpenseModel. Reuses the exact
// loadApp()/validAddPayload()/postAdd() mocking pattern already
// established in expense.categoryNormalization.route.test.js (in-memory
// ExpenseModel/MlFeedbackModel stand-ins via jest.doMock('../config/Schemas'),
// no real Mongo) rather than inventing a new one.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const mongoose = require("mongoose");

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const RECURRING_MODEL_PATH = "../models/RecurringExpense";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "expense-ml-outcome-tracking-route-test-secret";
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
    { email: "expense-ml-outcome-tracking-route-test@example.test", _id: userId },
    TEST_JWT_SECRET
  );
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";

const SYNCHRONIZED_RESULT = {
  status: "synchronized",
  budget: "synchronized",
  report: "synchronized",
  recoveryPending: false,
};

// Stateful in-memory ExpenseModel stand-in -- identical shape to the one in
// expense.categoryNormalization.route.test.js, duplicated here (not
// imported) so this file stays a single, independently-readable unit, same
// convention as the other route test files in this directory.
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

  ExpenseModelMock.findOne = (query) => {
    const resolve = async () => {
      const key = `${query.userId}:${query.id}`;
      const doc = store.get(key);
      return doc ? { ...doc } : null;
    };
    return {
      lean: resolve,
      then: (onFulfilled, onRejected) => resolve().then(onFulfilled, onRejected),
    };
  };

  ExpenseModelMock.__store = store;
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

describe("ML-003-T05: POST /expense/add-expense records viewed/accepted/corrected/abstained outcomes", () => {
  it("committed prediction, kept -> outcome 'accepted', abstained false, corrected false", async () => {
    const { app, mlFeedbackDocs } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "outcome-accepted-1",
        expenseCategory: "Food",
        mlPredictedCategory: "Food",
        mlConfidence: 0.95,
        mlAbstained: false,
      })
    );

    expect(res.status).toBe(201);
    expect(mlFeedbackDocs).toHaveLength(1);
    expect(mlFeedbackDocs[0].abstained).toBe(false);
    expect(mlFeedbackDocs[0].corrected).toBe(false);
    expect(mlFeedbackDocs[0].outcome).toBe("accepted");
    // ML-003-T07 -- the retraining-eligibility field ("pending" only for a
    // genuine correction) is untouched by T05's outcome/abstained fields:
    // "accepted" is not a correction, so it must stay null, not "pending".
    expect(mlFeedbackDocs[0].status).toBeNull();
  }, 90000);

  it("committed prediction, overridden -> outcome 'corrected'", async () => {
    const { app, mlFeedbackDocs } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "outcome-corrected-1",
        expenseCategory: "Transport",
        mlPredictedCategory: "Food",
        mlConfidence: 0.7,
        mlAbstained: false,
      })
    );

    expect(res.status).toBe(201);
    expect(mlFeedbackDocs).toHaveLength(1);
    expect(mlFeedbackDocs[0].abstained).toBe(false);
    expect(mlFeedbackDocs[0].corrected).toBe(true);
    expect(mlFeedbackDocs[0].outcome).toBe("corrected");
    // ML-003-T07 -- a genuine correction must still reach "pending" so the
    // retraining pipeline can pick it up, exactly as before T05 existed.
    expect(mlFeedbackDocs[0].status).toBe("pending");
  }, 90000);

  it("abstained suggestion, used as submitted -> outcome 'viewed'", async () => {
    const { app, mlFeedbackDocs } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "outcome-viewed-1",
        expenseCategory: "Personal Care",
        mlPredictedCategory: "Personal Care",
        mlConfidence: 0.62,
        mlAbstained: true,
      })
    );

    expect(res.status).toBe(201);
    expect(mlFeedbackDocs).toHaveLength(1);
    expect(mlFeedbackDocs[0].abstained).toBe(true);
    expect(mlFeedbackDocs[0].corrected).toBe(false);
    expect(mlFeedbackDocs[0].outcome).toBe("viewed");
    // ML-003-T07 -- a "viewed" outcome (abstained suggestion accepted
    // as-is) is not a correction either -- must stay null, not "pending",
    // the same as a plain "accepted" outcome.
    expect(mlFeedbackDocs[0].status).toBeNull();
  }, 90000);

  it("abstained suggestion, overridden by the user's own choice -> outcome 'abstained'", async () => {
    const { app, mlFeedbackDocs } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "outcome-abstained-1",
        expenseCategory: "Travel",
        mlPredictedCategory: "Personal Care",
        mlConfidence: 0.62,
        mlAbstained: true,
      })
    );

    expect(res.status).toBe(201);
    expect(mlFeedbackDocs).toHaveLength(1);
    expect(mlFeedbackDocs[0].abstained).toBe(true);
    expect(mlFeedbackDocs[0].corrected).toBe(true);
    expect(mlFeedbackDocs[0].outcome).toBe("abstained");
    // ML-003-T07 -- the "abstained" outcome (suggestion overridden) IS a
    // genuine correction under the pre-existing comparison, so it must
    // still reach "pending" -- this is the case T05's own notes said was
    // "already correct without needing any new logic"; this assertion is
    // what actually proves that claim rather than leaving it undemonstrated.
    expect(mlFeedbackDocs[0].status).toBe("pending");
  }, 90000);

  it("a legacy client that omits mlAbstained entirely is treated as a committed (non-abstained) prediction", async () => {
    const { app, mlFeedbackDocs } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "outcome-legacy-1",
        expenseCategory: "Food",
        mlPredictedCategory: "Food",
        mlConfidence: 0.95,
        // mlAbstained intentionally omitted.
      })
    );

    expect(res.status).toBe(201);
    expect(mlFeedbackDocs).toHaveLength(1);
    expect(mlFeedbackDocs[0].abstained).toBe(false);
    expect(mlFeedbackDocs[0].outcome).toBe("accepted");
  }, 90000);

  it("persists the mirrored wasMlAbstained flag on the expense document itself", async () => {
    const { app, ExpenseModelMock } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "outcome-wasmlabstained-1",
        expenseCategory: "Travel",
        mlPredictedCategory: "Personal Care",
        mlConfidence: 0.62,
        mlAbstained: true,
      })
    );

    expect(res.status).toBe(201);
    const stored = ExpenseModelMock.__store.get(`${USER_ID}:outcome-wasmlabstained-1`);
    expect(stored.wasMlAbstained).toBe(true);
  }, 90000);

  it("rejects a non-boolean mlAbstained with a controlled 400, never a 500", async () => {
    const { app } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "outcome-invalid-1",
        mlAbstained: "not-a-boolean",
      })
    );

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe("INVALID_ML_ABSTAINED");
  }, 90000);

  it("no prediction at all -> no MlFeedbackModel document is created, regardless of mlAbstained", async () => {
    const { app, mlFeedbackDocs } = loadApp();

    const res = await postAdd(
      app,
      USER_ID,
      validAddPayload({
        id: "outcome-no-prediction-1",
        mlAbstained: true,
        // mlPredictedCategory intentionally omitted -- no genuine prediction.
      })
    );

    expect(res.status).toBe(201);
    expect(mlFeedbackDocs).toHaveLength(0);
  }, 90000);
});
