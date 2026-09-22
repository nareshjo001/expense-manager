// EXP-002-T07 -- authorization, combination and performance/bounds tests
// for GET /expense/search, on top of the coverage EXP-002-T02/T04 already
// wrote (expenseSearchValidation.test.js, expenseSearchService.test.js,
// getByCustom.filters.test.js/.pagination.test.js). This file does not
// re-prove what those already cover (single-filter shapes, AND-combination
// of all 5 at once on a positive match, span-cap alone, limit+1 alone) --
// it targets what wasn't explicit yet:
//
//   Authorization: userId is NEVER client-controlled -- buildExpenseSearchFilter
//   ignores a userId key smuggled into its params object, and getByCustom
//   ignores any userId in the query string, scoping strictly to req.userId
//   (set only by Middlewares/Auth.js's verifyToken from the verified JWT --
//   confirmed by reading that file directly, not assumed). A failed user
//   lookup short-circuits with 401 before any ExpenseModel query runs.
//
//   Combination: AND-only holds in the NEGATIVE direction too -- a document
//   failing exactly one of five simultaneously-active filters is excluded,
//   proven once per filter dimension (not just the positive "everything
//   matches" case already covered elsewhere).
//
//   Performance/bounds: limit+1 holds under a combined (not single) filter;
//   the max-span cap survives when every other optional filter is also
//   present; and boundedness holds at a scale (150 synthetic docs) no
//   hand-picked fixture exercises.
//
// No live MongoDB is available in this environment -- every model below
// is an in-memory fake applying the REAL filter shapes the service
// produces, the same "real control flow, fake datastore" pattern already
// established in this codebase (tests/getByCustom.pagination.test.js,
// tests/accountDeletionReconciliation.test.js). A genuine query-plan
// verification (EXPLAIN showing the {userId,expenseDate} index is used,
// not a collection scan) needs real MongoDB and is NOT claimed as done
// here -- see the note in docs/expense/EXP-002-T03-T04-normalized-fields
// -and-query-service.md and this task's tracker notes.
"use strict";

const { buildExpenseSearchFilter } = require("../Services/ExpenseServices/expenseSearchService");
const { expenseSearchValidation } = require("../Middlewares/AuthValidation");

const SCHEMAS_PATH = "../config/Schemas";
const RECURRING_STATE_PATH = "../Services/RecurringServices/recurringStateService";

const USER_A = "64f1a2b3c4d5e6f7a8b9c0aa";
const USER_B = "64f1a2b3c4d5e6f7a8b9c0bb";

const START = new Date("2026-01-01T00:00:00.000Z");
const END = new Date("2026-01-31T23:59:59.999Z");

function buildRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function expenseDoc({ id, userId, dateStr, name = "x", category = "Food", amount = 10, recurring = false }) {
  return {
    _id: id,
    userId,
    expenseDate: new Date(dateStr),
    expenseName: name,
    expenseCategory: category,
    expenseAmount: amount,
    isRecurring: recurring,
  };
}

// Same full-filter-shape in-memory emulator getByCustom.filters.test.js
// established, reused here rather than a second hand-rolled copy.
function makeExpenseModel(allDocs) {
  return {
    find: jest.fn((filter) => {
      let results = allDocs.filter((d) => String(d.userId) === String(filter.userId));

      if (filter.expenseDate) {
        results = results.filter((d) => d.expenseDate >= filter.expenseDate.$gte && d.expenseDate <= filter.expenseDate.$lte);
      }
      if (filter.expenseName) {
        const re = new RegExp(filter.expenseName.$regex, filter.expenseName.$options);
        results = results.filter((d) => re.test(d.expenseName));
      }
      if (filter.expenseCategory !== undefined) {
        results = results.filter((d) => d.expenseCategory === filter.expenseCategory);
      }
      if (filter.expenseAmount) {
        if (filter.expenseAmount.$gte !== undefined) results = results.filter((d) => d.expenseAmount >= filter.expenseAmount.$gte);
        if (filter.expenseAmount.$lte !== undefined) results = results.filter((d) => d.expenseAmount <= filter.expenseAmount.$lte);
      }
      if (filter.isRecurring !== undefined) {
        results = results.filter((d) => d.isRecurring === filter.isRecurring);
      }

      const chain = {
        sort: () => {
          results = [...results].sort((a, b) => b.expenseDate - a.expenseDate || (a._id < b._id ? 1 : -1));
          return chain;
        },
        limit: (n) => { results = results.slice(0, n); return chain; },
        lean: async () => results,
      };
      return chain;
    }),
  };
}

