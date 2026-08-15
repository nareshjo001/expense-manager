// BALENISA URGENT PRODUCTION HOTFIX -- POST /expense/add-expense.
//
// Confirmed production failure:
//   ValidationError: expenses validation failed:
//   wasMlCorrected: Cast to Boolean failed for value "" at path
//   "wasMlCorrected"
//
// Root cause (traced): frontend/src/components/expensesHandling/
// AddExpense.js's `const wasMlCorrected = mlPredictedCategory && ...` is a
// JS short-circuit -- when there is no ML prediction, `mlPredictedCategory`
// is the empty string `""` (falsy), so the WHOLE expression evaluates to
// `""`, not `false`. That literal "" was sent as JSON straight through to
// Controllers/ExpenseControllers/addexpense.js, which passed
// `req.body.wasMlCorrected` directly into `new ExpenseModel({ ...,
// wasMlCorrected })` -- config/Schemas.js's `wasMlCorrected: { type:
// Boolean, default: false }` casts "true"/"false" strings but rejects ""
// outright, throwing the CastError above.
//
// Fix: addexpense.js now normalizes the raw value through
// normalizeOptionalBoolean() at the request boundary (undefined/null/""
// -> undefined, so the schema default applies; true/"true" -> true;
// false/"false" -> false; anything else -> a controlled 400) BEFORE ever
// constructing the ExpenseModel document. The frontend's short-circuit is
// also wrapped in Boolean(...) so it can never emit "" in the first place.
//
// Follows the same real-app/real-route/real-controller isolation
// convention as tests/expense.mutationReliability.test.js: only
// ../config/Schemas, ../Services/syncRecoveryService,
// ../utils/expenseCache, and ../models/RecurringExpense are mocked.
// ExpenseModelMock below deliberately EMULATES Mongoose's real Boolean-cast
// behavior (throwing a ValidationError-shaped error for any non-boolean,
// non-undefined `wasMlCorrected`, and applying the schema's `default:
// false` when the field is omitted/undefined) so this test proves the
// normalization actually prevents the document from ever reaching an
// invalid construction, not merely that some mock was called with some
// value.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const RECURRING_MODEL_PATH = "../models/RecurringExpense";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "expense-wasmlcorrected-normalization-test-secret";
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
    { email: "expense-wasmlcorrected-normalization-test@example.test", _id: userId },
    TEST_JWT_SECRET
  );
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

function loadApp() {
  jest.resetModules();

  const findByIdMock = jest.fn(async () => ({ _id: USER_ID }));
  const findOneMock = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) }));
  const constructedDocs = [];

  // Emulates config/Schemas.js's real expenseSchema Boolean-cast behavior
  // for `wasMlCorrected` ONLY (type: Boolean, default: false) -- every
  // other field is a plain passthrough, matching
  // expense.mutationReliability.test.js's ExpenseModelMock convention.
  function ExpenseModelMock(doc) {
    const hasField = Object.prototype.hasOwnProperty.call(doc, "wasMlCorrected");
    const rawValue = doc.wasMlCorrected;

    if (hasField && rawValue !== undefined && typeof rawValue !== "boolean") {
      const err = new Error(
        `expenses validation failed: wasMlCorrected: Cast to Boolean failed for value "${rawValue}" at path "wasMlCorrected"`
      );
      err.name = "ValidationError";
      throw err;
    }

    Object.assign(this, doc);
    // Real Mongoose schema default: applies only when the field is
    // undefined/omitted, never overrides an explicit `false`.
    this.wasMlCorrected = rawValue === undefined ? false : rawValue;
    if (this.expenseDate !== undefined) {
      this.expenseDate = new Date(this.expenseDate);
    }
    this.save = jest.fn(async () => {});
    constructedDocs.push(this);
  }
  ExpenseModelMock.findOne = findOneMock;

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

  const synchronizeAfterMutationMock = jest.fn(async () => ({
    status: "synchronized",
    budget: "synchronized",
    report: "synchronized",
    recoveryPending: false,
  }));
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
  return { app, constructedDocs };
}

const BASE_EXPENSE = {
  id: "attempt-1",
  expenseName: "Coffee",
  expenseCategory: "Food",
  expenseAmount: 5,
  expenseDate: "2026-08-01T00:00:00.000Z",
};

describe("POST /expense/add-expense -- wasMlCorrected boundary normalization", () => {
  it('"" never causes a CastError and results in the schema default (false)', async () => {
    const { app, constructedDocs } = loadApp();

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ ...BASE_EXPENSE, wasMlCorrected: "" });

    expect(res.status).toBe(201);
    expect(constructedDocs).toHaveLength(1);
    expect(constructedDocs[0].wasMlCorrected).toBe(false);
  });

  it('"false" becomes false', async () => {
    const { app, constructedDocs } = loadApp();

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ ...BASE_EXPENSE, wasMlCorrected: "false" });

    expect(res.status).toBe(201);
    expect(constructedDocs[0].wasMlCorrected).toBe(false);
  });

  it('"true" becomes true', async () => {
    const { app, constructedDocs } = loadApp();

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ ...BASE_EXPENSE, wasMlCorrected: "true" });

    expect(res.status).toBe(201);
    expect(constructedDocs[0].wasMlCorrected).toBe(true);
  });

  it("boolean false remains false", async () => {
    const { app, constructedDocs } = loadApp();

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ ...BASE_EXPENSE, wasMlCorrected: false });

    expect(res.status).toBe(201);
    expect(constructedDocs[0].wasMlCorrected).toBe(false);
  });

  it("boolean true remains true", async () => {
    const { app, constructedDocs } = loadApp();

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ ...BASE_EXPENSE, wasMlCorrected: true });

    expect(res.status).toBe(201);
    expect(constructedDocs[0].wasMlCorrected).toBe(true);
  });

  it("invalid text receives a controlled 400 and never reaches ExpenseModel construction", async () => {
    const { app, constructedDocs } = loadApp();

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ ...BASE_EXPENSE, wasMlCorrected: "maybe" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({ success: false, errorCode: "INVALID_WAS_ML_CORRECTED" })
    );
    expect(constructedDocs).toHaveLength(0);
  });

  it("undefined (field omitted entirely) results in the schema default (false) -- normal creation unchanged", async () => {
    const { app, constructedDocs } = loadApp();

    const res = await request(app)
      .post("/expense/add-expense")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ ...BASE_EXPENSE });

    expect(res.status).toBe(201);
    expect(constructedDocs[0].wasMlCorrected).toBe(false);
    expect(constructedDocs[0].expenseName).toBe("Coffee");
    expect(constructedDocs[0].expenseAmount).toBe(5);
  });
});
