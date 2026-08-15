// BALENISA URGENT PRODUCTION HOTFIX -- circular-require regression coverage.
//
// Confirmed production failure:
//   TypeError: syncRecoveryService.repairIfPending is not a function
//   Warning: Accessing non-existent property 'repairIfPending' of module
//   exports inside circular dependency
//
// Exact cycle (verified by reading every require() in the chain):
//   Services/syncRecoveryService.js
//     -> require("./reportService")                              (line 8)
//   Services/reportService.js
//     -> require("../analytics/reportGenerator")                 (line 2)
//   analytics/reportGenerator.js
//     -> require("./analyticsContext")                           (line 1)
//   analytics/analyticsContext.js
//     -> require("./dataProvider")                                (line 1)
//   analytics/dataProvider.js
//     -> require('../Controllers/BudgetControllers/fetchBudgets') (line 7)
//   Controllers/BudgetControllers/fetchBudgets.js
//     -> (used to) require('../../Services/syncRecoveryService')  <- CLOSES THE CYCLE
//
// fetchBudgets.js's former top-level `require('../../Services/syncRecoveryService')`
// closed this cycle. Node's CommonJS loader returns the REQUIRING module's
// (syncRecoveryService's) *partially built* module.exports object when a
// cycle is hit mid-load -- so fetchBudgets.js could capture a reference to
// syncRecoveryService.exports before `repairIfPending` (or any of its other
// exports) had been assigned yet, depending on the exact require order the
// first module resolved happened to trigger.
//
// The fix (see Controllers/BudgetControllers/fetchBudgets.js) resolves
// syncRecoveryService LAZILY -- inside fetchBudgets(), immediately before
// calling repairIfPending -- so the require happens long after both modules
// have finished their initial synchronous load pass, regardless of which
// module started the load.
//
// This test reproduces the EXACT production require order: it requires
// syncRecoveryService FIRST (as server.js's dependency graph effectively
// does before any controller runs), letting Node walk the real chain
// syncRecoveryService -> reportService -> reportGenerator ->
// analyticsContext -> dataProvider -> fetchBudgets for real (none of these
// six modules are mocked). Only true leaf DB/cache dependencies are mocked
// (config/Schemas, models/PendingSync, models/Report, cache/reportCache,
// Services/RecurringServices/recurringStateService) so no MongoDB/Redis
// connection is required.
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
  it("loading syncRecoveryService FIRST (which transitively requires fetchBudgets via reportService -> reportGenerator -> analyticsContext -> dataProvider) still yields a fully-initialized module with repairIfPending as a callable function, and fetchBudgets can call it without a TypeError or circular-export warning", async () => {
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

    // Leaf-level mongoose model: only the read paths repairIfPending's
    // fast no-pending-work branch actually exercises need a safe stub --
    // every PendingSync method resolves to "nothing pending" so
    // repairIfPending takes its normal, common-case, no-op-repair path.
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
    // (unmocked), reconstructing the exact cycle from the incident report.
    let syncRecoveryService;
    expect(() => {
      syncRecoveryService = require(SYNC_RECOVERY_SERVICE_PATH);
    }).not.toThrow();

    // Prove the module actually finished initializing -- not a partial/
    // in-progress circular-require object missing its exports.
    expect(typeof syncRecoveryService.repairIfPending).toBe("function");
    expect(typeof syncRecoveryService.reserve).toBe("function");
    expect(typeof syncRecoveryService.synchronizeAfterMutation).toBe("function");

    // Step 2: require fetchBudgets (already loaded via the chain above --
    // Node returns the same cached module, exactly as in production).
    const { fetchBudgets } = require(FETCH_BUDGETS_PATH);
    expect(typeof fetchBudgets).toBe("function");

    // Step 3: invoke fetchBudgets with the mocked DB dependencies in
    // place. This must resolve `syncRecoveryService.repairIfPending` as a
    // real function and call it -- proving the lazy require inside
    // fetchBudgets() works even though syncRecoveryService was the module
    // that originally triggered the whole chain.
    const result = await fetchBudgets("user-1");

    expect(pendingSyncFindOneMock).toHaveBeenCalledWith({ user: "user-1" });
    expect(budgetFindMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ month: "Aug 2026", budget: 500, spent: 100 }]);

    // No "repairIfPending is not a function" TypeError anywhere, and no
    // Node circular-dependency warning was ever logged to console.
    const allLoggedText = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (arg && arg.stack) || String(arg))
      .join("\n");
    expect(allLoggedText).not.toMatch(/repairIfPending is not a function/i);
    expect(allLoggedText).not.toMatch(/circular dependency/i);
  });
});