function loadController(allDocs, { userLookup } = {}) {
  jest.resetModules();
  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: jest.fn(userLookup || (async (id) => ({ _id: id }))) },
    ExpenseModel: makeExpenseModel(allDocs),
  }));
  jest.doMock(RECURRING_STATE_PATH, () => ({
    annotateRecurringState: jest.fn(async (_userId, docs) => docs),
  }));
  return require("../Controllers/GetExpenseControllers/getbycustom");
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("EXP-002-T07 authorization -- userId can never come from client input", () => {
  test("buildExpenseSearchFilter ignores a userId smuggled into the params object", () => {
    const filter = buildExpenseSearchFilter("real-user", {
      startDate: START,
      endDate: END,
      userId: "attacker-controlled-user-id",
    });
    expect(filter.userId).toBe("real-user");
  });

  test("getByCustom ignores a spoofed userId in the query string -- results stay scoped to req.userId", async () => {
    const docs = [
      expenseDoc({ id: "a1", userId: USER_A, dateStr: "2026-01-10", name: "Coffee" }),
      expenseDoc({ id: "b1", userId: USER_B, dateStr: "2026-01-10", name: "Coffee" }),
    ];
    const { getByCustom } = loadController(docs);

    // The authenticated caller is USER_A (req.userId, set only by
    // verifyToken from the verified JWT -- never from the query string),
    // but the query string itself claims to be USER_B.
    const req = {
      userId: USER_A,
      query: { userId: USER_B, startDate: "2026-01-01", endDate: "2026-01-31" },
    };
    const res = buildRes();
    await getByCustom(req, res);

    expect(res.body.data.map((d) => d._id)).toEqual(["a1"]);
  });

  test("two users with identically-matching expenses never see each other's data through the same filter combination", async () => {
    const docs = [
      expenseDoc({ id: "a1", userId: USER_A, dateStr: "2026-01-10", name: "Rent", category: "Housing", amount: 1000, recurring: true }),
      expenseDoc({ id: "b1", userId: USER_B, dateStr: "2026-01-10", name: "Rent", category: "Housing", amount: 1000, recurring: true }),
    ];
    const { getByCustom } = loadController(docs);
    const sharedQuery = {
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      nameContains: "rent",
      category: "housing",
      minAmount: "500",
      maxAmount: "1500",
      isRecurring: "true",
    };

    const resA = buildRes();
    await getByCustom({ userId: USER_A, query: sharedQuery }, resA);
    expect(resA.body.data.map((d) => d._id)).toEqual(["a1"]);

    const resB = buildRes();
    await getByCustom({ userId: USER_B, query: sharedQuery }, resB);
    expect(resB.body.data.map((d) => d._id)).toEqual(["b1"]);
  });

  test("an unresolvable req.userId (deleted/invalid session) short-circuits with 401 before any expense query runs", async () => {
    const findSpy = jest.fn();
    jest.resetModules();
    jest.doMock(SCHEMAS_PATH, () => ({
      UserModel: { findById: jest.fn(async () => null) },
      ExpenseModel: { find: findSpy },
    }));
    jest.doMock(RECURRING_STATE_PATH, () => ({ annotateRecurringState: jest.fn() }));
    const { getByCustom } = require("../Controllers/GetExpenseControllers/getbycustom");

    const req = { userId: "some-deleted-user", query: { startDate: "2026-01-01", endDate: "2026-01-31" } };
    const res = buildRes();
    await getByCustom(req, res);

    expect(res.statusCode).toBe(401);
    expect(findSpy).not.toHaveBeenCalled();
  });
});

