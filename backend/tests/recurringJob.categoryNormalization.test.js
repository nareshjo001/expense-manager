// Category Normalization -- single implementation pass, required test
// scenario #16 ("cron-created recurring expenses normalized").
//
// backend/cron/recurringJob.js constructs a brand-new ExpenseModel document
// DIRECTLY inside its node-cron callback, entirely bypassing
// Controllers/ExpenseControllers/addexpense.js and its normalization. This
// test proves the defensive, independent normalizeCategory() call added at
// that exact write site (see recurringJob.js's own doc comment) actually
// takes effect: a due RecurringExpense whose stored category is a
// case/whitespace/alias variant is normalized to its canonical form before
// the auto-logged Expense document is created, and a RecurringExpense with
// a missing/invalid category never blocks the auto-logger -- it falls back
// to the explicit "Uncategorized" marker instead.
//
// node-cron is mocked so `cron.schedule(...)`'s callback is captured rather
// than actually scheduled -- this test invokes that captured callback
// directly and deterministically, never waiting on a real cron tick.
"use strict";

const RECURRING_EXPENSE_PATH = "../models/RecurringExpense";
const SCHEMAS_PATH = "../config/Schemas";
const NOTIFICATION_PATH = "../models/Notification";
const PUSH_SERVICE_PATH = "../Services/push.service";
const BUDGET_SERVICE_PATH = "../Services/BudgetServices/budget.service";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const REPORT_SERVICE_PATH = "../Services/reportService";
const CRON_JOB_PATH = "../cron/recurringJob";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

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

  jest.doMock(BUDGET_SERVICE_PATH, () => ({
    recalculateBudget: jest.fn().mockResolvedValue(undefined),
  }));

  jest.doMock(EXPENSE_CACHE_PATH, () => ({
    clearUserExpenseCache: jest.fn().mockResolvedValue(undefined),
  }));

  jest.doMock(REPORT_SERVICE_PATH, () => ({
    refreshReport: jest.fn().mockResolvedValue(undefined),
  }));

  require(CRON_JOB_PATH);

  return {
    runCronCallback: async () => capturedCallback(),
    createdExpenses,
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

describe("Category Normalization: recurringJob cron auto-logger (#16)", () => {
  it("normalizes a case/whitespace/alias-variant recurring category to its canonical value before logging", async () => {
    const { runCronCallback, createdExpenses } = loadCronJob({
      dueExpenses: [dueRecurring({ expenseCategory: "  medical  " })],
    });

    await runCronCallback();

    expect(createdExpenses).toHaveLength(1);
    expect(createdExpenses[0].expenseCategory).toBe("Health");
  });

  it("passes through an already-canonical category unchanged", async () => {
    const { runCronCallback, createdExpenses } = loadCronJob({
      dueExpenses: [dueRecurring({ expenseCategory: "Entertainment" })],
    });

    await runCronCallback();

    expect(createdExpenses).toHaveLength(1);
    expect(createdExpenses[0].expenseCategory).toBe("Entertainment");
  });

  it("falls back to the explicit Uncategorized marker (never throws, never skips logging) for a missing/invalid stored category", async () => {
    const { runCronCallback, createdExpenses } = loadCronJob({
      dueExpenses: [dueRecurring({ expenseCategory: "" })],
    });

    await expect(runCronCallback()).resolves.not.toThrow();
    expect(createdExpenses).toHaveLength(1);
    expect(createdExpenses[0].expenseCategory).toBe("Uncategorized");
  });
});
