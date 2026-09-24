// REC-002-T03/T06 -- cron/recurringJob.js: lifecycle-aware query filtering
// (status: 'active' only) and endDate auto-end.
//
// Same fast, fully-mocked-model pattern as
// tests/recurringJob.categoryNormalization.test.js (that file's header
// explains why: no app.js, no real mongoose, no real timers).
"use strict";

const RECURRING_EXPENSE_PATH = "../models/RecurringExpense";
const SCHEMAS_PATH = "../config/Schemas";
const NOTIFICATION_PATH = "../models/Notification";
const PUSH_SERVICE_PATH = "../Services/push.service";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const CRON_JOB_PATH = "../cron/recurringJob";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const TEST_BUDGET_TOKEN = "test-budget-reservation-token";
const TEST_REPORT_TOKEN = "test-report-reservation-token";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadCronJob({ dueExpenses }) {
  jest.resetModules();

  let capturedCallback = null;
  jest.doMock("node-cron", () => ({
    schedule: jest.fn((_expr, callback) => {
      capturedCallback = callback;
    }),
  }));

  jest.doMock("../utils/jobLease", () => ({
    runWithLease: jest.fn(async (_jobName, _ttlMs, fn) => {
      await fn();
      return { ran: true };
    }),
  }));

  const findMock = jest.fn(() => ({
    lean: jest.fn().mockResolvedValue(dueExpenses),
  }));
  const findOneAndUpdateMock = jest.fn().mockResolvedValue({ _id: "updated" });

  jest.doMock(RECURRING_EXPENSE_PATH, () => ({
    RecurringExpenseModel: {
      find: findMock,
      findOneAndUpdate: findOneAndUpdateMock,
    },
  }));

  const createdExpenses = [];
  const ExpenseModelMock = {
    create: jest.fn(async (doc) => {
      const created = { ...doc, _id: `expense-${createdExpenses.length + 1}` };
      createdExpenses.push(created);
      return created;
    }),
  };
  const noPendingDeletionUserModel = {
    find: jest.fn(() => ({
      select: jest.fn(function select() {
        return this;
      }),
      lean: jest.fn(async () => []),
    })),
  };
  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel: ExpenseModelMock, UserModel: noPendingDeletionUserModel }));

  const notificationCreateMock = jest.fn().mockResolvedValue({ _id: "notif-1", title: "t" });
  const notificationUpdateOneMock = jest.fn().mockResolvedValue({});
  jest.doMock(NOTIFICATION_PATH, () => ({
    create: notificationCreateMock,
    updateOne: notificationUpdateOneMock,
  }));

  const sendPushMock = jest.fn().mockResolvedValue({ success: true });
  jest.doMock(PUSH_SERVICE_PATH, () => ({
    sendPush: sendPushMock,
  }));

  jest.doMock(EXPENSE_CACHE_PATH, () => ({
    clearUserExpenseCache: jest.fn().mockResolvedValue(undefined),
  }));

  const reserveMock = jest.fn(async ({ budgetDates = [], reserveReport = false } = {}) => ({
    budgetReservations: budgetDates.map(() => ({ token: TEST_BUDGET_TOKEN, reservedAt: new Date() })),
    reportReservation: reserveReport ? { token: TEST_REPORT_TOKEN, reservedAt: new Date() } : null,
    userWideReservation: null,
  }));
  const abandonMock = jest.fn().mockResolvedValue(null);
  const synchronizeAfterMutationMock = jest.fn().mockResolvedValue({
    status: "synchronized",
    budget: "synchronized",
    report: "synchronized",
    recoveryPending: false,
  });
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    reserve: reserveMock,
    abandon: abandonMock,
    synchronizeAfterMutation: synchronizeAfterMutationMock,
  }));

  require(CRON_JOB_PATH);

  return {
    runCronCallback: async () => capturedCallback(),
    createdExpenses,
    findMock,
    findOneAndUpdateMock,
    notificationCreateMock,
    notificationUpdateOneMock,
    sendPushMock,
    reserveMock,
    synchronizeAfterMutationMock,
  };
}

const dueRecurring = (overrides = {}) => ({
  _id: "recurring-1",
  userId: USER_ID,
  expenseName: "Netflix",
  expenseCategory: "Entertainment",
  expenseAmount: 500,
  nextDueDate: new Date("2026-08-01T00:00:00.000Z"),
  endDate: null,
  ...overrides,
});

describe("recurringJob: status filtering (REC-002-T03)", () => {
  it("queries only status: 'active' definitions -- paused/ended are excluded at the query, not skipped per-item", async () => {
    const { runCronCallback, findMock } = loadCronJob({ dueExpenses: [] });

    await runCronCallback();

    expect(findMock).toHaveBeenCalledTimes(1);
    const [filter] = findMock.mock.calls[0];
    expect(filter.status).toBe("active");
    expect(filter.nextDueDate).toEqual({ $lte: expect.any(Date) });
  });
});

