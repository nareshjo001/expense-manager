// PRV-001-T04 -- resumable deletion orchestration engine.
//
// Under test: the eligibility query, the ordered/idempotent step runner,
// and its lease-loss/partial-failure handling -- NOT any real Tier A/Tier B
// step logic, which is T05/T06's job and does not exist yet. Steps here are
// fakes that record their own invocation, exactly so this suite is testing
// orchestration control flow rather than the (not yet built) real steps.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";

const makeUsersQuery = (users) => ({
  select: jest.fn(function select() { return this; }),
  lean: jest.fn(async () => users),
});

function loadOrchestrator(users) {
  jest.resetModules();
  const find = jest.fn(() => makeUsersQuery(users));
  jest.doMock(SCHEMAS_PATH, () => ({ UserModel: { find } }));
  const orchestrator = require("../Services/PrivacyServices/accountDeletionOrchestrator");
  return { ...orchestrator, find };
}

const heldLease = { isHeld: () => true };
const lostLease = { isHeld: () => false };

const recordingStep = (name, log, impl) => ({
  name,
  run: jest.fn(async (userId) => {
    log.push(name);
    if (impl) await impl(userId);
  }),
});

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("PRV-001-T04 findUsersEligibleForPurge", () => {
  test("queries only users with a non-null, elapsed deletionScheduledPurgeAt", async () => {
    const { findUsersEligibleForPurge, find } = loadOrchestrator([]);
    const now = new Date("2026-10-05T00:00:00.000Z");

    await findUsersEligibleForPurge(now);

    expect(find).toHaveBeenCalledWith({
      deletionRequestedAt: { $ne: null },
      deletionScheduledPurgeAt: { $ne: null, $lte: now },
    });
  });

  test("defaults `now` to the current time when not passed", async () => {
    const { findUsersEligibleForPurge, find } = loadOrchestrator([]);
    const before = Date.now();

    await findUsersEligibleForPurge();

    const usedNow = find.mock.calls[0][0].deletionScheduledPurgeAt.$lte;
    expect(usedNow.getTime()).toBeGreaterThanOrEqual(before);
    expect(usedNow.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("PRV-001-T04 purgeUser", () => {
  test("runs every step in order and reports success", async () => {
    const { purgeUser } = loadOrchestrator([]);
    const log = [];
    const steps = [recordingStep("tierA", log), recordingStep("tierB", log)];

    const result = await purgeUser("user-1", { steps, lease: heldLease });

    expect(log).toEqual(["tierA", "tierB"]);
    expect(result).toEqual({ ok: true, completed: ["tierA", "tierB"], failedStep: null, error: null });
    expect(steps[0].run).toHaveBeenCalledWith("user-1");
    expect(steps[1].run).toHaveBeenCalledWith("user-1");
  });

  test("stops at the first failing step and reports it without throwing", async () => {
    const { purgeUser } = loadOrchestrator([]);
    const log = [];
    const steps = [
      recordingStep("tierA", log),
      recordingStep("tierB", log, () => { throw new Error("collection unreachable"); }),
      recordingStep("tierC", log),
    ];

    const result = await purgeUser("user-1", { steps, lease: heldLease });

    expect(log).toEqual(["tierA", "tierB"]);
    expect(result.ok).toBe(false);
    expect(result.completed).toEqual(["tierA"]);
    expect(result.failedStep).toBe("tierB");
    expect(result.error).toBe("collection unreachable");
  });

  test("stops before running any further step once the lease is lost", async () => {
    const { purgeUser } = loadOrchestrator([]);
    const log = [];
    let held = true;
    const lease = { isHeld: () => held };
    const steps = [
      recordingStep("tierA", log, () => { held = false; }),
      recordingStep("tierB", log),
    ];

    const result = await purgeUser("user-1", { steps, lease });

    expect(log).toEqual(["tierA"]);
    expect(result).toEqual({ ok: false, completed: ["tierA"], failedStep: null, error: "lease_lost" });
  });

  test("throws synchronously when given no steps -- a misconfiguration, not a runtime user-data failure", async () => {
    const { purgeUser } = loadOrchestrator([]);
    await expect(purgeUser("user-1", { steps: [] })).rejects.toThrow(/non-empty ordered/);
    await expect(purgeUser("user-1", {})).rejects.toThrow(/non-empty ordered/);
  });

  test("re-running the same steps against the same user is safe (idempotency contract exercised, not assumed)", async () => {
    const { purgeUser } = loadOrchestrator([]);
    const seen = new Set();
    let duplicateCalls = 0;
    const steps = [{
      name: "delete-if-exists",
      run: jest.fn(async (userId) => {
        if (seen.has(userId)) duplicateCalls += 1;
        seen.add(userId);
      }),
    }];

    const first = await purgeUser("user-1", { steps, lease: heldLease });
    const second = await purgeUser("user-1", { steps, lease: heldLease });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // The step itself tolerated being called twice without error -- that is
    // what "idempotent" means for this contract; the orchestrator's job is
    // only to allow the re-run, not to prevent it.
    expect(duplicateCalls).toBe(1);
  });
});

describe("PRV-001-T04 runAccountDeletionPurge", () => {
  test("purges every eligible user and reports a per-user result", async () => {
    const users = [{ _id: "user-1" }, { _id: "user-2" }];
    const { runAccountDeletionPurge } = loadOrchestrator(users);
    const log = [];
    const steps = [recordingStep("only-step", log)];

    const results = await runAccountDeletionPurge({ steps, lease: heldLease });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.map((r) => r.userId)).toEqual(["user-1", "user-2"]);
    expect(log).toEqual(["only-step", "only-step"]);
  });

  test("one user's step failure does not stop the batch from reaching the next user", async () => {
    const users = [{ _id: "user-1" }, { _id: "user-2" }];
    const { runAccountDeletionPurge } = loadOrchestrator(users);
    const steps = [{
      name: "flaky",
      run: jest.fn(async (userId) => {
        if (userId === "user-1") throw new Error("boom");
      }),
    }];

    const results = await runAccountDeletionPurge({ steps, lease: heldLease });

    expect(results[0]).toMatchObject({ userId: "user-1", ok: false, failedStep: "flaky" });
    expect(results[1]).toMatchObject({ userId: "user-2", ok: true });
  });

  test("stops the whole batch early once the lease is lost between users", async () => {
    const users = [{ _id: "user-1" }, { _id: "user-2" }, { _id: "user-3" }];
    const { runAccountDeletionPurge } = loadOrchestrator(users);
    const log = [];

    const results = await runAccountDeletionPurge({
      steps: [recordingStep("only-step", log)],
      lease: lostLease,
    });

    expect(results).toEqual([]);
    expect(log).toEqual([]);
  });

  test("invokes onUserResult once per processed user", async () => {
    const users = [{ _id: "user-1" }];
    const { runAccountDeletionPurge } = loadOrchestrator(users);
    const onUserResult = jest.fn();

    await runAccountDeletionPurge({
      steps: [recordingStep("only-step", [])],
      lease: heldLease,
      onUserResult,
    });

    expect(onUserResult).toHaveBeenCalledTimes(1);
    expect(onUserResult).toHaveBeenCalledWith("user-1", expect.objectContaining({ ok: true }));
  });

  test("with zero eligible users, no step runs and an empty result set is returned", async () => {
    const { runAccountDeletionPurge } = loadOrchestrator([]);
    const results = await runAccountDeletionPurge({ steps: [recordingStep("only-step", [])], lease: heldLease });
    expect(results).toEqual([]);
  });
});
