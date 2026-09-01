// BALENISA Final Recurring Authority Closure for Analytics.
"use strict";

const DATA_PROVIDER_PATH = "../analytics/dataProvider";
const RECURRING_MODEL_PATH = "../models/RecurringExpense";

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadAnalyticsContext({ collections, definitions }) {
  jest.resetModules();

  const findCalls = [];
  const RecurringExpenseModelMock = {
    find: (filter) => {
      findCalls.push(filter);
      return {
        lean: async () => {
          const ids = new Set((filter.expenseId.$in || []).map(String));
          return definitions.filter(
            (d) => String(d.userId) === String(filter.userId) && ids.has(String(d.expenseId))
          );
        },
      };
    },
  };
  jest.doMock(RECURRING_MODEL_PATH, () => ({ RecurringExpenseModel: RecurringExpenseModelMock }));

  jest.doMock(DATA_PROVIDER_PATH, () => ({
    getCurrentMonthExpenses: async () => collections.currentMonth,
    getPreviousMonthExpenses: async () => collections.previousMonth,
    getCurrentYearExpenses: async () => collections.currentYear,
    getPreviousYearExpenses: async () => collections.previousYear,
    getAllBudgets: async () => [],
  }));

  const { createAnalyticsContext } = require("../analytics/analyticsContext");
  return { createAnalyticsContext, findCalls };
}

// exp-1 appears in BOTH currentMonth and currentYear as separate object
// instances (same _id) -- exactly the real-world overlap this fix targets.
const exp1CurrentMonth = {
  _id: "exp-1",
  isRecurring: false, // stale mirror -- definition exists below
  expenseName: "Gym",
  expenseAmount: 40,
  expenseCategory: "Health",
  expenseDate: new Date("2026-08-05T00:00:00.000Z"),
};
const exp1CurrentYear = { ...exp1CurrentMonth }; // distinct object, same _id

const exp2PreviousMonth = {
  _id: "exp-2",
  isRecurring: true, // stale mirror -- no definition exists
  expenseName: "One-off dinner",
  expenseAmount: 55,
  expenseCategory: "Food",
  expenseDate: new Date("2026-07-10T00:00:00.000Z"),
};

const exp3CurrentYear = {
  _id: "exp-3",
  isRecurring: false, // stale mirror -- definition exists below
  expenseName: "Streaming",
  expenseAmount: 15,
  expenseCategory: "Entertainment",
  expenseDate: new Date("2026-03-01T00:00:00.000Z"),
};

const exp4PreviousYear = {
  _id: "exp-4",
  isRecurring: true, // stale mirror -- no definition exists
  expenseName: "Old subscription",
  expenseAmount: 9,
  expenseCategory: "Entertainment",
  expenseDate: new Date("2025-11-01T00:00:00.000Z"),
};

const collections = {
  currentMonth: [exp1CurrentMonth],
  previousMonth: [exp2PreviousMonth],
  currentYear: [exp1CurrentYear, exp3CurrentYear],
  previousYear: [exp4PreviousYear],
};

const definitions = [
  { userId: USER_ID, expenseId: "exp-1" },
  { userId: USER_ID, expenseId: "exp-3" },
];

