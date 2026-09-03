// Remediation Workstream D -- recurring-expense crash-gap recovery, extended
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
function loadCronJob({ dueExpenses, createBehavior, existingExpenseForDedupe, syncBehavior = {} } = {}) {
  jest.resetModules();

  const callOrder = [];

  let capturedCallback = null;
  jest.doMock("node-cron", () => ({
    schedule: jest.fn((_expr, callback) => {
      capturedCallback = callback;
    }),
  }));

  // REC-001 -- bypass the real Redis-backed lease in these unit tests; the
  // job body should run exactly as before regardless of lease outcome.
  jest.doMock("../utils/jobLease", () => ({
    runWithLease: jest.fn(async (_jobName, _ttlMs, fn) => {
      await fn();
      return { ran: true };
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
    expect(harness.reserveMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, reserveReport: true })
    );
  });

  it("14. crash-after-insert recovery: an E11000 replay drives ONE reconciliation using its OWN reservation and never calls abandon()", async () => {
    const recurring = dueRecurring();
    const occurrenceId = occurrenceIdFor(recurring._id, recurring.nextDueDate);

    // Simulates: a PRIOR run's insert committed (the expense exists) but
    const harness = loadCronJob({
      dueExpenses: [recurring],
      createBehavior: { throwOnce: "11000" },
      existingExpenseForDedupe: { userId: USER_ID, id: occurrenceId, _id: "expense-from-run-1" },
    });

    await harness.runCronCallback();

    // 3. Next run encounters the deterministic duplicate.
    expect(harness.createdExpenses).toHaveLength(0);
    // Reservation-ownership correction: abandon() is NEVER called on this
    expect(harness.abandonMock).not.toHaveBeenCalled();
    expect(harness.repairIfPendingMock).not.toHaveBeenCalled();
    // 5. The report is (eventually) synchronized -- via ONE
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
    await expect(harness.runCronCallback()).resolves.not.toThrow();
    expect(harness.createdExpenses).toHaveLength(1);
    expect(harness.findOneAndUpdateMock).toHaveBeenCalledTimes(1);
  });
});
