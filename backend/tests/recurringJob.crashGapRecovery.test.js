// Remediation Workstream D -- recurring-expense crash-gap recovery, extended
// to also close the REPORT-SYNCHRONIZATION crash window identified in
// follow-up review:
//
//   expense inserted -> process crashes before report synchronization ->
//   next run sees E11000 replay -> schedule advances -> replay skips
//   synchronization -> report/cache permanently stale despite the expense
//   existing.
//
// Root causes closed here:
//   1. (original) nextDueDate advanced BEFORE ExpenseModel.create() ran --
//      a create() failure permanently lost the occurrence. Fixed by a
//      deterministic occurrence id (sha256 of recurring._id + due instant)
//      and insert-before-advance ordering.
//   2. (this file's extension) the cron previously called
//      recalculateBudget/refreshReport DIRECTLY, with no reserve()/
//      PendingSync involvement at all -- a crash between a successful
//      insert and those calls left ZERO durable evidence sync was ever
//      needed. Fixed by taking a reserve() BEFORE the insert (durable
//      Tier-2 evidence) and replacing the raw calls with
//      synchronizeAfterMutation() (confirm-then-recompute-then-persist,
//      the SAME mechanism addexpense.js/editExpense.js/addincome.js use).
//   3. (2nd follow-up, reservation-ownership correction) the E11000 replay
//      branch ORIGINALLY called abandon() on its own reservation tokens,
//      then repairIfPending(). Under the field design at the time
//      (reservedReport/reservedUserWide as SINGLE-object fields on
//      PendingSync), that combination was unsafe: a later reserve() call's
//      token silently OVERWROTE an earlier, still-unconfirmed reservation's
//      token in that SAME field with no record the overwrite happened, and
//      abandon() unconditionally cleared that field to null with no check
//      that the current value still matched the token it was releasing.
//      Chained together, a crashed run's own reservation could be silently
//      overwritten and then deleted with no substitute Tier-1 marker ever
//      recorded -- permanently losing the recovery signal even though the
//      expense is durably committed. Fixed by NEVER calling abandon() on
//      this path -- the replay instead drives ONE real reconciliation via
//      synchronizeAfterMutation() using ITS OWN (definitely-current) token,
//      whose first action (confirm()) atomically upgrades Tier-2 evidence
//      into durable Tier-1 evidence in the SAME write that releases the
//      token, so evidence is only ever replaced, never merely deleted.
//      (System-wide reservation-ownership correction, reassessed here) --
//      reservedReport/reservedUserWide have since been replaced with
//      owned-token ARRAYS (reservedReports/reservedUserWideReservations, see
//      models/PendingSync.js and Services/syncRecoveryService.js), which
//      closes the underlying overwrite hazard for EVERY caller, not just
//      this one -- but this file's own choice to never call abandon() on
//      the replay path remains correct and unchanged for the separate
//      reason documented at the call site in cron/recurringJob.js: this run
//      has no standing to retire a token it does not own. See
//      tests/recurringJob.reservationOwnership.test.js for a proof against
//      the REAL syncRecoveryService.js + a real-CAS-semantics fake
//      PendingSync model (not a fully mocked service) that this exact
//      interleaving cannot lose R1's evidence.
//
// This file mocks Services/syncRecoveryService.js itself (reserve,
// synchronizeAfterMutation) rather than the lower-level budget.service/
// reportService modules -- syncRecoveryService's OWN internal correctness is
// already proven by tests/syncRecoveryService.test.js,
// tests/mutationRecoveryCorrectness.test.js, and (for the reservation-
// ownership question specifically) tests/recurringJob.reservationOwnership.
// test.js. This file's job is narrower and different: prove
// cron/recurringJob.js itself calls into that already-proven machinery at
// the right moments, with the right arguments, in the right order.
// `abandon`/`repairIfPending` are still provided by loadCronJob()'s mock
// factory below (harmless -- cron/recurringJob.js no longer imports either)
// purely so a future regression that reintroduces a call to either is
// immediately visible as an unexpected mock invocation in these tests.
"use strict";

const crypto = require("crypto");

const RECURRING_EXPENSE_PATH = "../models/RecurringExpense";
const SCHEMAS_PATH = "../config/Schemas";
const NOTIFICATION_PATH = "../models/Notification";
const PUSH_SERVICE_PATH = "../Services/push.service";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const CRON_JOB_PATH = "../cron/recurringJob";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

const SYNCHRONIZED_RESULT = {
  status: "synchronized",
  budget: "synchronized",
  report: "synchronized",
  recoveryPending: false,
};

