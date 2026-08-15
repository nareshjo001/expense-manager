// BALENISA Budget Derived-Spent Authority and Crash-Recovery Remediation.
//
// Architectural correction: an earlier pass added
// `syncRecoveryService.repairIfPending()` inside fetchBudgets(), reasoning
// that it was "the last remaining reader of Budget.spent with no repair
// step." That reasoning was incomplete: fetchBudgets() is called from
// WITHIN report generation itself (reportService -> reportGenerator ->
// analyticsContext -> dataProvider -> fetchBudgets). reportService already
// performs its own repair-on-read before it ever starts generating a
// report -- calling repairIfPending() again from inside fetchBudgets()
// re-entered the sync recovery machinery mid-generation, which was the
// actual cause of the slow/stuck budget response (a real architectural
// defect, not just the CommonJS circular-require crash a prior hotfix
// pass fixed separately).
//
// fetchBudgets() is therefore a PURE BudgetModel read/sort helper with NO
// recovery step of its own. Read-time repair belongs only at the actual
// entry points that decide to serve Budget.spent to a caller:
// getbudgets.js, chart.service.js's getBudgetComparison, and
// reportService's own pre-generation repair -- never inside internal
// data-loading helpers consumed mid-generation.
//
// Mocks only ../config/Schemas -- never touches MongoDB, Redis, or the
// network, and never mocks ../Services/syncRecoveryService because
// fetchBudgets.js must not reference it at all.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const FETCH_BUDGETS_PATH = "../Controllers/BudgetControllers/fetchBudgets";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadFetchBudgets({ budgets = [] } = {}) {
  jest.resetModules();

  const findMock = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(budgets) }));
  jest.doMock(SCHEMAS_PATH, () => ({
    BudgetModel: { find: findMock },
  }));

  const { fetchBudgets } = require(FETCH_BUDGETS_PATH);
  return { fetchBudgets, findMock };
}

describe("fetchBudgets -- must be a PURE read, never triggering recovery itself", () => {
  it("does NOT require or call syncRecoveryService.repairIfPending at all", async () => {
    jest.resetModules();

    const repairIfPendingMock = jest.fn(async () => ({ attempted: true, stillPending: false }));
    jest.doMock("../Services/syncRecoveryService", () => ({
      repairIfPending: repairIfPendingMock,
    }));
    jest.doMock(SCHEMAS_PATH, () => ({
      BudgetModel: {
        find: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue([{ month: "Aug 2026", budget: 500, spent: 100 }]),
        })),
      },
    }));

    const { fetchBudgets } = require(FETCH_BUDGETS_PATH);
    await fetchBudgets("user-1");

    // The defining property of the correction: even when syncRecoveryService
    // IS mocked and available, fetchBudgets must never touch it.
    expect(repairIfPendingMock).not.toHaveBeenCalled();
  });

  it("reads BudgetModel directly with no intervening repair call", async () => {
    const { fetchBudgets, findMock } = loadFetchBudgets({
      budgets: [{ month: "Aug 2026", budget: 500, spent: 100 }],
    });

    const result = await fetchBudgets("user-1");

    expect(findMock).toHaveBeenCalledTimes(1);
    expect(findMock).toHaveBeenCalledWith(
      { userId: "user-1" },
      { month: 1, budget: 1, spent: 1, _id: 0 }
    );
    expect(result).toEqual([{ month: "Aug 2026", budget: 500, spent: 100 }]);
  });

  it("still returns budgets sorted by month key", async () => {
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
    const { fetchBudgets } = loadFetchBudgets({ budgets: [] });

    const result = await fetchBudgets("user-1");

    expect(result).toEqual([]);
  });
});

describe("getbudgets.js -- read-time repair still lives at the actual entry point (unchanged)", () => {
  it("calls repairIfPending(user._id) BEFORE its own BudgetModel read", async () => {
    jest.resetModules();

    const findByIdMock = jest.fn(async () => ({ _id: "user-1" }));
    const budgetFindMock = jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) }));
    jest.doMock("../config/Schemas", () => ({
      UserModel: { findById: findByIdMock },
      BudgetModel: { find: budgetFindMock },
    }));

    const callOrder = [];
    const repairIfPendingMock = jest.fn(async () => {
      callOrder.push("repairIfPending");
      return { attempted: false, stillPending: false };
    });
    jest.doMock("../Services/syncRecoveryService", () => ({
      repairIfPending: repairIfPendingMock,
      getPendingSync: jest.fn(async () => null),
    }));
    budgetFindMock.mockImplementation(() => {
      callOrder.push("find");
      return { lean: jest.fn().mockResolvedValue([]) };
    });

    const { getbudgets } = require("../Controllers/BudgetControllers/getbudgets");

    const req = { userId: "user-1" };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    await getbudgets(req, res);

    expect(repairIfPendingMock).toHaveBeenCalledWith("user-1");
    expect(callOrder).toEqual(["repairIfPending", "find"]);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
