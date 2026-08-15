// BALENISA Budget Derived-Spent Authority and Crash-Recovery Remediation.
//
// Phase 2 defect reproduction (second pass): these assertions encode the
// CORRECT, required behavior and are run FIRST against current
// (unmodified) production code, where they FAIL -- proving the defect is
// real. After the fix they pass and this file also serves as Phase 4's
// regression coverage; no assertion is weakened after the fix lands.
//
// getbudgets.js and chart.service.js's getBudgetComparison both call
// syncRecoveryService.repairIfPending(userId) before reading BudgetModel's
// stored `spent` field. Controllers/BudgetControllers/fetchBudgets.js --
// which feeds backend/analytics/dataProvider.js's getAllBudgets(), which
// is consumed by analyticsContext.js for report/habit-analysis generation
// -- read BudgetModel directly with NO such repair step, making it the
// last remaining reader of Budget.spent with no crash-gap protection: a
// user who never happened to call GET /api/getbudgets or a chart endpoint
// could have stale Budget.spent leak into their generated reports
// indefinitely.
//
// Mocks only ../config/Schemas and ../Services/syncRecoveryService --
// never touches MongoDB, Redis, or the network.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const FETCH_BUDGETS_PATH = "../Controllers/BudgetControllers/fetchBudgets";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadFetchBudgets({ budgets = [] } = {}) {
  jest.resetModules();

  const repairIfPendingMock = jest.fn(async () => ({ attempted: true, stillPending: false }));
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    repairIfPending: repairIfPendingMock,
  }));

  const findMock = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(budgets) }));
  jest.doMock(SCHEMAS_PATH, () => ({
    BudgetModel: { find: findMock },
  }));

  const { fetchBudgets } = require(FETCH_BUDGETS_PATH);
  return { fetchBudgets, repairIfPendingMock, findMock };
}

describe("fetchBudgets -- must repair-on-read, matching getbudgets.js / chart.service.js's convention", () => {
  it("calls repairIfPending for the user BEFORE reading BudgetModel", async () => {
    const callOrder = [];
    const { fetchBudgets, repairIfPendingMock, findMock } = loadFetchBudgets({
      budgets: [{ month: "Aug 2026", budget: 500, spent: 100 }],
    });
    repairIfPendingMock.mockImplementation(async () => {
      callOrder.push("repairIfPending");
      return { attempted: true, stillPending: false };
    });
    findMock.mockImplementation(() => {
      callOrder.push("find");
      return { lean: jest.fn().mockResolvedValue([{ month: "Aug 2026", budget: 500, spent: 100 }]) };
    });

    await fetchBudgets("user-1");

    expect(repairIfPendingMock).toHaveBeenCalledWith("user-1");
    expect(callOrder).toEqual(["repairIfPending", "find"]);
  });

  it("still returns budgets sorted by month key after a successful repair-on-read", async () => {
    const { fetchBudgets } = loadFetchBudgets({
      budgets: [
        { month: "Mar 2026", budget: 200, spent: 50 },
        { month: "Jan 2026", budget: 300, spent: 10 },
      ],
    });

    const result = await fetchBudgets("user-1");

    expect(result.map((b) => b.month)).toEqual(["Jan 2026", "Mar 2026"]);
  });

  it("resolves empty months to an empty array without erroring", async () => {
    const { fetchBudgets, repairIfPendingMock } = loadFetchBudgets({ budgets: [] });

    const result = await fetchBudgets("user-1");

    expect(repairIfPendingMock).toHaveBeenCalledWith("user-1");
    expect(result).toEqual([]);
  });
});