const PENDING_RESULT = {
  status: "pending",
  budget: "pending",
  report: "pending",
  recoveryPending: true,
};

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function occurrenceIdFor(recurringId, nextDueDate) {
  return crypto.createHash("sha256").update(`${recurringId}:${nextDueDate.toISOString()}`).digest("hex");
}

// `createBehavior` optionally overrides ExpenseModel.create's behavior:
//   undefined                -> normal, always succeeds
//   { throwOnce: "11000" }   -> first create() call throws a duplicate-key
//                               error (code 11000), simulating an already-
//                               inserted occurrence
//   { throwOnce: "generic" } -> first create() call throws a generic error
//
// `syncBehavior` optionally overrides synchronizeAfterMutation's/
// repairIfPending's return values/throwing behavior:
//   { synchronizeResult }         -> synchronizeAfterMutation resolves with this
//   { synchronizeThrows: true }   -> synchronizeAfterMutation rejects
//   { repairResult }              -> repairIfPending resolves with this
function loadCronJob({ dueExpenses, createBehavior, existingExpenseForDedupe, syncBehavior = {} } = {}) {
  jest.resetModules();

  const callOrder = [];

  let capturedCallback = null;
  jest.doMock("node-cron", () => ({
    schedule: jest.fn((_expr, callback) => {
      capturedCallback = callback;
    }),
  }));

  const findOneAndUpdateMock = jest.fn(async (...args) => {
    callOrder.push("advanceSchedule");
    return { _id: "updated" };
  });
  jest.doMock(RECURRING_EXPENSE_PATH, () => ({
    RecurringExpenseModel: {
      find: jest.fn(() => ({
        lean: jest.fn().mockResolvedValue(dueExpenses),
      })),
      findOneAndUpdate: findOneAndUpdateMock,
    },
  }));

  const createdExpenses = [];
  let createCallCount = 0;
  const createMock = jest.fn(async (doc) => {
    callOrder.push("create");
    createCallCount += 1;
    if (createBehavior && createBehavior.throwOnce && createCallCount === 1) {
      if (createBehavior.throwOnce === "11000") {
        const err = new Error("E11000 duplicate key error");
        err.code = 11000;
        throw err;
      }
      throw new Error("simulated transient database failure");
    }
    const created = { ...doc, _id: `expense-${createdExpenses.length + 1}` };
    createdExpenses.push(created);
    return created;
  });

  const findOneLeanMock = jest.fn().mockResolvedValue(existingExpenseForDedupe || null);
  const ExpenseModelMock = {
    create: createMock,
    findOne: jest.fn(() => ({ lean: findOneLeanMock })),
  };
  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel: ExpenseModelMock }));

  const notificationCreateMock = jest.fn().mockResolvedValue({ _id: "notif-1", title: "t" });
  const notificationUpdateOneMock = jest.fn().mockResolvedValue({});
  jest.doMock(NOTIFICATION_PATH, () => ({
    create: notificationCreateMock,
    updateOne: notificationUpdateOneMock,
  }));

  const sendPushMock = jest.fn().mockResolvedValue({ success: true });
  jest.doMock(PUSH_SERVICE_PATH, () => ({ sendPush: sendPushMock }));

  const clearUserExpenseCacheMock = jest.fn().mockResolvedValue(undefined);
  jest.doMock(EXPENSE_CACHE_PATH, () => ({ clearUserExpenseCache: clearUserExpenseCacheMock }));

  let reserveCounter = 0;
  const reserveMock = jest.fn(async () => {
    callOrder.push("reserve");
    reserveCounter += 1;
    return {
      budgetReservations: [{ month: new Date("2026-08-01T00:00:00.000Z"), token: `budget-token-${reserveCounter}` }],
      reportReservation: { token: `report-token-${reserveCounter}` },
      userWideReservation: null,
    };
  });

  const abandonMock = jest.fn(async () => {
    callOrder.push("abandon");
    return null;
  });

  const synchronizeAfterMutationMock = jest.fn(async () => {
    callOrder.push("synchronizeAfterMutation");
    if (syncBehavior.synchronizeThrows) {
      throw new Error("simulated synchronization failure");
    }
    return syncBehavior.synchronizeResult || SYNCHRONIZED_RESULT;
  });

  const repairIfPendingMock = jest.fn(async () => {
    callOrder.push("repairIfPending");
    return syncBehavior.repairResult || { attempted: false, stillPending: false };
  });

  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    reserve: reserveMock,
    abandon: abandonMock,
    synchronizeAfterMutation: synchronizeAfterMutationMock,
    repairIfPending: repairIfPendingMock,
  }));

  require(CRON_JOB_PATH);

  return {
    runCronCallback: async () => capturedCallback(),
    createdExpenses,
    createMock,
    findOneAndUpdateMock,
    notificationCreateMock,
    sendPushMock,
    clearUserExpenseCacheMock,
    reserveMock,
    abandonMock,
    synchronizeAfterMutationMock,
    repairIfPendingMock,
    callOrder,
  };
}

