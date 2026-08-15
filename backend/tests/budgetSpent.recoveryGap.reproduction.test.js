// BALENISA Budget Derived-Spent Authority and Crash-Recovery Remediation.
//
// Phase 2 defect reproduction: these assertions encode the CORRECT,
// required behavior and are run FIRST against current (unmodified)
// production code, where they FAIL -- proving the defect is real, not
// assumed. After the fix (Phase 3) they pass and this file also serves as
// Phase 4's regression coverage for this specific gap; no assertion here
// is weakened after the fix lands.
//
// Traced call chain (independently verified against source before writing
// this test): POST /api/setbudget -> setbudget.js -> budget.service.js's
// setBudgetForCurrentMonth() -> recalculateBudget(userId, date) with NO
// options object, and PUT /api/update-budget -> updatebudget.js ->
// recalculateBudget(user._id, now) -- also with no options object.
// budget.service.js's recalculateBudget(userId, date, options={}) only
// applies the syncRevision CAS fence when `options.fenceRevision` is
// provided (budget.service.js:118-126); when omitted it issues an
// UNCONDITIONAL `$set:{spent}` (budget.service.js:121-125), and neither
// controller calls syncRecoveryService.reserve()/confirm() at all, unlike
// every expense-mutation controller (addexpense.js/editExpense.js/
// deleteExpense.js) and recurringJob.js, which all reserve before their
// primary write and synchronize via the fenced synchronizeAfterMutation().
//
// Defect consequence: (1) a crash between the budget-amount write and
// recalculateBudget leaves NO durable PendingSync evidence, so
// repairIfPending() has nothing to find and never repairs it; (2) a
// concurrent FENCED expense-mutation repair for the same user+month can be
// silently overwritten by this unfenced write, with no CAS protection and
// no recorded error -- candidate #9 ("Budget is created/edited while an
// expense mutation occurs").
//
// Mocks only ../config/Schemas, ../Services/syncRecoveryService, and
// ../Services/BudgetServices/budget.service -- never touches MongoDB,
// Redis, or the network. Follows the established supertest-against-the-
// real-app convention (mirrors tests/getbudgets.reliability.test.js).
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const BUDGET_SERVICE_PATH = "../Services/BudgetServices/budget.service";
const REPORT_SERVICE_PATH = "../Services/reportService";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "budget-recovery-gap-test-secret";
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
  return jwt.sign({ email: "budget-recovery-gap-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0cc";

function loadApp() {
  jest.resetModules();

  const findByIdMock = jest.fn(async () => ({ _id: USER_ID }));
  const budgetFindOneAndUpdateMock = jest.fn(async () => ({ _id: "budget-doc-1" }));
  const budgetFindOneMock = jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ _id: "budget-doc-1", spent: 42 }) }));

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: findByIdMock },
    BudgetModel: { findOneAndUpdate: budgetFindOneAndUpdateMock, findOne: budgetFindOneMock },
    ExpenseModel: {},
    MlFeedbackModel: {},
    IncomeModel: {},
  }));

  const reserveMock = jest.fn(async () => ({
    budgetReservations: [{ month: new Date(), token: "tok-1", reservedAt: new Date() }],
    reportReservation: null,
    userWideReservation: null,
  }));
  const confirmMock = jest.fn(async () => 1);
  const synchronizeAfterMutationMock = jest.fn(async () => ({
    status: "synchronized",
    budget: "synchronized",
    report: "synchronized",
    recoveryPending: false,
  }));
  const abandonMock = jest.fn(async () => null);
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    reserve: reserveMock,
    confirm: confirmMock,
    abandon: abandonMock,
    synchronizeAfterMutation: synchronizeAfterMutationMock,
    repairIfPending: jest.fn(async () => ({ attempted: false, stillPending: false })),
    getPendingSync: jest.fn(async () => null),
    clearIfRevisionMatches: jest.fn(),
    allocateRepairRevision: jest.fn(async () => 1),
  }));

  const recalculateBudgetMock = jest.fn(async (userId, date, options) => ({
    _id: "budget-doc-1",
    userId,
    spent: 42,
    __calledWithOptions: options,
  }));
  jest.doMock(BUDGET_SERVICE_PATH, () => ({
    recalculateBudget: recalculateBudgetMock,
    setBudgetForCurrentMonth: jest.fn(async (userId) => {
      await recalculateBudgetMock(userId, new Date());
    }),
    getMonthKey: jest.fn(() => "Aug 2026"),
    getMonthAnchor: jest.fn((d) => d),
    getMonthAnchorFromKey: jest.fn(() => null),
  }));

  const clearUserExpenseCacheMock = jest.fn(async () => {});
  jest.doMock("../utils/expenseCache", () => ({
    setCache: jest.fn(),
    getCache: jest.fn(async () => null),
    clearUserExpenseCache: clearUserExpenseCacheMock,
  }));

  jest.doMock(REPORT_SERVICE_PATH, () => ({
    refreshReport: jest.fn(async () => ({ status: "synchronized" })),
    getReport: jest.fn(),
  }));

  const app = require(APP_PATH);
  return {
    app,
    findByIdMock,
    budgetFindOneAndUpdateMock,
    reserveMock,
    confirmMock,
    synchronizeAfterMutationMock,
    recalculateBudgetMock,
    clearUserExpenseCacheMock,
  };
}

