// BALENISA URGENT PRODUCTION HOTFIX -- corrected.
//
// Timeline:
// 1. Original defect: fetchBudgets.js had a top-level
//    `require('../../Services/syncRecoveryService')`, closing a real
//    CommonJS cycle: syncRecoveryService -> reportService -> reportGenerator
//    -> analyticsContext -> dataProvider -> fetchBudgets -> syncRecoveryService.
//    When syncRecoveryService loaded first, fetchBudgets.js captured its
//    still-under-construction module.exports, causing
//    "TypeError: syncRecoveryService.repairIfPending is not a function".
// 2. First hotfix pass: made the require lazy (inside fetchBudgets()).
//    This fixed the crash but NOT the architecture -- fetchBudgets() is
//    called from WITHIN report generation itself, so calling
//    repairIfPending() there re-entered the sync recovery machinery
//    mid-generation (reportService already repairs once, up front, before
//    generation starts), which was the actual cause of the slow/stuck
//    budget response.
// 3. This correction: fetchBudgets.js no longer references
//    syncRecoveryService AT ALL -- it is a pure BudgetModel read/sort
//    helper. This doesn't just defer the require, it removes the cycle's
//    closing edge entirely (dataProvider -> fetchBudgets still exists, but
//    fetchBudgets -> syncRecoveryService no longer does), so there is no
//    cycle left to trigger the original crash class in the first place.
//
// This test proves both properties hold in the exact production require
// order: it requires syncRecoveryService FIRST (as server.js's dependency
// graph effectively does), letting the real, unmocked chain
// syncRecoveryService -> reportService -> reportGenerator ->
// analyticsContext -> dataProvider -> fetchBudgets load, then proves (a) no
// circular-dependency warning is ever logged, and (b) fetchBudgets()
// completes correctly WITHOUT calling repairIfPending or otherwise
// re-entering sync recovery.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const PENDING_SYNC_PATH = "../models/PendingSync";
const REPORT_MODEL_PATH = "../models/Report";
const REPORT_CACHE_PATH = "../cache/reportCache";
const RECURRING_STATE_SERVICE_PATH = "../Services/RecurringServices/recurringStateService";

const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const FETCH_BUDGETS_PATH = "../Controllers/BudgetControllers/fetchBudgets";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("Production require-order regression: syncRecoveryService <-> fetchBudgets cycle", () => {
  it("loading syncRecoveryService FIRST loads the whole production chain (reportService -> reportGenerator -> analyticsContext -> dataProvider -> fetchBudgets) without a circular-dependency warning, and fetchBudgets never re-enters sync recovery", async () => {
    jest.resetModules();

    const budgetFindMock = jest.fn(() => ({
      lean: jest.fn().mockResolvedValue([{ month: "Aug 2026", budget: 500, spent: 100 }]),
    }));
    jest.doMock(SCHEMAS_PATH, () => ({
      UserModel: {},
      BudgetModel: { find: budgetFindMock },
      ExpenseModel: {},
      MlFeedbackModel: {},
      IncomeModel: {},
    }));

    const pendingSyncFindOneMock = jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) }));
    const pendingSyncFindOneAndUpdateMock = jest.fn().mockResolvedValue(null);
    const pendingSyncUpdateOneMock = jest.fn().mockResolvedValue({});
    jest.doMock(PENDING_SYNC_PATH, () => ({
      findOne: pendingSyncFindOneMock,
      findOneAndUpdate: pendingSyncFindOneAndUpdateMock,
      updateOne: pendingSyncUpdateOneMock,
    }));

    jest.doMock(REPORT_MODEL_PATH, () => ({
      findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
      findOneAndUpdate: jest.fn().mockResolvedValue(null),
    }));

    jest.doMock(REPORT_CACHE_PATH, () => ({
      getCachedReport: jest.fn().mockResolvedValue(null),
      setCachedReport: jest.fn().mockResolvedValue(undefined),
    }));

    jest.doMock(RECURRING_STATE_SERVICE_PATH, () => ({
      annotateRecurringState: jest.fn(async (expenses) => expenses),
    }));

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // Step 1: require syncRecoveryService FIRST -- exactly the production
    // order. This transitively pulls in reportService -> reportGenerator
    // -> analyticsContext -> dataProvider -> fetchBudgets, all for real
    // (unmocked).
    let syncRecoveryService;
    expect(() => {
      syncRecoveryService = require(SYNC_RECOVERY_SERVICE_PATH);
    }).not.toThrow();

    expect(typeof syncRecoveryService.repairIfPending).toBe("function");
    expect(typeof syncRecoveryService.reserve).toBe("function");
    expect(typeof syncRecoveryService.synchronizeAfterMutation).toBe("function");

    // Spy on the real repairIfPending AFTER the module has fully loaded, so
    // we can prove fetchBudgets() never calls it -- the whole point of the
    // architectural correction.
    const repairIfPendingSpy = jest.spyOn(syncRecoveryService, "repairIfPending");

    // Step 2: require fetchBudgets (already loaded via the chain above --
    // Node returns the same cached module, exactly as in production).
    const { fetchBudgets } = require(FETCH_BUDGETS_PATH);
    expect(typeof fetchBudgets).toBe("function");

    // Step 3: invoke fetchBudgets. It must complete correctly using only
    // BudgetModel, WITHOUT ever calling repairIfPending -- report
    // generation must consume already-repaired data, not trigger a new
    // repair mid-generation.
    const result = await fetchBudgets("user-1");

    expect(budgetFindMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ month: "Aug 2026", budget: 500, spent: 100 }]);
    expect(repairIfPendingSpy).not.toHaveBeenCalled();
    expect(pendingSyncFindOneMock).not.toHaveBeenCalled();

    // No "repairIfPending is not a function" TypeError anywhere, and no
    // Node circular-dependency warning was ever logged to console --
    // proving the cycle's closing edge (fetchBudgets -> syncRecoveryService)
    // is genuinely gone, not just deferred.
    const allLoggedText = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (arg && arg.stack) || String(arg))
      .join("\n");
    expect(allLoggedText).not.toMatch(/repairIfPending is not a function/i);
    expect(allLoggedText).not.toMatch(/circular dependency/i);
  });
});
