// EXP-002-T04 -- end-to-end wiring of the 4 new optional search filters
// through getByCustom, at the same controller-unit-test level
// tests/getByCustom.pagination.test.js already established (real
// annotateRecurringState mocked out, a small in-memory ExpenseModel fake
// applying the REAL filter shapes the query service produces).
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const RECURRING_STATE_PATH = "../Services/RecurringServices/recurringStateService";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

function buildRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function expenseDoc({ id, dateStr, name = "x", category = "Food", amount = 10, recurring = false }) {
  return {
    _id: id,
    userId: USER_ID,
    expenseDate: new Date(dateStr),
    expenseName: name,
    expenseCategory: category,
    expenseAmount: amount,
    isRecurring: recurring,
  };
}

// A slightly fuller in-memory Mongo-filter emulator than
// getByCustom.pagination.test.js's own (that one only needed userId +
// expenseDate + the cursor $or clause) -- this one also applies
// expenseName's $regex, expenseCategory's exact match, expenseAmount's
// range, and isRecurring's exact match, so the test exercises the REAL
// combined filter object expenseSearchService.js produces end to end.
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

function loadController(allDocs) {
  jest.resetModules();
  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: jest.fn(async () => ({ _id: USER_ID })) },
    ExpenseModel: makeExpenseModel(allDocs),
  }));
  jest.doMock(RECURRING_STATE_PATH, () => ({
    annotateRecurringState: jest.fn(async (_userId, docs) => docs.map((d) => ({ ...d, isRecurring: d.isRecurring }))),
  }));
  return require("../Controllers/GetExpenseControllers/getbycustom");
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const DOCS = [
  expenseDoc({ id: "e1", dateStr: "2026-01-10", name: "Morning Coffee", category: "Food", amount: 5, recurring: false }),
  expenseDoc({ id: "e2", dateStr: "2026-01-09", name: "Bus ticket", category: "Transport", amount: 2, recurring: false }),
  expenseDoc({ id: "e3", dateStr: "2026-01-08", name: "Netflix", category: "Entertainment", amount: 15, recurring: true }),
  expenseDoc({ id: "e4", dateStr: "2026-01-07", name: "Grocery run", category: "Food", amount: 60, recurring: false }),
];
const BASE_QUERY = { userId: USER_ID, startDate: "2026-01-01", endDate: "2026-01-31" };

describe("EXP-002-T04 getByCustom -- the 4 new filters, end to end", () => {
  test("nameContains narrows to a case-insensitive substring match", async () => {
    const { getByCustom } = loadController(DOCS);
    const req = { userId: USER_ID, query: { ...BASE_QUERY, nameContains: "coffee" } };
    const res = buildRes();
    await getByCustom(req, res);
    expect(res.body.data.map((d) => d._id)).toEqual(["e1"]);
  });

  test("category exact-matches after normalization", async () => {
    const { getByCustom } = loadController(DOCS);
    const req = { userId: USER_ID, query: { ...BASE_QUERY, category: "food" } };
    const res = buildRes();
    await getByCustom(req, res);
    expect(res.body.data.map((d) => d._id).sort()).toEqual(["e1", "e4"]);
  });

  test("minAmount/maxAmount narrows to the range", async () => {
    const { getByCustom } = loadController(DOCS);
    const req = { userId: USER_ID, query: { ...BASE_QUERY, minAmount: "10", maxAmount: "20" } };
    const res = buildRes();
    await getByCustom(req, res);
    expect(res.body.data.map((d) => d._id)).toEqual(["e3"]);
  });

  test("isRecurring narrows to recurring-only", async () => {
    const { getByCustom } = loadController(DOCS);
    const req = { userId: USER_ID, query: { ...BASE_QUERY, isRecurring: "true" } };
    const res = buildRes();
    await getByCustom(req, res);
    expect(res.body.data.map((d) => d._id)).toEqual(["e3"]);
  });

  test("all four combined narrow with AND semantics, not OR", async () => {
    const { getByCustom } = loadController(DOCS);
    // Only e4 is Food AND >= 50 AND non-recurring AND matches "grocery".
    const req = { userId: USER_ID, query: { ...BASE_QUERY, nameContains: "grocery", category: "food", minAmount: "50", isRecurring: "false" } };
    const res = buildRes();
    await getByCustom(req, res);
    expect(res.body.data.map((d) => d._id)).toEqual(["e4"]);
  });

  test("no new filters still returns everything in range, unchanged behaviour", async () => {
    const { getByCustom } = loadController(DOCS);
    const req = { userId: USER_ID, query: { ...BASE_QUERY } };
    const res = buildRes();
    await getByCustom(req, res);
    expect(res.body.data).toHaveLength(4);
  });
});