describe("analyticsContext -- recurring-state authority closure", () => {
  it("1. stale mirror false + definition present -> delivered to analyzers as true", async () => {
    const { createAnalyticsContext } = loadAnalyticsContext({ collections, definitions });
    const ctx = await createAnalyticsContext(USER_ID);

    expect(ctx.currentMonthExpenses[0].isRecurring).toBe(true);
    expect(ctx.currentYearExpenses.find((e) => e._id === "exp-1").isRecurring).toBe(true);
    expect(ctx.currentYearExpenses.find((e) => e._id === "exp-3").isRecurring).toBe(true);
  });

  it("2. stale mirror true + definition absent -> delivered to analyzers as false", async () => {
    const { createAnalyticsContext } = loadAnalyticsContext({ collections, definitions });
    const ctx = await createAnalyticsContext(USER_ID);

    expect(ctx.previousMonthExpenses[0].isRecurring).toBe(false);
    expect(ctx.previousYearExpenses[0].isRecurring).toBe(false);
  });

  it("3. all four overlapping collections are annotated through exactly ONE batched query, never one per collection", async () => {
    const { createAnalyticsContext, findCalls } = loadAnalyticsContext({ collections, definitions });
    await createAnalyticsContext(USER_ID);

    expect(findCalls.length).toBe(1);
  });

  it("4. when every collection is empty, zero recurring-definition queries are issued", async () => {
    const { createAnalyticsContext, findCalls } = loadAnalyticsContext({
      collections: { currentMonth: [], previousMonth: [], currentYear: [], previousYear: [] },
      definitions: [],
    });
    const ctx = await createAnalyticsContext(USER_ID);

    expect(findCalls.length).toBe(0);
    expect(ctx.currentMonthExpenses).toEqual([]);
    expect(ctx.previousMonthExpenses).toEqual([]);
    expect(ctx.currentYearExpenses).toEqual([]);
    expect(ctx.previousYearExpenses).toEqual([]);
  });

  it("5. another user's recurring definition cannot mark the current user's expense recurring", async () => {
    const { createAnalyticsContext } = loadAnalyticsContext({
      collections,
      definitions: [{ userId: OTHER_USER_ID, expenseId: "exp-1" }],
    });
    const ctx = await createAnalyticsContext(USER_ID);

    // exp-1's definition belongs to a different user -- for USER_ID it must
    expect(ctx.currentMonthExpenses[0].isRecurring).toBe(false);
  });

  it("6. dates, amounts, categories, names, and ids are preserved unchanged -- only isRecurring is touched", async () => {
    const { createAnalyticsContext } = loadAnalyticsContext({ collections, definitions });
    const ctx = await createAnalyticsContext(USER_ID);

    const annotatedExp1 = ctx.currentMonthExpenses[0];
    expect(annotatedExp1._id).toBe("exp-1");
    expect(annotatedExp1.expenseName).toBe("Gym");
    expect(annotatedExp1.expenseAmount).toBe(40);
    expect(annotatedExp1.expenseCategory).toBe("Health");
    expect(annotatedExp1.expenseDate).toEqual(new Date("2026-08-05T00:00:00.000Z"));
    expect(annotatedExp1.expenseDate instanceof Date).toBe(true);

    const annotatedExp4 = ctx.previousYearExpenses[0];
    expect(annotatedExp4.expenseName).toBe("Old subscription");
    expect(annotatedExp4.expenseAmount).toBe(9);
    expect(annotatedExp4.expenseDate).toEqual(new Date("2025-11-01T00:00:00.000Z"));
  });

  it("7. habitAnalyzer.analyze receives the corrected values unchanged -- the analyzer itself needs no modification", async () => {
    const { createAnalyticsContext } = loadAnalyticsContext({ collections, definitions });
    const ctx = await createAnalyticsContext(USER_ID);

    const habitAnalyzer = require("../analytics/analyzers/habitAnalyzer");
    const habitRules = require("../analytics/analyzers/scores/habitRules");

    // habitAnalyzer.js is unmodified by this change; it still does nothing
    const monthlyHabitReport = habitAnalyzer.analyze(ctx.currentMonthExpenses, habitRules.habits);
    expect(monthlyHabitReport).toBeDefined();

    const recurringCount = ctx.currentMonthExpenses.filter((e) => e.isRecurring).length;
    expect(recurringCount).toBe(1); // exp-1, corrected from stale false
  });

  it("preserves array length and relative order within each collection after slicing the combined annotation back apart", async () => {
    const { createAnalyticsContext } = loadAnalyticsContext({ collections, definitions });
    const ctx = await createAnalyticsContext(USER_ID);

    expect(ctx.currentYearExpenses.map((e) => e._id)).toEqual(["exp-1", "exp-3"]);
    expect(ctx.currentMonthExpenses.map((e) => e._id)).toEqual(["exp-1"]);
    expect(ctx.previousMonthExpenses.map((e) => e._id)).toEqual(["exp-2"]);
    expect(ctx.previousYearExpenses.map((e) => e._id)).toEqual(["exp-4"]);
  });
});