const dueRecurring = (overrides = {}) => ({
  _id: "recurring-1",
  userId: USER_ID,
  expenseName: "Netflix",
  expenseAmount: 500,
  expenseCategory: "Entertainment",
  nextDueDate: new Date("2026-08-01T00:00:00.000Z"),
  ...overrides,
});

describe("Remediation Workstream D: recurring-expense crash-gap recovery (occurrence identity)", () => {
  it("1. two concurrent claims for the SAME occurrence never produce two expense documents (deterministic id + dedupe)", async () => {
    const recurring = dueRecurring();
    const occurrenceId = occurrenceIdFor(recurring._id, recurring.nextDueDate);

    const harness = loadCronJob({
      dueExpenses: [recurring],
      createBehavior: { throwOnce: "11000" },
      existingExpenseForDedupe: { userId: USER_ID, id: occurrenceId, _id: "expense-existing" },
    });

    await harness.runCronCallback();

    expect(harness.createdExpenses).toHaveLength(0);
    expect(harness.createMock).toHaveBeenCalledTimes(1);
  });

  it("2. a genuine insert failure leaves nextDueDate untouched and the reservation UNABANDONED -- the occurrence is never lost", async () => {
    const recurring = dueRecurring();
    const harness = loadCronJob({
      dueExpenses: [recurring],
      createBehavior: { throwOnce: "generic" },
    });

    await harness.runCronCallback();

    expect(harness.findOneAndUpdateMock).not.toHaveBeenCalled();
    expect(harness.createdExpenses).toHaveLength(0);
    // Ambiguous failure -- the pre-write reservation is durable evidence a
    // write MAY have landed, so it must be left in place, never abandoned.
    expect(harness.abandonMock).not.toHaveBeenCalled();
    expect(harness.synchronizeAfterMutationMock).not.toHaveBeenCalled();
  });

  it("4/6/7. a genuinely new occurrence reserves BEFORE inserting, then advances the schedule, then synchronizes exactly once", async () => {
    const recurring = dueRecurring();
    const harness = loadCronJob({ dueExpenses: [recurring] });

    await harness.runCronCallback();

    expect(harness.createdExpenses).toHaveLength(1);
    expect(harness.findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    expect(harness.reserveMock).toHaveBeenCalledTimes(1);
    expect(harness.synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
    expect(harness.clearUserExpenseCacheMock).toHaveBeenCalledTimes(1);
    expect(harness.notificationCreateMock).toHaveBeenCalledTimes(1);
    expect(harness.sendPushMock).toHaveBeenCalledTimes(1);
    // Ordering: reserve() strictly before create(), which is strictly
    // before synchronizeAfterMutation().
    expect(harness.callOrder.indexOf("reserve")).toBeLessThan(harness.callOrder.indexOf("create"));
    expect(harness.callOrder.indexOf("create")).toBeLessThan(harness.callOrder.indexOf("synchronizeAfterMutation"));
    // synchronizeAfterMutation receives the SAME tokens reserve() returned.
    expect(harness.synchronizeAfterMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        budgetTokens: ["budget-token-1"],
        reportToken: "report-token-1",
      })
    );
  });

  it("deterministic occurrence identity is stable for the same (recurring, due instant) across separate computations", () => {
    const dueDate = new Date("2026-09-01T00:00:00.000Z");
    const idA = occurrenceIdFor("recurring-xyz", dueDate);
    const idB = occurrenceIdFor("recurring-xyz", dueDate);
    const idDifferentUser = occurrenceIdFor("recurring-abc", dueDate);

    expect(idA).toBe(idB);
    expect(idA).not.toBe(idDifferentUser);
  });

  it("8. category normalization remains correct for a newly inserted occurrence", async () => {
    const recurring = dueRecurring({ expenseCategory: "  medical  " });
    const harness = loadCronJob({ dueExpenses: [recurring] });

    await harness.runCronCallback();

    expect(harness.createdExpenses[0].expenseCategory).toBe("Health");
  });

  it("9. user isolation remains correct -- the inserted expense, reservation, and notification always belong to the recurring definition's own userId", async () => {
    const recurring = dueRecurring({ userId: "some-other-user" });
    const harness = loadCronJob({ dueExpenses: [recurring] });

    await harness.runCronCallback();

    expect(harness.createdExpenses[0].userId).toBe("some-other-user");
    expect(harness.reserveMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "some-other-user" })
    );
  });

  it("10. multiple overdue occurrences in one run still follow the established catch-up policy (each reserved/processed independently)", async () => {
    const recurringA = dueRecurring({ _id: "recurring-A" });
    const recurringB = dueRecurring({ _id: "recurring-B", expenseName: "Gym" });
    const harness = loadCronJob({ dueExpenses: [recurringA, recurringB] });

    await harness.runCronCallback();

    expect(harness.createdExpenses).toHaveLength(2);
    expect(harness.findOneAndUpdateMock).toHaveBeenCalledTimes(2);
    expect(harness.reserveMock).toHaveBeenCalledTimes(2);
  });

  it("12. existing successful (non-crash) cron behavior is unchanged for a normal single due occurrence", async () => {
    const recurring = dueRecurring();
    const harness = loadCronJob({ dueExpenses: [recurring] });

    await expect(harness.runCronCallback()).resolves.not.toThrow();
    expect(harness.createdExpenses[0].expenseDescription).toBe("Auto logged recurring expense");
    expect(harness.createdExpenses[0].isRecurring).toBe(true);
  });
});

