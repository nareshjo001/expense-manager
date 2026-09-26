// BUD-001-T06 -- synchronizeAfterMutation's category budget alert hook
// (invariant I14: alerts never affect the outcome of the triggering write).
"use strict";

const PENDING_SYNC_MODEL_PATH = "../models/PendingSync";
const BUDGET_SERVICE_PATH = "../Services/BudgetServices/budget.service";
const REPORT_SERVICE_PATH = "../Services/reportService";
const ALERT_SERVICE_PATH = "../Services/BudgetServices/categoryBudgetAlert.service";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";

const USER_ID = "64b000000000000000000001";
const SEPT = new Date(2026, 8, 3);

const SYNCHRONIZED = {
  status: "synchronized",
  budget: "synchronized",
  report: "synchronized",
  recoveryPending: false,
};
const PENDING = { status: "pending", budget: "pending", report: "pending", recoveryPending: true };

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadService({ alertImpl, findOneAndUpdateImpl } = {}) {
  jest.resetModules();
  const callOrder = [];

  jest.doMock(PENDING_SYNC_MODEL_PATH, () => ({
    findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
    findOneAndUpdate: jest.fn(findOneAndUpdateImpl || (async () => ({ revision: 1 }))),
    updateOne: jest.fn(async () => ({})),
  }));
  jest.doMock(BUDGET_SERVICE_PATH, () => ({
    ...jest.requireActual(BUDGET_SERVICE_PATH),
    recalculateBudget: jest.fn(async () => {
      callOrder.push("recalculateBudget");
    }),
  }));
  jest.doMock(REPORT_SERVICE_PATH, () => ({
    refreshReport: jest.fn(async () => {
      callOrder.push("refreshReport");
    }),
    getReport: jest.fn(),
  }));

  const alertMock = jest.fn(async (...args) => {
    callOrder.push("alerts");
    return alertImpl ? alertImpl(...args) : { evaluatedMonths: [], notified: [], errors: [] };
  });
  jest.doMock(ALERT_SERVICE_PATH, () => ({ evaluateCategoryBudgetAlerts: alertMock }));

  jest.spyOn(console, "error").mockImplementation(() => {});

  const syncRecoveryService = require(SYNC_RECOVERY_SERVICE_PATH);
  return { syncRecoveryService, alertMock, callOrder };
}

describe("synchronizeAfterMutation -> category budget alerts", () => {
  test("evaluates alerts with the mutation's userId and budget dates, after the derived-data sync", async () => {
    const { syncRecoveryService, alertMock, callOrder } = loadService();

    const result = await syncRecoveryService.synchronizeAfterMutation({
      userId: USER_ID,
      budgetDates: [SEPT],
      budgetTokens: ["tok-a"],
      reportToken: "tok-b",
    });

    expect(result).toEqual(SYNCHRONIZED);
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith({ userId: USER_ID, dates: [SEPT] });
    expect(callOrder).toEqual(["recalculateBudget", "refreshReport", "alerts"]);
  });

  test("missing or empty budgetDates -> alert service is not invoked; shape unchanged", async () => {
    const { syncRecoveryService, alertMock } = loadService();
    await expect(syncRecoveryService.synchronizeAfterMutation({ userId: USER_ID })).resolves.toEqual(SYNCHRONIZED);
    await expect(
      syncRecoveryService.synchronizeAfterMutation({ userId: USER_ID, budgetDates: [] })
    ).resolves.toEqual(SYNCHRONIZED);
    expect(alertMock).not.toHaveBeenCalled();
  });

  test("an alert service rejection leaves the return value byte-identical and does not throw", async () => {
    const { syncRecoveryService, alertMock } = loadService({
      alertImpl: async () => {
        throw new Error("alert boom");
      },
    });
    const result = await syncRecoveryService.synchronizeAfterMutation({ userId: USER_ID, budgetDates: [SEPT] });
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual(SYNCHRONIZED);
    expect(Object.keys(result)).toEqual(["status", "budget", "report", "recoveryPending"]);
  });

  test("an alert service that throws synchronously is also contained", async () => {
    jest.resetModules();
    const { syncRecoveryService } = loadService();
    jest.doMock(ALERT_SERVICE_PATH, () => ({
      evaluateCategoryBudgetAlerts: () => {
        throw new Error("sync boom");
      },
    }));
    const result = await syncRecoveryService.synchronizeAfterMutation({ userId: USER_ID, budgetDates: [SEPT] });
    expect(result).toEqual(SYNCHRONIZED);
  });

  test("still evaluates alerts when synchronization itself fails, and keeps the pending shape", async () => {
    const { syncRecoveryService, alertMock } = loadService({
      findOneAndUpdateImpl: async () => {
        throw new Error("confirm failed");
      },
    });
    const result = await syncRecoveryService.synchronizeAfterMutation({ userId: USER_ID, budgetDates: [SEPT] });
    expect(result).toEqual(PENDING);
    expect(alertMock).toHaveBeenCalledWith({ userId: USER_ID, dates: [SEPT] });
  });

  test("sync failure AND alert failure together still return the pending shape", async () => {
    const { syncRecoveryService } = loadService({
      findOneAndUpdateImpl: async () => {
        throw new Error("confirm failed");
      },
      alertImpl: async () => {
        throw new Error("alert boom");
      },
    });
    await expect(
      syncRecoveryService.synchronizeAfterMutation({ userId: USER_ID, budgetDates: [SEPT] })
    ).resolves.toEqual(PENDING);
  });
});

describe("synchronizeAfterMutation with the REAL alert service and no database connection", () => {
  test("alerts are skipped without touching the CategoryBudget model; return shape unchanged", async () => {
    jest.resetModules();
    jest.doMock(PENDING_SYNC_MODEL_PATH, () => ({
      findOne: jest.fn(() => ({ lean: jest.fn().mockResolvedValue(null) })),
      findOneAndUpdate: jest.fn(async () => ({ revision: 1 })),
      updateOne: jest.fn(async () => ({})),
    }));
    jest.doMock(BUDGET_SERVICE_PATH, () => ({
      ...jest.requireActual(BUDGET_SERVICE_PATH),
      recalculateBudget: jest.fn(async () => {}),
    }));
    jest.doMock(REPORT_SERVICE_PATH, () => ({ refreshReport: jest.fn(async () => {}), getReport: jest.fn() }));
    jest.spyOn(console, "log").mockImplementation(() => {});

    const { CategoryBudgetModel } = require("../models/CategoryBudget");
    const findSpy = jest.spyOn(CategoryBudgetModel, "find");
    const syncRecoveryService = require(SYNC_RECOVERY_SERVICE_PATH);

    const started = Date.now();
    const result = await syncRecoveryService.synchronizeAfterMutation({ userId: USER_ID, budgetDates: [new Date()] });
    expect(result).toEqual(SYNCHRONIZED);
    expect(findSpy).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(2000); // no Mongoose command buffering
  });
});
