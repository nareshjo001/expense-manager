// BALENISA URGENT PRODUCTION HOTFIX -- corrected.
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
    let syncRecoveryService;
    expect(() => {
      syncRecoveryService = require(SYNC_RECOVERY_SERVICE_PATH);
    }).not.toThrow();

    expect(typeof syncRecoveryService.repairIfPending).toBe("function");
    expect(typeof syncRecoveryService.reserve).toBe("function");
    expect(typeof syncRecoveryService.synchronizeAfterMutation).toBe("function");

    // Spy on the real repairIfPending AFTER the module has fully loaded, so
    const repairIfPendingSpy = jest.spyOn(syncRecoveryService, "repairIfPending");

    // Step 2: require fetchBudgets (already loaded via the chain above --
    // Node returns the same cached module, exactly as in production).
    const { fetchBudgets } = require(FETCH_BUDGETS_PATH);
    expect(typeof fetchBudgets).toBe("function");

    // Step 3: invoke fetchBudgets. It must complete correctly using only
    const result = await fetchBudgets("user-1");

    expect(budgetFindMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([{ month: "Aug 2026", budget: 500, spent: 100 }]);
    expect(repairIfPendingSpy).not.toHaveBeenCalled();
    expect(pendingSyncFindOneMock).not.toHaveBeenCalled();

    // No "repairIfPending is not a function" TypeError anywhere, and no
    const allLoggedText = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => (arg && arg.stack) || String(arg))
      .join("\n");
    expect(allLoggedText).not.toMatch(/repairIfPending is not a function/i);
    expect(allLoggedText).not.toMatch(/circular dependency/i);
  });
});
