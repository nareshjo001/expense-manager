// IMP-001 -- Services/ImportServices/importSuggestionService.js.
//
// Same fast in-memory-fake-model pattern
// tests/duplicateCandidateService.test.js uses for Receipt: no real
// Mongoose, a chainable/thenable fake Query (find/lean), and
// config/Schemas mocked directly so the real mongoose Schema constructor
// is never touched.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const MERCHANT_RULE_MODEL_PATH = "../models/MerchantCategoryRule";

const USER_A = "64f1a2b3c4d5e6f7a8b9c0aa";

function leanify(raw) {
  if (raw === null || raw === undefined) return raw;
  if (Array.isArray(raw)) return raw.map((d) => ({ ...d }));
  return { ...raw };
}

function makeQuery(resultGetter) {
  const query = {
    lean() {
      return Promise.resolve(leanify(resultGetter()));
    },
    then(resolve, reject) {
      return Promise.resolve(leanify(resultGetter())).then(resolve, reject);
    },
    catch(reject) {
      return query.then(undefined, reject);
    },
  };
  return query;
}

function buildExpenseStore(seedDocs = []) {
  const state = seedDocs.map((d) => ({ ...d }));
  return {
    state,
    find: jest.fn((filter = {}) =>
      makeQuery(() => state.filter((d) => String(d.userId) === String(filter.userId)))
    ),
  };
}

function buildRuleStore(seedDocs = []) {
  const state = seedDocs.map((d) => ({ ...d }));
  return {
    state,
    find: jest.fn((filter = {}) =>
      makeQuery(() => state.filter((d) => String(d.userId) === String(filter.userId)))
    ),
  };
}

function loadService({ expenses = [], rules = [], failFetch = false } = {}) {
  jest.resetModules();

  const expenseStore = buildExpenseStore(expenses);
  const ruleStore = buildRuleStore(rules);

  if (failFetch) {
    expenseStore.find = jest.fn(() => {
      throw new Error("boom: db unavailable");
    });
  }

  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel: expenseStore }));
  jest.doMock(MERCHANT_RULE_MODEL_PATH, () => ruleStore);

  const service = require("../Services/ImportServices/importSuggestionService");
  return { service, expenseStore, ruleStore };
}

function expenseDoc(overrides = {}) {
  return {
    _id: "e1",
    userId: USER_A,
    id: "e1",
    expenseName: "Cafe Nero",
    expenseCategory: "Food",
    expenseAmount: 12.5,
    expenseDate: new Date("2026-01-10T00:00:00.000Z"),
    createdAt: new Date("2026-01-10T00:00:00.000Z"),
    ...overrides,
  };
}

function ruleDoc(overrides = {}) {
  return {
    _id: "rule1",
    userId: USER_A,
    merchantKey: "cafe nero",
    category: "Food & Drink",
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    expenseName: "Cafe Nero",
    expenseAmount: 12.5,
    expenseDate: "2026-01-10T00:00:00.000Z",
    expenseCategory: null,
    ...overrides,
  };
}

afterEach(() => {
  jest.resetModules();
});

