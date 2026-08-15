// BALENISA Budget Derived-Spent Authority and Crash-Recovery Remediation.
//
// Phase 2 defect reproduction: these assertions encode the CORRECT,
// required behavior and are run FIRST against current (unmodified)
// production code, where they FAIL -- proving the defect is real. After
// the fix they pass and this file also serves as Phase 4's regression
// coverage; no assertion is weakened after the fix lands.
//
// getbudgets.js established a "repair-on-read" convention: it calls
// syncRecoveryService.repairIfPending(userId) BEFORE reading BudgetModel's
// stored `spent` field, specifically because that value can be stale after
// a crash left durable-but-unrepaired PendingSync evidence
// (getbudgets.js:25-32). Services/ChartServices/chart.service.js's
// getBudgetComparison() -- consumed by GET /bar/barchartbymonth (year
// mode) and GET /pie/comparison (month mode, via
// Controllers/PieChartControllers/getcomparisonforpie.js) -- read
// BudgetModel directly (chart.service.js:79-106) with NO such repair step.
// Since repairIfPending() is the only mechanism that resolves a pending
// repair marker outside of the next expense mutation for the SAME month, a
// user who never happens to call GET /api/getbudgets could see stale
// `spent`/`remaining` on these two chart endpoints indefinitely.
//
// Mocks only ../Services/syncRecoveryService, ../config/Schemas, and
// ../Controllers/GetExpenseControllers/fetchExpenses -- never touches
// MongoDB, Redis, or the network.
"use strict";

const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const SCHEMAS_PATH = "../config/Schemas";
const CHART_SERVICE_PATH = "../Services/ChartServices/chart.service";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadChartService({ budgetDoc, budgets } = {}) {
  jest.resetModules();

  const repairIfPendingMock = jest.fn(async () => ({ attempted: true, stillPending: false }));
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    repairIfPending: repairIfPendingMock,
  }));

  jest.doMock(SCHEMAS_PATH, () => ({
    BudgetModel: {
      find: jest.fn(async () => budgets || []),
      findOne: jest.fn(async () => budgetDoc || null),
    },
    ExpenseModel: {},
  }));

  jest.doMock("../Controllers/GetExpenseControllers/fetchExpenses", () => ({
    fetchExpense: jest.fn(async () => []),
  }));

  const { getBudgetComparison } = require(CHART_SERVICE_PATH);
  return { getBudgetComparison, repairIfPendingMock };
}

describe("chart.service.getBudgetComparison -- must repair-on-read, matching getbudgets.js's convention", () => {
  it("calls repairIfPending for the user BEFORE reading Budget.spent in month mode", async () => {
    const callOrder = [];
    const { getBudgetComparison, repairIfPendingMock } = loadChartService({
      budgetDoc: { budget: 500, spent: 100 },
    });
    repairIfPendingMock.mockImplementation(async () => {
      callOrder.push("repairIfPending");
      return { attempted: true, stillPending: false };
    });

    await getBudgetComparison({ userId: "user-1", mode: "month", monthKey: "Aug 2026" });

    expect(repairIfPendingMock).toHaveBeenCalledWith("user-1");
    expect(callOrder).toEqual(["repairIfPending"]);
  });

  it("calls repairIfPending for the user BEFORE reading Budget.spent in year mode", async () => {
    const { getBudgetComparison, repairIfPendingMock } = loadChartService({ budgets: [] });

    await getBudgetComparison({ userId: "user-1", mode: "year", year: "2026" });

    expect(repairIfPendingMock).toHaveBeenCalledWith("user-1");
  });

  it("still returns the correct comparison shape after a successful repair-on-read (month mode)", async () => {
    const { getBudgetComparison } = loadChartService({
      budgetDoc: { budget: 500, spent: 100 },
    });

    const result = await getBudgetComparison({ userId: "user-1", mode: "month", monthKey: "Aug 2026" });

    expect(result).toEqual({ remaining: 400, spent: 100 });
  });
});
