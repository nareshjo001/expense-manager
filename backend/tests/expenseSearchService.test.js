// EXP-002-T04 -- expenseSearchService.js. Under test: buildExpenseSearchFilter
// produces the exact AND-combined Mongo filter EXP-002-T01's contract
// defines, and searchExpenses wires it correctly through the existing
// cursor-pagination helpers (utils/pagination.js) without reimplementing
// them -- EXP-002-T01 already confirmed pagination itself needs no
// redesign, so this suite does not re-test pagination's own correctness
// (utils/pagination.test.js and tests/getByCustom.pagination.test.js
// already do).
"use strict";

const { normalizeCategoryForGrouping } = require("../utils/categoryNormalization");
const { buildExpenseSearchFilter, escapeRegExp } = require("../Services/ExpenseServices/expenseSearchService");

const START = new Date("2026-01-01T00:00:00.000Z");
const END = new Date("2026-01-31T23:59:59.999Z");

describe("EXP-002-T04 buildExpenseSearchFilter -- base date-range filter", () => {
  test("with no optional filters, produces exactly userId + expenseDate range", () => {
    const filter = buildExpenseSearchFilter("user-1", { startDate: START, endDate: END });
    expect(filter).toEqual({
      userId: "user-1",
      expenseDate: { $gte: START, $lte: END },
    });
  });
});

describe("EXP-002-T04 buildExpenseSearchFilter -- nameContains", () => {
  test("adds a case-insensitive regex on expenseName", () => {
    const filter = buildExpenseSearchFilter("user-1", { startDate: START, endDate: END, nameContains: "coffee" });
    expect(filter.expenseName).toEqual({ $regex: "coffee", $options: "i" });
  });

  test("escapes regex metacharacters so a malicious pattern is matched literally", () => {
    const filter = buildExpenseSearchFilter("user-1", { startDate: START, endDate: END, nameContains: "a.*b" });
    expect(filter.expenseName.$regex).toBe(escapeRegExp("a.*b"));
    expect(filter.expenseName.$regex).not.toBe("a.*b");
  });

  test("an empty string is treated as no filter, not a match-everything regex", () => {
    const filter = buildExpenseSearchFilter("user-1", { startDate: START, endDate: END, nameContains: "" });
    expect(filter.expenseName).toBeUndefined();
  });
});

describe("EXP-002-T04 buildExpenseSearchFilter -- category", () => {
  test("exact-matches the SAME normalized value the write path already stores", () => {
    const filter = buildExpenseSearchFilter("user-1", { startDate: START, endDate: END, category: "food" });
    expect(filter.expenseCategory).toBe(normalizeCategoryForGrouping("food"));
    expect(filter.expenseCategory).toBe("Food");
  });

  test("a genuinely new/unknown category is preserved (title-cased), not rejected", () => {
    const filter = buildExpenseSearchFilter("user-1", { startDate: START, endDate: END, category: "pet care" });
    expect(filter.expenseCategory).toBe("Pet Care");
  });
});

describe("EXP-002-T04 buildExpenseSearchFilter -- amount range", () => {
  test("minAmount alone produces $gte only", () => {
    const filter = buildExpenseSearchFilter("user-1", { startDate: START, endDate: END, minAmount: 10 });
    expect(filter.expenseAmount).toEqual({ $gte: 10 });
  });

  test("maxAmount alone produces $lte only", () => {
    const filter = buildExpenseSearchFilter("user-1", { startDate: START, endDate: END, maxAmount: 100 });
    expect(filter.expenseAmount).toEqual({ $lte: 100 });
  });

  test("both together combine into one range on the authoritative expenseAmount field", () => {
    const filter = buildExpenseSearchFilter("user-1", { startDate: START, endDate: END, minAmount: 10, maxAmount: 100 });
    expect(filter.expenseAmount).toEqual({ $gte: 10, $lte: 100 });
    // Never the flag-gated shadow field -- EXP-002-T01 explicitly ruled
    // this out.
    expect(filter.expenseAmountMinor).toBeUndefined();
  });
});

describe("EXP-002-T04 buildExpenseSearchFilter -- isRecurring", () => {
  test("true and false are both real filters, not treated as absent", () => {
    expect(buildExpenseSearchFilter("user-1", { startDate: START, endDate: END, isRecurring: true }).isRecurring).toBe(true);
    expect(buildExpenseSearchFilter("user-1", { startDate: START, endDate: END, isRecurring: false }).isRecurring).toBe(false);
  });

  test("omitted means no filter at all, not false", () => {
    const filter = buildExpenseSearchFilter("user-1", { startDate: START, endDate: END });
    expect(filter.isRecurring).toBeUndefined();
    expect("isRecurring" in filter).toBe(false);
  });
});

describe("EXP-002-T04 buildExpenseSearchFilter -- AND-only combination (EXP-002-T01's contract)", () => {
  test("every filter present at once combines into a single AND-implicit object, none overriding another", () => {
    const filter = buildExpenseSearchFilter("user-1", {
      startDate: START,
      endDate: END,
      nameContains: "coffee",
      category: "food",
      minAmount: 5,
      maxAmount: 50,
      isRecurring: true,
    });
    expect(filter).toEqual({
      userId: "user-1",
      expenseDate: { $gte: START, $lte: END },
      expenseName: { $regex: "coffee", $options: "i" },
      expenseCategory: "Food",
      expenseAmount: { $gte: 5, $lte: 50 },
      isRecurring: true,
    });
  });
});

describe("EXP-002-T04 searchExpenses -- wiring through to ExpenseModel and pagination", () => {
  const SCHEMAS_PATH = "../config/Schemas";

  function loadServiceWithFakeModel(docs) {
    jest.resetModules();
    const capturedFilters = [];
    const ExpenseModel = {
      find: jest.fn((filter) => {
        capturedFilters.push(filter);
        const chain = {
          sort: () => chain,
          limit: (n) => {
            chain._limited = docs.slice(0, n);
            return chain;
          },
          lean: async () => chain._limited || docs,
        };
        return chain;
      }),
    };
    jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel }));
    const service = require("../Services/ExpenseServices/expenseSearchService");
    return { ...service, ExpenseModel, capturedFilters };
  }

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test("passes the built filter straight into ExpenseModel.find, merged with the cursor filter", async () => {
    const { searchExpenses, capturedFilters } = loadServiceWithFakeModel([]);

    await searchExpenses("user-1", { startDate: START, endDate: END, category: "food" }, 10, null);

    expect(capturedFilters).toHaveLength(1);
    expect(capturedFilters[0]).toMatchObject({
      userId: "user-1",
      expenseCategory: "Food",
      expenseDate: { $gte: START, $lte: END },
    });
  });

  test("requests limit + 1 documents (the existing hasMore-detection convention)", async () => {
    const { searchExpenses, ExpenseModel } = loadServiceWithFakeModel([{ _id: "e1" }]);
    const limitSpy = jest.fn(() => ({ lean: async () => [{ _id: "e1" }] }));
    ExpenseModel.find.mockReturnValue({ sort: () => ({ limit: limitSpy }) });

    await searchExpenses("user-1", { startDate: START, endDate: END }, 10, null);

    expect(limitSpy).toHaveBeenCalledWith(11);
  });
});