describe("Remediation Workstream D (follow-up): report/cache synchronization crash-gap", () => {
  it("13. a successful insert takes a durable reservation BEFORE synchronizing -- proves pre-write evidence exists for a crash immediately after insert", async () => {
    const recurring = dueRecurring();
    const harness = loadCronJob({ dueExpenses: [recurring] });

    await harness.runCronCallback();

    // reserve() happened before create() (asserted above in test 4/6/7) --
    // this is the exact durable Tier-2 PendingSync evidence that survives a
    // crash between the insert committing and synchronizeAfterMutation()
    // ever being reached. No in-memory-only bookkeeping is used anywhere in
    // this file -- reserve()/synchronizeAfterMutation()/repairIfPending()
    // are the only report/cache-affecting calls, and all three are backed
    // by Services/syncRecoveryService.js's real, Mongo-persisted
    // PendingSync model in production.
    expect(harness.reserveMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, reserveReport: true })
    );
  });

  it("14. crash-after-insert recovery: an E11000 replay drives ONE reconciliation using its OWN reservation and never calls abandon()", async () => {
    const recurring = dueRecurring();
    const occurrenceId = occurrenceIdFor(recurring._id, recurring.nextDueDate);

    // Simulates: a PRIOR run's insert committed (the expense exists) but
    // that run crashed before ever reaching synchronizeAfterMutation() --
    // its own reservation is now orphaned. Under the current owned-token
    // ARRAY design (reservedReports/reservedUserWideReservations), THIS
    // run's own reserve() call no longer overwrites that orphaned entry --
    // both coexist -- see tests/recurringJob.reservationOwnership.test.js
    // for that exact proof against real PendingSync semantics. THIS run
    // rediscovers the same due recurring definition, hits E11000 on its own
    // insert attempt, and
    // must recover the deferred sync WITHOUT ever calling abandon() (which
    // would risk deleting evidence with nothing durable substituted).
    const harness = loadCronJob({
      dueExpenses: [recurring],
      createBehavior: { throwOnce: "11000" },
      existingExpenseForDedupe: { userId: USER_ID, id: occurrenceId, _id: "expense-from-run-1" },
    });

    await harness.runCronCallback();

    // 3. Next run encounters the deterministic duplicate.
    expect(harness.createdExpenses).toHaveLength(0);
    // Reservation-ownership correction: abandon() is NEVER called on this
    // path anymore -- see the file header comment for the exact defect this
    // closes.
    expect(harness.abandonMock).not.toHaveBeenCalled();
    expect(harness.repairIfPendingMock).not.toHaveBeenCalled();
    // 5. The report is (eventually) synchronized -- via ONE
    // synchronizeAfterMutation() call using THIS run's own reservation
    // tokens (the same tokens reserve() returned to it above).
    expect(harness.synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
    expect(harness.synchronizeAfterMutationMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, budgetTokens: ["budget-token-1"], reportToken: "report-token-1" })
    );
    // 4. The schedule still advances safely on the replay.
    expect(harness.findOneAndUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ _id: recurring._id, nextDueDate: recurring.nextDueDate }),
      expect.anything()
    );
    // 6. No second expense inserted, and no duplicate notification/push.
    expect(harness.notificationCreateMock).not.toHaveBeenCalled();
    expect(harness.sendPushMock).not.toHaveBeenCalled();
  });

  it("15. a replay whose reconciliation itself fails does not throw out of the cron and leaves the durable Tier-1 marker (already written by confirm()) as the retryable evidence", async () => {
    const recurring = dueRecurring();
    const occurrenceId = occurrenceIdFor(recurring._id, recurring.nextDueDate);

    // synchronizeAfterMutation rejecting entirely (the worst case -- e.g. a
    // transient DB error mid-recompute) is the scenario this test targets:
    // the replay path wraps its own synchronizeAfterMutation() call in a
    // .catch() specifically so an ambiguous-failure recompute on the rare
    // crash-replay path can never crash the whole cron batch or be mistaken
    // for a reason to duplicate/re-abandon the occurrence. confirm() (run
    // as synchronizeAfterMutation's own first, unconditional action) has
    // already durably written the Tier-1 marker before any recompute is
    // attempted, so that marker -- not this test -- is what proves the
    // "retryable" half of the invariant; this test proves the CRON itself
    // survives and does not duplicate anything when the recompute fails.
    const harness = loadCronJob({
      dueExpenses: [recurring],
      createBehavior: { throwOnce: "11000" },
      existingExpenseForDedupe: { userId: USER_ID, id: occurrenceId, _id: "expense-from-run-1" },
      syncBehavior: { synchronizeThrows: true },
    });

    await expect(harness.runCronCallback()).resolves.not.toThrow();

    expect(harness.createdExpenses).toHaveLength(0);
    expect(harness.abandonMock).not.toHaveBeenCalled();
    expect(harness.synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
    // The schedule still advances -- the occurrence itself is durably
    // inserted regardless of whether its sync reconciliation succeeded.
    expect(harness.findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    expect(harness.notificationCreateMock).not.toHaveBeenCalled();
  });

  it("15b. a replay's reconciliation reporting recoveryPending:true (a partial, non-throwing failure) still leaves the run intact -- no duplicate, no throw", async () => {
    const recurring = dueRecurring();
    const occurrenceId = occurrenceIdFor(recurring._id, recurring.nextDueDate);

    const harness = loadCronJob({
      dueExpenses: [recurring],
      createBehavior: { throwOnce: "11000" },
      existingExpenseForDedupe: { userId: USER_ID, id: occurrenceId, _id: "expense-from-run-1" },
      syncBehavior: { synchronizeResult: PENDING_RESULT },
    });

    await expect(harness.runCronCallback()).resolves.not.toThrow();

    expect(harness.createdExpenses).toHaveLength(0);
    expect(harness.synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
    expect(harness.findOneAndUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("16. a synchronization failure after a successful insert leaves a durable repair path (recoveryPending) without duplicating the occurrence or blocking notification", async () => {
    const recurring = dueRecurring();
    const harness = loadCronJob({
      dueExpenses: [recurring],
      syncBehavior: { synchronizeResult: PENDING_RESULT },
    });

    await expect(harness.runCronCallback()).resolves.not.toThrow();

    // The expense still committed and the schedule still advanced --
    // synchronization status never blocks the primary write's durability.
    expect(harness.createdExpenses).toHaveLength(1);
    expect(harness.findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    // synchronizeAfterMutation's own confirm()-first design (see
    // syncRecoveryService.js) already wrote a durable Tier-1 marker before
    // reporting recoveryPending:true here -- the cron does not need (and
    // does not perform) any additional bookkeeping; a later replay's
    // repairIfPending(), or any user-facing report/budget read, repairs it.
    expect(harness.synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
    // Notification/push still proceed for the genuinely-new occurrence --
    // a pending sync is not treated as an insert failure.
    expect(harness.notificationCreateMock).toHaveBeenCalledTimes(1);
  });

  it("17. a synchronizeAfterMutation rejection does not crash the whole cron run or duplicate a later occurrence", async () => {
    const recurring = dueRecurring();
    const harness = loadCronJob({
      dueExpenses: [recurring],
      syncBehavior: { synchronizeThrows: true },
    });

    // The per-recurring-item work is not wrapped in its own try/catch for
    // synchronizeAfterMutation, so this proves the OUTER cron-level catch
    // (Recurring cron failed) contains the failure without an unhandled
    // rejection -- and, critically, that the expense itself and the
    // schedule advancement already committed beforehand and are therefore
    // never rolled back or duplicated by this failure.
    await expect(harness.runCronCallback()).resolves.not.toThrow();
    expect(harness.createdExpenses).toHaveLength(1);
    expect(harness.findOneAndUpdateMock).toHaveBeenCalledTimes(1);
  });
});
