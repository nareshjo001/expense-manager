// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "getbudgets-reliability-test-secret";
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
  return jwt.sign({ email: "getbudgets-reliability-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";

function loadApp({ budgets = [], repairIfPendingImpl, getPendingSyncImpl } = {}) {
  jest.resetModules();

  const findByIdMock = jest.fn(async () => ({ _id: USER_ID }));
  const findMock = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(budgets) }));

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: findByIdMock },
    BudgetModel: { find: findMock },
    ExpenseModel: {},
    MlFeedbackModel: {},
    IncomeModel: {},
  }));

  const repairIfPendingMock = jest.fn(
    repairIfPendingImpl || (async () => ({ attempted: false, stillPending: false }))
  );
  const getPendingSyncMock = jest.fn(getPendingSyncImpl || (async () => null));
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    repairIfPending: repairIfPendingMock,
    synchronizeAfterMutation: jest.fn(),
    markPending: jest.fn(),
    getPendingSync: getPendingSyncMock,
    clearIfRevisionMatches: jest.fn(),
  }));

  const app = require(APP_PATH);
  return { app, findByIdMock, findMock, repairIfPendingMock, getPendingSyncMock };
}

describe("GET /api/getbudgets -- Phase C read-time repair wiring", () => {
  it("calls syncRecoveryService.repairIfPending for the authenticated user BEFORE reading BudgetModel", async () => {
    const callOrder = [];
    const { app, findMock } = loadApp({
      budgets: [{ month: "Jan 2026", budget: 500, spent: 120 }],
      repairIfPendingImpl: async () => {
        callOrder.push("repairIfPending");
        return { attempted: true, stillPending: false };
      },
    });
    findMock.mockImplementation(() => {
      callOrder.push("find");
      return { lean: jest.fn().mockResolvedValue([{ month: "Jan 2026", budget: 500, spent: 120 }]) };
    });

    const res = await request(app)
      .get("/api/getbudgets")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(callOrder).toEqual(["repairIfPending", "find"]);
  });

  it("still returns the (best-available) budgets when repairIfPending fails to repair anything", async () => {
    const budgets = [{ month: "Jan 2026", budget: 500, spent: 120 }];
    const { app } = loadApp({
      budgets,
      repairIfPendingImpl: async () => ({
        attempted: true,
        stillPending: true,
        budgetRepairFailed: true,
      }),
    });

    const res = await request(app)
      .get("/api/getbudgets")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`);

    // A failed repair never blocks the read -- the existing stored values
    // (however stale) are still served rather than a 500.
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(budgets);
  });
});

describe("GET /api/getbudgets -- Phase C.1 stale-state disclosure contract", () => {
  it("Requirement 5: exposes recoveryPending:false and an empty staleMonths list when nothing is pending -- purely additive, existing fields unchanged", async () => {
    const budgets = [{ month: "Jan 2026", budget: 500, spent: 120 }];
    const { app } = loadApp({
      budgets,
      getPendingSyncImpl: async () => null,
    });

    const res = await request(app)
      .get("/api/getbudgets")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: "Success",
      data: budgets,
      success: true,
      recoveryPending: false,
      staleMonths: [],
    });
  });

  it("Requirement 5 (budget repair failure -> explicit controlled contract): when repair fails, exposes recoveryPending:true and names the exact stale month(s), never presenting stale data as fresh", async () => {
    const budgets = [{ month: "Jan 2026", budget: 500, spent: 120 }];
    const janAnchor = new Date("2026-01-01T00:00:00.000Z");
    const { app } = loadApp({
      budgets,
      repairIfPendingImpl: async () => ({ attempted: true, stillPending: true, budgetRepairFailed: true }),
      getPendingSyncImpl: async () => ({
        revision: 3,
        pendingBudgetMonths: [janAnchor],
        reportPending: false,
        reservedBudgetMonths: [],
        reservedReport: { token: null, reservedAt: null },
      }),
    });

    const res = await request(app)
      .get("/api/getbudgets")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`);

    // Still 200 -- best-available data is served (not a 500/503) -- but
    // the response now explicitly discloses which month(s) may be stale.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual(budgets);
    expect(res.body.recoveryPending).toBe(true);
    expect(res.body.staleMonths).toEqual(["Jan 2026"]);
  });

  it("also names months that are only Tier-2 reserved (a crash-gap month, not yet even Tier-1 confirmed) as stale", async () => {
    const budgets = [{ month: "Feb 2026", budget: 500, spent: 0 }];
    const { app } = loadApp({
      budgets,
      getPendingSyncImpl: async () => ({
        revision: 0,
        pendingBudgetMonths: [],
        reportPending: false,
        reservedBudgetMonths: [
          { month: new Date("2026-02-01T00:00:00.000Z"), token: "tok-1", reservedAt: new Date() },
        ],
        reservedReport: { token: null, reservedAt: null },
      }),
    });

    const res = await request(app)
      .get("/api/getbudgets")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.recoveryPending).toBe(true);
    expect(res.body.staleMonths).toEqual(["Feb 2026"]);
  });

  it("existing clients that only read message/data/success see byte-identical values to before -- new fields are purely additive", async () => {
    const budgets = [{ month: "Mar 2026", budget: 200, spent: 50 }];
    const { app } = loadApp({ budgets });

    const res = await request(app)
      .get("/api/getbudgets")
      .set("Authorization", `Bearer ${signToken(USER_ID)}`);

    expect(res.body.message).toBe("Success");
    expect(res.body.data).toEqual(budgets);
    expect(res.body.success).toBe(true);
  });
});
