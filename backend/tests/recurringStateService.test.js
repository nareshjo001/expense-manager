// Recurring-state authority remediation -- unit coverage for
// Services/RecurringServices/recurringStateService.js, the single
// centralized helper that overwrites isRecurring on returned expense
// objects using RecurringExpenseModel existence (never the possibly-stale
// stored mirror). Mocks only models/RecurringExpense.js, with a stateful
// fake that records every query issued so batching (never N+1) can be
// asserted directly.
"use strict";

const RECURRING_MODEL_PATH = "../models/RecurringExpense";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const USER_ID = "user-1";
const OTHER_USER_ID = "user-2";

function loadService(definitions) {
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

  const { annotateRecurringState } = require("../Services/RecurringServices/recurringStateService");
  return { annotateRecurringState, findCalls };
}

describe("annotateRecurringState", () => {
  it("1. stored mirror false + definition present -> isRecurring:true", async () => {
    const { annotateRecurringState } = loadService([{ userId: USER_ID, expenseId: "exp-1" }]);
    const result = await annotateRecurringState(USER_ID, { _id: "exp-1", isRecurring: false, expenseName: "Gym" });
    expect(result.isRecurring).toBe(true);
  });

  it("2. stored mirror true + definition absent -> isRecurring:false", async () => {
    const { annotateRecurringState } = loadService([]);
    const result = await annotateRecurringState(USER_ID, { _id: "exp-1", isRecurring: true, expenseName: "Gym" });
    expect(result.isRecurring).toBe(false);
  });

  it("3. correctly synchronized values remain unchanged", async () => {
    const { annotateRecurringState } = loadService([{ userId: USER_ID, expenseId: "exp-1" }]);
    const alreadyTrue = await annotateRecurringState(USER_ID, { _id: "exp-1", isRecurring: true });
    expect(alreadyTrue.isRecurring).toBe(true);

    const { annotateRecurringState: annotate2 } = loadService([]);
    const alreadyFalse = await annotate2(USER_ID, { _id: "exp-2", isRecurring: false });
    expect(alreadyFalse.isRecurring).toBe(false);
  });

  it("4. a mixed collection is annotated correctly, entry by entry", async () => {
    const { annotateRecurringState } = loadService([{ userId: USER_ID, expenseId: "exp-1" }]);
    const results = await annotateRecurringState(USER_ID, [
      { _id: "exp-1", isRecurring: false }, // should become true
      { _id: "exp-2", isRecurring: true }, // should become false
      { _id: "exp-3", isRecurring: false }, // stays false
    ]);
    expect(results.map((r) => r.isRecurring)).toEqual([true, false, false]);
  });

  it("5. another user's definition cannot affect the current user's expense", async () => {
    const { annotateRecurringState } = loadService([{ userId: OTHER_USER_ID, expenseId: "exp-1" }]);
    const result = await annotateRecurringState(USER_ID, { _id: "exp-1", isRecurring: false });
    expect(result.isRecurring).toBe(false);
  });

  it("6/7. an empty expense list avoids the recurring query entirely, and a non-empty collection issues exactly one batched query", async () => {
    const { annotateRecurringState, findCalls } = loadService([]);
    const emptyResult = await annotateRecurringState(USER_ID, []);
    expect(emptyResult).toEqual([]);
    expect(findCalls.length).toBe(0);

    const { annotateRecurringState: annotate2, findCalls: findCalls2 } = loadService([
      { userId: USER_ID, expenseId: "exp-1" },
    ]);
    await annotate2(USER_ID, [
      { _id: "exp-1", isRecurring: false },
      { _id: "exp-2", isRecurring: false },
      { _id: "exp-3", isRecurring: false },
    ]);
    // One query total for the whole collection, never one per expense.
    expect(findCalls2.length).toBe(1);
  });

  it("8. all unrelated expense fields remain unchanged", async () => {
    const { annotateRecurringState } = loadService([{ userId: USER_ID, expenseId: "exp-1" }]);
    const input = { _id: "exp-1", isRecurring: false, expenseName: "Gym", expenseAmount: 40, expenseCategory: "Health" };
    const result = await annotateRecurringState(USER_ID, input);
    expect(result).toMatchObject({
      expenseName: "Gym",
      expenseAmount: 40,
      expenseCategory: "Health",
    });
  });

  it("single-object input returns a single object, not an array", async () => {
    const { annotateRecurringState } = loadService([]);
    const result = await annotateRecurringState(USER_ID, { _id: "exp-1", isRecurring: false });
    expect(Array.isArray(result)).toBe(false);
  });

  it("gracefully no-ops on null/undefined single input", async () => {
    const { annotateRecurringState } = loadService([]);
    expect(await annotateRecurringState(USER_ID, null)).toBeNull();
    expect(await annotateRecurringState(USER_ID, undefined)).toBeUndefined();
  });
});