describe("enrichRowsWithSuggestions", () => {
  test("returns [] for an empty mappedRows array without querying anything", async () => {
    const { service, expenseStore, ruleStore } = loadService({});
    const results = await service.enrichRowsWithSuggestions({ userId: USER_A, mappedRows: [] });
    expect(results).toEqual([]);
    expect(expenseStore.find).not.toHaveBeenCalled();
    expect(ruleStore.find).not.toHaveBeenCalled();
  });

  test("a row with a probable duplicate match gets that expense's id", async () => {
    const { service } = loadService({
      expenses: [expenseDoc({ _id: "e1" })],
    });

    const results = await service.enrichRowsWithSuggestions({
      userId: USER_A,
      mappedRows: [row()],
    });

    expect(results).toHaveLength(1);
    expect(results[0].duplicateCandidateExpenseId).toBe("e1");
  });

  test("a row with no matching expense gets a null duplicate candidate", async () => {
    const { service } = loadService({
      expenses: [expenseDoc({ _id: "e1", expenseName: "Starbucks", expenseAmount: 5 })],
    });

    const results = await service.enrichRowsWithSuggestions({
      userId: USER_A,
      mappedRows: [row()],
    });

    expect(results[0].duplicateCandidateExpenseId).toBeNull();
  });

  test("a row missing a required mapped field is skipped entirely (both null, no DB work for it)", async () => {
    const { service, expenseStore, ruleStore } = loadService({
      expenses: [expenseDoc({ _id: "e1" })],
      rules: [ruleDoc()],
    });

    const results = await service.enrichRowsWithSuggestions({
      userId: USER_A,
      mappedRows: [row({ expenseDate: null })],
    });

    expect(results).toEqual([{ duplicateCandidateExpenseId: null, suggestedCategory: null }]);
    // The whole batch has no OTHER eligible row either, so no DB work
    // should have been attempted at all.
    expect(expenseStore.find).not.toHaveBeenCalled();
    expect(ruleStore.find).not.toHaveBeenCalled();
  });

  test("a row with its own category already set never gets a suggestedCategory, even with a matching rule", async () => {
    const { service } = loadService({
      rules: [ruleDoc({ merchantKey: "cafe nero", category: "Food & Drink" })],
    });

    const results = await service.enrichRowsWithSuggestions({
      userId: USER_A,
      mappedRows: [row({ expenseCategory: "Coffee" })],
    });

    expect(results[0].suggestedCategory).toBeNull();
  });

  test("a row with no category and a matching MerchantCategoryRule gets the suggested category", async () => {
    const { service } = loadService({
      rules: [ruleDoc({ merchantKey: "cafe nero", category: "Food & Drink" })],
    });

    const results = await service.enrichRowsWithSuggestions({
      userId: USER_A,
      mappedRows: [row({ expenseName: "  Cafe   Nero ", expenseCategory: null })],
    });

    expect(results[0].suggestedCategory).toBe("Food & Drink");
  });

  test("a row with no matching rule gets a null suggestedCategory", async () => {
    const { service } = loadService({
      rules: [ruleDoc({ merchantKey: "starbucks", category: "Coffee" })],
    });

    const results = await service.enrichRowsWithSuggestions({
      userId: USER_A,
      mappedRows: [row({ expenseName: "Cafe Nero", expenseCategory: null })],
    });

    expect(results[0].suggestedCategory).toBeNull();
  });

  test("multiple matching existing expenses pick the most recently created one deterministically", async () => {
    const { service } = loadService({
      expenses: [
        expenseDoc({ _id: "e-older", createdAt: new Date("2026-01-01T00:00:00.000Z") }),
        expenseDoc({ _id: "e-newer", createdAt: new Date("2026-01-05T00:00:00.000Z") }),
        expenseDoc({ _id: "e-middle", createdAt: new Date("2026-01-03T00:00:00.000Z") }),
      ],
    });

    const results = await service.enrichRowsWithSuggestions({
      userId: USER_A,
      mappedRows: [row()],
    });

    expect(results[0].duplicateCandidateExpenseId).toBe("e-newer");
  });

  test("multiple rows are each resolved independently, same length and order as input", async () => {
    const { service } = loadService({
      expenses: [expenseDoc({ _id: "e1", expenseName: "Cafe Nero", expenseAmount: 12.5 })],
      rules: [ruleDoc({ merchantKey: "starbucks", category: "Coffee" })],
    });

    const results = await service.enrichRowsWithSuggestions({
      userId: USER_A,
      mappedRows: [
        row({ expenseName: "Cafe Nero", expenseAmount: 12.5, expenseCategory: null }),
        row({ expenseName: "Starbucks", expenseAmount: 5, expenseDate: "2026-02-01T00:00:00.000Z", expenseCategory: null }),
        row({ expenseName: null }),
      ],
    });

    expect(results).toHaveLength(3);
    expect(results[0].duplicateCandidateExpenseId).toBe("e1");
    expect(results[1].suggestedCategory).toBe("Coffee");
    expect(results[2]).toEqual({ duplicateCandidateExpenseId: null, suggestedCategory: null });
  });

  test("never throws on a database error -- returns nulls for the whole batch", async () => {
    const { service } = loadService({ failFetch: true });

    const results = await service.enrichRowsWithSuggestions({
      userId: USER_A,
      mappedRows: [row(), row({ expenseName: "Starbucks" })],
    });

    expect(results).toEqual([
      { duplicateCandidateExpenseId: null, suggestedCategory: null },
      { duplicateCandidateExpenseId: null, suggestedCategory: null },
    ]);
  });
});
