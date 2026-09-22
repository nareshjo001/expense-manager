// PRV-001-T05 -- Tier A immediate-effect steps (ADR-0007). Under test: that
// each step delegates to the correct existing/reusable dependency with the
// correct argument, and that runTierAImmediate keeps going (and logs) past
// a step that throws, rather than aborting the whole sequence -- Tier A
// steps are independent of each other (revoking sessions does not depend
// on device tokens being deleted, etc.), unlike the orchestrator's Tier B
// step contract where later steps may depend on earlier ones.
"use strict";

const SESSION_SERVICE_PATH = "../Services/AuthServices/session.service";
const DEVICE_TOKEN_PATH = "../models/DeviceToken";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const REPORT_CACHE_PATH = "../cache/reportCache";
const LOGGER_PATH = "../utils/logger";
const MODULE_PATH = "../Services/PrivacyServices/accountDeletionTierASteps";

function loadModule({ revokeImpl, deleteManyImpl, clearCacheImpl, invalidateImpl } = {}) {
  jest.resetModules();

  const revokeAllSessions = jest.fn(revokeImpl || (async () => ({ acknowledged: true })));
  jest.doMock(SESSION_SERVICE_PATH, () => ({ revokeAllSessions }));

  const deleteMany = jest.fn(deleteManyImpl || (async () => ({ deletedCount: 0 })));
  jest.doMock(DEVICE_TOKEN_PATH, () => ({ deleteMany }));

  const clearUserExpenseCache = jest.fn(clearCacheImpl || (async () => {}));
  jest.doMock(EXPENSE_CACHE_PATH, () => ({ clearUserExpenseCache }));

  const invalidate = jest.fn(invalidateImpl || (async () => {}));
  jest.doMock(REPORT_CACHE_PATH, () => ({ invalidate }));

  const logEvent = jest.fn();
  jest.doMock(LOGGER_PATH, () => ({ logEvent }));

  const mod = require(MODULE_PATH);
  return { ...mod, revokeAllSessions, deleteMany, clearUserExpenseCache, invalidate, logEvent };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("PRV-001-T05 individual Tier A steps", () => {
  test("revokeSessionsStep delegates to the existing revokeAllSessions(userId)", async () => {
    const { revokeSessionsStep, revokeAllSessions } = loadModule();
    await revokeSessionsStep("user-1");
    expect(revokeAllSessions).toHaveBeenCalledWith("user-1");
  });

  test("deleteDeviceTokensStep deletes every token scoped to the user", async () => {
    const { deleteDeviceTokensStep, deleteMany } = loadModule();
    await deleteDeviceTokensStep("user-1");
    expect(deleteMany).toHaveBeenCalledWith({ userId: "user-1" });
  });

  test("clearCachesStep clears both the expense cache and the report cache", async () => {
    const { clearCachesStep, clearUserExpenseCache, invalidate } = loadModule();
    await clearCachesStep("user-1");
    expect(clearUserExpenseCache).toHaveBeenCalledWith("user-1");
    expect(invalidate).toHaveBeenCalledWith("user-1");
  });

  test("TIER_A_STEPS lists the three steps in ADR-0007's stated order, orchestrator-shaped", () => {
    const { TIER_A_STEPS } = loadModule();
    expect(TIER_A_STEPS.map((s) => s.name)).toEqual([
      "revoke-sessions",
      "delete-device-tokens",
      "clear-caches",
    ]);
    for (const step of TIER_A_STEPS) {
      expect(typeof step.run).toBe("function");
    }
  });
});

describe("PRV-001-T05 runTierAImmediate", () => {
  test("runs every step against the given userId", async () => {
    const { runTierAImmediate, revokeAllSessions, deleteMany, clearUserExpenseCache, invalidate } = loadModule();

    await runTierAImmediate("user-1");

    expect(revokeAllSessions).toHaveBeenCalledWith("user-1");
    expect(deleteMany).toHaveBeenCalledWith({ userId: "user-1" });
    expect(clearUserExpenseCache).toHaveBeenCalledWith("user-1");
    expect(invalidate).toHaveBeenCalledWith("user-1");
  });

  test("a failing step is logged and does not stop the remaining steps from running", async () => {
    const { runTierAImmediate, deleteMany, clearUserExpenseCache, logEvent } = loadModule({
      revokeImpl: async () => { throw new Error("session store unreachable"); },
    });

    await expect(runTierAImmediate("user-1")).resolves.toBeUndefined();

    // Steps after the failing one still ran.
    expect(deleteMany).toHaveBeenCalledWith({ userId: "user-1" });
    expect(clearUserExpenseCache).toHaveBeenCalledWith("user-1");
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "immediate_step_failed",
        userId: "user-1",
        step: "revoke-sessions",
        errorMessage: "session store unreachable",
      })
    );
  });

  test("multiple failing steps are each logged independently", async () => {
    const { runTierAImmediate, logEvent } = loadModule({
      revokeImpl: async () => { throw new Error("boom-a"); },
      deleteManyImpl: async () => { throw new Error("boom-b"); },
    });

    await runTierAImmediate("user-1");

    const failedSteps = logEvent.mock.calls
      .map((call) => call[0])
      .filter((f) => f.event === "immediate_step_failed")
      .map((f) => f.step);
    expect(failedSteps).toEqual(["revoke-sessions", "delete-device-tokens"]);
  });
});
