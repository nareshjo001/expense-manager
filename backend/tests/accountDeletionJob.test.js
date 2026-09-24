// PRV-001-T04/T05/T06 -- cron wiring for the account-deletion purge job.
// Follows the same jest.doMock-the-scheduler pattern
// tests/retryPush.itemClaim.test.js already established for a different
// cron file: node-cron, the lease, the orchestrator, the Tier A steps
// module AND the Tier B steps module are all mocked so this file tests
// ONLY runDeletionJob's own glue logic (calling the orchestrator with the
// right args, logging per-user outcomes, the empty-steps no-op
// short-circuit, Tier A before Tier B ordering) -- not the orchestrator's
// own control flow (tests/accountDeletionOrchestrator.test.js), Tier A's
// own step behaviour (tests/accountDeletionTierASteps.test.js), or Tier
// B's own step behaviour (tests/accountDeletionTierBSteps.test.js), each
// of which has its own direct suite already.
"use strict";

const CRON_PATH = "node-cron";
const LEASE_PATH = "../utils/jobLease";
const ORCHESTRATOR_PATH = "../Services/PrivacyServices/accountDeletionOrchestrator";
const TIER_A_STEPS_PATH = "../Services/PrivacyServices/accountDeletionTierASteps";
const TIER_B_STEPS_PATH = "../Services/PrivacyServices/accountDeletionTierBSteps";
const JOB_PATH = "../cron/accountDeletionJob";
const LOGGER_PATH = "../utils/logger";

const FAKE_TIER_A_STEPS = [
  { name: "revoke-sessions", run: jest.fn(async () => {}) },
  { name: "delete-device-tokens", run: jest.fn(async () => {}) },
  { name: "clear-caches", run: jest.fn(async () => {}) },
];

const FAKE_TIER_B_STEPS = [
  { name: "delete-expenses", run: jest.fn(async () => {}) },
  { name: "delete-user", run: jest.fn(async () => {}) },
];

function loadJob({
  runAccountDeletionPurgeImpl,
  tierASteps = FAKE_TIER_A_STEPS,
  tierBSteps = FAKE_TIER_B_STEPS,
} = {}) {
  jest.resetModules();

  const scheduled = {};
  jest.doMock(CRON_PATH, () => ({
    schedule: (expr, handler) => {
      scheduled.expr = expr;
      scheduled.handler = handler;
      return { stop: () => {} };
    },
  }));

  const runAccountDeletionPurge = jest.fn(runAccountDeletionPurgeImpl || (async () => []));
  jest.doMock(ORCHESTRATOR_PATH, () => ({ runAccountDeletionPurge }));

  // Tier A's and Tier B's own step BEHAVIOUR are each covered by their own
  // direct suite; here they are mocked to small fixed fake lists so this
  // suite only has to assert the job wires
  // DELETION_STEPS = [...TIER_A_STEPS, ...TIER_B_STEPS], not re-verify any
  // individual step's internals.
  jest.doMock(TIER_A_STEPS_PATH, () => ({ TIER_A_STEPS: tierASteps }));
  jest.doMock(TIER_B_STEPS_PATH, () => ({ TIER_B_STEPS: tierBSteps }));

  // The lease itself is not under test here (accountDeletionOrchestrator's
  // own suite covers lease-loss handling); run the body directly, exactly
  // as retryPush.itemClaim.test.js already does for its own cron file.
  jest.doMock(LEASE_PATH, () => ({
    runWithLease: async (jobName, ttlMs, fn, options) => {
      loadJob.lastLeaseCall = { jobName, ttlMs, options };
      await fn({ isHeld: () => true });
      return { ran: true };
    },
  }));

  const logEvent = jest.fn();
  jest.doMock(LOGGER_PATH, () => ({ logEvent }));

  const jobModule = require(JOB_PATH);
  return { ...jobModule, scheduled, runAccountDeletionPurge, logEvent };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("PRV-001-T04/T05 accountDeletionJob cron wiring", () => {
  test("schedules a daily job and passes failOpen:false to runWithLease", async () => {
    const { scheduled } = loadJob();
    await scheduled.handler();

    expect(scheduled.expr).toBe("0 3 * * *");
    expect(loadJob.lastLeaseCall.options).toEqual({ failOpen: false });
    expect(loadJob.lastLeaseCall.jobName).toBe("accountDeletionJob");
  });

  test("DELETION_STEPS is Tier A's steps followed by Tier B's steps, in that order", async () => {
    const { DELETION_STEPS } = loadJob();
    // DELETION_STEPS is a fresh array (const DELETION_STEPS =
    // [...TIER_A_STEPS, ...TIER_B_STEPS]) so this module never mutates
    // either source module's own exported list -- same elements, not the
    // same array reference.
    expect(DELETION_STEPS).toEqual([...FAKE_TIER_A_STEPS, ...FAKE_TIER_B_STEPS]);
    expect(DELETION_STEPS.map((s) => s.name)).toEqual([
      "revoke-sessions",
      "delete-device-tokens",
      "clear-caches",
      "delete-expenses",
      "delete-user",
    ]);
  });

  test("calls the orchestrator with DELETION_STEPS and the lease every cycle", async () => {
    const { scheduled, runAccountDeletionPurge, DELETION_STEPS } = loadJob();

    await scheduled.handler();

    expect(runAccountDeletionPurge).toHaveBeenCalledWith(
      expect.objectContaining({ steps: DELETION_STEPS, lease: { isHeld: expect.any(Function) } })
    );
  });

  test("with both tiers empty, the orchestrator is never called (defensive no-op short-circuit)", async () => {
    const { scheduled, runAccountDeletionPurge, logEvent } = loadJob({ tierASteps: [], tierBSteps: [] });

    await scheduled.handler();

    expect(runAccountDeletionPurge).not.toHaveBeenCalled();
    expect(logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "no_steps_configured" }));
  });

  test("logs a purge_step_failed event for each unsuccessful per-user result, and purge_completed for a successful one", async () => {
    const { scheduled, logEvent } = loadJob({
      runAccountDeletionPurgeImpl: async () => [
        { userId: "user-1", ok: true, completed: ["a"], failedStep: null, error: null },
        { userId: "user-2", ok: false, completed: ["a"], failedStep: "b", error: "boom" },
      ],
    });

    await scheduled.handler();

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "purge_step_failed", userId: "user-2", failedStep: "b", errorMessage: "boom" })
    );
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "purge_completed", userId: "user-1" })
    );
  });

  test("an orchestrator-level throw is caught and logged via console.error, not propagated", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const { scheduled } = loadJob({
      runAccountDeletionPurgeImpl: async () => { throw new Error("db unreachable"); },
    });

    await expect(scheduled.handler()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith("Account deletion purge cron failed:", "db unreachable");
  });
});