describe("EXP-002-T07 combination -- AND-only holds in the negative direction, per filter", () => {
  // One document that matches every filter EXCEPT the one named, proving
  // that filter's absence is actually load-bearing rather than
  // coincidentally already-excluded by another predicate.
  const base = { id: "spoiler", userId: USER_A, dateStr: "2026-01-15", name: "Grocery run", category: "Food", amount: 60, recurring: false };
  const matchAll = { id: "match", userId: USER_A, dateStr: "2026-01-15", name: "Grocery run", category: "Food", amount: 60, recurring: false };
  const sharedQuery = {
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    nameContains: "grocery",
    category: "food",
    minAmount: "50",
    maxAmount: "70",
    isRecurring: "false",
  };

  test.each([
    ["nameContains", { name: "Bus ticket" }],
    ["category", { category: "Transport" }],
    ["minAmount", { amount: 10 }],
    ["maxAmount", { amount: 999 }],
    ["isRecurring", { recurring: true }],
  ])("a document failing only %s is excluded even though it matches every other active filter", async (_label, override) => {
    const spoiler = expenseDoc({ ...base, ...override });
    const match = expenseDoc(matchAll);
    const { getByCustom } = loadController([spoiler, match]);

    const req = { userId: USER_A, query: sharedQuery };
    const res = buildRes();
    await getByCustom(req, res);

    expect(res.body.data.map((d) => d._id)).toEqual(["match"]);
  });

  test("all five filters combined with zero matches returns a successful empty result, not an error", async () => {
    const nonMatching = expenseDoc({ id: "e1", userId: USER_A, dateStr: "2026-01-15", name: "Bus ticket", category: "Transport", amount: 2, recurring: false });
    const { getByCustom } = loadController([nonMatching]);

    const req = { userId: USER_A, query: sharedQuery };
    const res = buildRes();
    await getByCustom(req, res);

    expect(res.statusCode ?? 200).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });
});

describe("EXP-002-T07 performance/bounds", () => {
  test("combining every optional filter still requests exactly limit + 1 documents", async () => {
    jest.resetModules();
    const limitSpy = jest.fn(() => ({ lean: async () => [] }));
    const ExpenseModel = { find: jest.fn(() => ({ sort: () => ({ limit: limitSpy }) })) };
    jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel }));
    const { searchExpenses } = require("../Services/ExpenseServices/expenseSearchService");

    await searchExpenses(
      USER_A,
      { startDate: START, endDate: END, nameContains: "x", category: "Food", minAmount: 1, maxAmount: 999, isRecurring: false },
      25,
      null
    );

    expect(limitSpy).toHaveBeenCalledWith(26);
  });

  test("the max-span cap still rejects an over-limit range when every other optional filter is also present", () => {
    const { MAX_PERIOD_SPAN_DAYS } = require("../utils/dateRangeLimits");
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date(start.getTime() + (MAX_PERIOD_SPAN_DAYS + 1) * 24 * 60 * 60 * 1000);
    const req = {
      query: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        nameContains: "coffee",
        category: "Food",
        minAmount: "1",
        maxAmount: "999",
        isRecurring: "true",
      },
    };
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    const next = jest.fn();

    expenseSearchValidation(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test("stays bounded to the page size at scale -- 150 matching documents never yield more than one page", async () => {
    const manyDocs = Array.from({ length: 150 }, (_, i) =>
      expenseDoc({ id: `e${i}`, userId: USER_A, dateStr: "2026-01-15", name: "Coffee", category: "Food", amount: 10, recurring: false })
    );
    const { getByCustom } = loadController(manyDocs);

    const req = {
      userId: USER_A,
      query: { startDate: "2026-01-01", endDate: "2026-01-31", limit: "50" },
    };
    const res = buildRes();
    await getByCustom(req, res);

    expect(res.body.data).toHaveLength(50);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.nextCursor).toBeTruthy();
  });
});
