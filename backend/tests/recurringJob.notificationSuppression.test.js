// NOT-003-T03/T04/T07 -- cron/recurringJob.js's handling of a
// sendPush() result that comes back `suppressed` (a NOT-003
// preference-disabled type or active quiet hours) rather than a genuine
// delivery failure. Same fast, fully-mocked-model pattern as
// recurringJob.lifecycle.test.js (that file's header explains why).
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

function loadCronJob({ dueExpenses, sendPushImpl }) {
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

  let notifCounter = 0;
  const notificationCreateMock = jest.fn(async (doc) => {
    notifCounter += 1;
    return { _id: `notif-${notifCounter}`, ...doc };
  });
  const notificationUpdateOneMock = jest.fn().mockResolvedValue({});
  jest.doMock(NOTIFICATION_PATH, () => ({
    create: notificationCreateMock,
    updateOne: notificationUpdateOneMock,
  }));

  const sendPushMock = jest.fn(sendPushImpl || (async () => ({ success: true })));
  jest.doMock(PUSH_SERVICE_PATH, () => ({ sendPush: sendPushMock }));

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
    notificationCreateMock,
    notificationUpdateOneMock,
    sendPushMock,
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

describe("recurringJob: suppressed push on the normal occurrence-logged path", () => {
  it("marks pushStatus 'suppressed' (not 'failed') and does not schedule a retry", async () => {
    const { runCronCallback, notificationUpdateOneMock, sendPushMock } = loadCronJob({
      dueExpenses: [dueRecurring()],
      sendPushImpl: async () => ({ success: false, suppressed: true, reason: "type_disabled" }),
    });

    await runCronCallback();

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      { type: "recurring-expense" }
    );
    expect(notificationUpdateOneMock).toHaveBeenCalledWith(
      { _id: "notif-1" },
      { pushStatus: "suppressed" }
    );
  });

  it("a genuine (non-suppressed) failure still gets the original failed+retry treatment", async () => {
    const { runCronCallback, notificationUpdateOneMock } = loadCronJob({
      dueExpenses: [dueRecurring()],
      sendPushImpl: async () => ({ success: false }),
    });

    await runCronCallback();

    expect(notificationUpdateOneMock).toHaveBeenCalledWith(
      { _id: "notif-1" },
      expect.objectContaining({ pushStatus: "failed", retryCount: 1, nextRetryAt: expect.any(Date) })
    );
  });
});

describe("recurringJob: suppressed push on the auto-end notification path", () => {
  it("marks the ended-notification pushStatus 'suppressed' when quiet hours are active", async () => {
    const recurring = dueRecurring({
      nextDueDate: new Date("2026-09-01T00:00:00.000Z"),
      endDate: new Date("2026-08-15T00:00:00.000Z"),
    });
    const { runCronCallback, notificationUpdateOneMock, sendPushMock } = loadCronJob({
      dueExpenses: [recurring],
      sendPushImpl: async () => ({ success: false, suppressed: true, reason: "quiet_hours" }),
    });

    await runCronCallback();

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      { type: "recurring-expense-ended" }
    );
    expect(notificationUpdateOneMock).toHaveBeenCalledWith(
      { _id: "notif-1" },
      { pushStatus: "suppressed" }
    );
  });
});