describe("recurringJob: endDate auto-end (REC-002-T03/T06)", () => {
  it("auto-ends a definition whose nextDueDate has passed its endDate, without logging an expense", async () => {
    const recurring = dueRecurring({
      nextDueDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-08-15T00:00:00.000Z"), // already behind nextDueDate
    });
    const {
      runCronCallback,
      createdExpenses,
      findOneAndUpdateMock,
      notificationCreateMock,
      sendPushMock,
      reserveMock,
      synchronizeAfterMutationMock,
    } = loadCronJob({ dueExpenses: [recurring] });

    await runCronCallback();

    expect(createdExpenses).toHaveLength(0);
    expect(reserveMock).not.toHaveBeenCalled();
    expect(synchronizeAfterMutationMock).not.toHaveBeenCalled();

    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { _id: "recurring-1", status: "active" },
      { $set: { status: "ended", endedAt: expect.any(Date) } }
    );

    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        type: "recurring-expense-ended",
      })
    );
    expect(sendPushMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT increment scheduleVersion on auto-end -- only status/endedAt are set", async () => {
    const recurring = dueRecurring({
      nextDueDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-08-15T00:00:00.000Z"),
    });
    const { runCronCallback, findOneAndUpdateMock } = loadCronJob({ dueExpenses: [recurring] });

    await runCronCallback();

    const [, update] = findOneAndUpdateMock.mock.calls[0];
    expect(update.$inc).toBeUndefined();
  });

  it("still logs the occurrence normally when nextDueDate has not yet passed endDate", async () => {
    const recurring = dueRecurring({
      nextDueDate: new Date("2026-08-01T00:00:00.000Z"),
      endDate: new Date("2026-12-31T00:00:00.000Z"),
    });
    const { runCronCallback, createdExpenses, notificationCreateMock } = loadCronJob({ dueExpenses: [recurring] });

    await runCronCallback();

    expect(createdExpenses).toHaveLength(1);
    // Only the normal "expense logged" notification fires, not the
    // ended-schedule one.
    expect(notificationCreateMock).toHaveBeenCalledTimes(1);
    expect(notificationCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: "recurring-expense" })
    );
  });

  it("still logs normally when endDate is not set at all", async () => {
    const recurring = dueRecurring({ endDate: null });
    const { runCronCallback, createdExpenses } = loadCronJob({ dueExpenses: [recurring] });

    await runCronCallback();

    expect(createdExpenses).toHaveLength(1);
  });

  it("processes a mixed batch correctly: one auto-ends, one logs normally", async () => {
    const endingOne = dueRecurring({
      _id: "recurring-ending",
      nextDueDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-08-15T00:00:00.000Z"),
    });
    const normalOne = dueRecurring({
      _id: "recurring-normal",
      nextDueDate: new Date("2026-08-01T00:00:00.000Z"),
      endDate: null,
    });
    const { runCronCallback, createdExpenses, findOneAndUpdateMock } = loadCronJob({
      dueExpenses: [endingOne, normalOne],
    });

    await runCronCallback();

    expect(createdExpenses).toHaveLength(1);
    expect(createdExpenses[0].userId).toBe(USER_ID);

    // One call ends recurring-ending; another advances recurring-normal's
    // schedule -- both go through findOneAndUpdate but with different shapes.
    const endingCall = findOneAndUpdateMock.mock.calls.find(
      ([filter]) => filter._id === "recurring-ending"
    );
    expect(endingCall[1]).toEqual({ $set: { status: "ended", endedAt: expect.any(Date) } });
  });

  it("skips notifying when the auto-end CAS finds nothing to update (already ended concurrently)", async () => {
    const recurring = dueRecurring({
      nextDueDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-08-15T00:00:00.000Z"),
    });

    jest.resetModules();
    let capturedCallback = null;
    jest.doMock("node-cron", () => ({
      schedule: jest.fn((_expr, cb) => {
        capturedCallback = cb;
      }),
    }));
    jest.doMock("../utils/jobLease", () => ({
      runWithLease: jest.fn(async (_n, _t, fn) => {
        await fn();
      }),
    }));
    jest.doMock(RECURRING_EXPENSE_PATH, () => ({
      RecurringExpenseModel: {
        find: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([recurring]) })),
        findOneAndUpdate: jest.fn().mockResolvedValue(null),
      },
    }));
    jest.doMock(SCHEMAS_PATH, () => ({
      ExpenseModel: { create: jest.fn() },
      UserModel: { find: jest.fn(() => ({ select: function () { return this; }, lean: async () => [] })) },
    }));
    const localNotificationCreate = jest.fn().mockResolvedValue({ _id: "n" });
    jest.doMock(NOTIFICATION_PATH, () => ({ create: localNotificationCreate, updateOne: jest.fn() }));
    const localSendPush = jest.fn().mockResolvedValue({ success: true });
    jest.doMock(PUSH_SERVICE_PATH, () => ({ sendPush: localSendPush }));
    jest.doMock(EXPENSE_CACHE_PATH, () => ({ clearUserExpenseCache: jest.fn() }));
    jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
      reserve: jest.fn(),
      abandon: jest.fn(),
      synchronizeAfterMutation: jest.fn(),
    }));

    require(CRON_JOB_PATH);
    await capturedCallback();

    expect(localNotificationCreate).not.toHaveBeenCalled();
    expect(localSendPush).not.toHaveBeenCalled();
  });
});
