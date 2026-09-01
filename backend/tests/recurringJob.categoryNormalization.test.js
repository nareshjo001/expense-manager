// Category Normalization -- single implementation pass, required test
"use strict";

const RECURRING_EXPENSE_PATH = "../models/RecurringExpense";
const SCHEMAS_PATH = "../config/Schemas";
const NOTIFICATION_PATH = "../models/Notification";
const PUSH_SERVICE_PATH = "../Services/push.service";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const CRON_JOB_PATH = "../cron/recurringJob";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

// Deterministic tokens returned by the mocked reserve() below, asserted
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

  jest.doMock(RECURRING_EXPENSE_PATH, () => ({
    RecurringExpenseModel: {
      find: jest.fn(() => ({
        lean: jest.fn().mockResolvedValue(dueExpenses),
      })),
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: "updated" }),
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
  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel: ExpenseModelMock }));

  jest.doMock(NOTIFICATION_PATH, () => ({
    create: jest.fn().mockResolvedValue({ _id: "notif-1", title: "t" }),
    updateOne: jest.fn().mockResolvedValue({}),
  }));

  jest.doMock(PUSH_SERVICE_PATH, () => ({
    sendPush: jest.fn().mockResolvedValue({ success: true }),
  }));

  jest.doMock(EXPENSE_CACHE_PATH, () => ({
    clearUserExpenseCache: jest.fn().mockResolvedValue(undefined),
  }));

  // Mocks the public syncRecoveryService boundary itself -- recurringJob.js
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
    reserveMock,
    abandonMock,
    synchronizeAfterMutationMock,
  };
}

const dueRecurring = (overrides = {}) => ({
  _id: "recurring-1",
  userId: USER_ID,
  expenseName: "Netflix",
  expenseAmount: 500,
  nextDueDate: new Date("2026-08-01T00:00:00.000Z"),
  ...overrides,
});

// Shared post-conditions every successful scenario below must satisfy,
function expectSuccessfulSyncFlow({ createdExpenses, reserveMock, abandonMock, synchronizeAfterMutationMock }) {
  expect(reserveMock).toHaveBeenCalledTimes(1);
  expect(reserveMock).toHaveBeenCalledWith({
    userId: USER_ID,
    budgetDates: [expect.any(Date)],
    reserveReport: true,
  });

  expect(synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
  expect(synchronizeAfterMutationMock).toHaveBeenCalledWith({
    userId: USER_ID,
    budgetDates: [createdExpenses[0].expenseDate],
    budgetTokens: [TEST_BUDGET_TOKEN],
    reportToken: TEST_REPORT_TOKEN,
  });

  expect(abandonMock).not.toHaveBeenCalled();
}

describe("Category Normalization: recurringJob cron auto-logger (#16)", () => {
  it("normalizes a case/whitespace/alias-variant recurring category to its canonical value before logging", async () => {
    const { runCronCallback, createdExpenses, reserveMock, abandonMock, synchronizeAfterMutationMock } =
      loadCronJob({
        dueExpenses: [dueRecurring({ expenseCategory: "  medical  " })],
      });

    await runCronCallback();

    expect(createdExpenses).toHaveLength(1);
    expect(createdExpenses[0].expenseCategory).toBe("Health");
    expectSuccessfulSyncFlow({ createdExpenses, reserveMock, abandonMock, synchronizeAfterMutationMock });
  });

  it("passes through an already-canonical category unchanged", async () => {
    const { runCronCallback, createdExpenses, reserveMock, abandonMock, synchronizeAfterMutationMock } =
      loadCronJob({
        dueExpenses: [dueRecurring({ expenseCategory: "Entertainment" })],
      });

    await runCronCallback();

    expect(createdExpenses).toHaveLength(1);
    expect(createdExpenses[0].expenseCategory).toBe("Entertainment");
    expectSuccessfulSyncFlow({ createdExpenses, reserveMock, abandonMock, synchronizeAfterMutationMock });
  });

  it("falls back to the explicit Uncategorized marker (never throws, never skips logging) for a missing/invalid stored category", async () => {
    const { runCronCallback, createdExpenses, reserveMock, abandonMock, synchronizeAfterMutationMock } =
      loadCronJob({
        dueExpenses: [dueRecurring({ expenseCategory: "" })],
      });

    await expect(runCronCallback()).resolves.not.toThrow();
    expect(createdExpenses).toHaveLength(1);
    expect(createdExpenses[0].expenseCategory).toBe("Uncategorized");
    expectSuccessfulSyncFlow({ createdExpenses, reserveMock, abandonMock, synchronizeAfterMutationMock });
  });
});