describe("POST /api/setbudget -- must go through the shared recovery architecture", () => {
  it("reserves durable recovery evidence BEFORE its primary budget write, exactly like every expense-mutation controller", async () => {
    const { app, reserveMock } = loadApp();

    const res = await request(app)
      .post("/api/setbudget")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ budget: 500 });

    expect(res.status).toBe(200);
    expect(reserveMock).toHaveBeenCalledTimes(1);
    expect(reserveMock.mock.calls[0][0]).toMatchObject({ userId: USER_ID });
  });

  it("recomputes spent through synchronizeAfterMutation (fenced), never bypassing it with a raw unfenced recalculateBudget call", async () => {
    const { app, synchronizeAfterMutationMock } = loadApp();

    await request(app)
      .post("/api/setbudget")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ budget: 500 });

    expect(synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
    expect(synchronizeAfterMutationMock.mock.calls[0][0]).toMatchObject({ userId: USER_ID });
  });

  it("clears the user's cache after the budget-amount write, matching the expense-mutation convention", async () => {
    const { app, clearUserExpenseCacheMock } = loadApp();

    await request(app)
      .post("/api/setbudget")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ budget: 500 });

    expect(clearUserExpenseCacheMock).toHaveBeenCalledWith(USER_ID);
  });
});

describe("PUT /api/update-budget -- must go through the shared recovery architecture", () => {
  it("reserves durable recovery evidence BEFORE its primary budget write", async () => {
    const { app, reserveMock } = loadApp();

    const res = await request(app)
      .put("/api/update-budget")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ budget: 750 });

    expect(res.status).toBe(200);
    expect(reserveMock).toHaveBeenCalledTimes(1);
  });

  it("recomputes spent through synchronizeAfterMutation (fenced), never a raw unfenced recalculateBudget call", async () => {
    const { app, synchronizeAfterMutationMock } = loadApp();

    await request(app)
      .put("/api/update-budget")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ budget: 750 });

    expect(synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
  });

  it("clears the user's cache after the budget-amount write", async () => {
    const { app, clearUserExpenseCacheMock } = loadApp();

    await request(app)
      .put("/api/update-budget")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ budget: 750 });

    expect(clearUserExpenseCacheMock).toHaveBeenCalledWith(USER_ID);
  });

  it("preserves the existing response contract: {message, data, success}", async () => {
    const { app } = loadApp();

    const res = await request(app)
      .put("/api/update-budget")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`)
      .send({ budget: 750 });

    expect(res.body).toEqual(
      expect.objectContaining({
        message: expect.any(String),
        success: true,
      })
    );
    expect(res.body.data).toBeDefined();
  });
});
