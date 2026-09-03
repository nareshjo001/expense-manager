// EXP-003-T07 -- dedicated large-dataset performance/scale benchmark for
// cursor pagination. pagination.test.js covers the primitives in
// isolation; getByCustom.pagination.test.js and getIncome.pagination.test.js
// already prove keyset-correctness (no skip/repeat) at a handful of
// documents. Neither exercises what a real, large collection looks like:
// many pages, many same-day ties (forcing the _id tie-break branch of the
// $or filter repeatedly), and a wall-clock budget that would catch an
// accidentally-quadratic regression (e.g. an implementation that re-scans
// already-returned documents on every page) even though this in-memory
// harness can't reproduce a real MongoDB index's actual query cost.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const FETCH_EXPENSES_PATH = "./fetchExpenses";
const RECURRING_STATE_PATH = "../Services/RecurringServices/recurringStateService";
const PERIOD_RESOLVER_PATH = "../Services/InsightServices/periodResolver";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const DOC_COUNT = 5000;
const PAGE_SIZE = 100;
// Generous on purpose -- this guards against a pathological (e.g.
// quadratic) regression, not a tight perf SLA; CI hardware varies.
const WALL_CLOCK_BUDGET_MS = 5000;

function objectId(n) {
  return n.toString(16).padStart(24, "0");
}

// Spreads documents over many distinct days AND clusters several documents
// on the SAME day (id-descending as the tiebreak), so cursor paging is
// forced through both branches of the keyset $or filter repeatedly, not
// just the date-descending one.
function buildDocs(count, makeDoc) {
  const docs = [];
  let dayOffset = 0;
  let idCounter = 1;
  while (docs.length < count) {
    const sameDayCount = 1 + (dayOffset % 4); // clusters of 1-4 per day
    const dateStr = new Date(Date.UTC(2020, 0, 1 + dayOffset)).toISOString();
    for (let i = 0; i < sameDayCount && docs.length < count; i++) {
      docs.push(makeDoc(dateStr, objectId(idCounter++)));
    }
    dayOffset++;
  }
  return docs;
}

function buildRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

// Same in-memory fake-Mongoose-chain shape as getByCustom.pagination.test.js
// -- applies the real $or keyset filter, not a simplified stand-in for it.
function makeExpenseModel(allDocs) {
  return {
    find: jest.fn((filter) => {
      let results = allDocs.filter((d) => String(d.userId) === String(filter.userId));

      if (filter.expenseDate && filter.expenseDate.$gte) {
        results = results.filter((d) => d.expenseDate >= filter.expenseDate.$gte && d.expenseDate <= filter.expenseDate.$lte);
      }

      if (filter.$or) {
        const [ltClause, eqClause] = filter.$or;
        results = results.filter((d) => {
          if (d.expenseDate.getTime() < ltClause.expenseDate.$lt.getTime()) return true;
          return d.expenseDate.getTime() === eqClause.expenseDate.getTime() && d._id < eqClause._id.$lt;
        });
      }

      const chain = {
        sort: () => {
          results = [...results].sort((a, b) => b.expenseDate - a.expenseDate || (a._id < b._id ? 1 : -1));
          return chain;
        },
        limit: (n) => {
          results = results.slice(0, n);
          return chain;
        },
        lean: async () => results,
      };
      return chain;
    }),
  };
}

// Same shape as getIncome.pagination.test.js's fake model.
function makeIncomeModel(allDocs) {
  return {
    find: jest.fn((filter) => {
      let results = allDocs.filter((d) => String(d.userId) === String(filter.userId));

      if (filter.incomeDate && filter.incomeDate.$gte) {
        results = results.filter((d) => d.incomeDate >= filter.incomeDate.$gte && d.incomeDate < filter.incomeDate.$lt);
      }

      if (filter.$or) {
        const [ltClause, eqClause] = filter.$or;
        results = results.filter((d) => {
          if (d.incomeDate.getTime() < ltClause.incomeDate.$lt.getTime()) return true;
          return d.incomeDate.getTime() === eqClause.incomeDate.getTime() && d._id < eqClause._id.$lt;
        });
      }

      const chain = {
        sort: () => {
          results = [...results].sort((a, b) => b.incomeDate - a.incomeDate || (a._id < b._id ? 1 : -1));
          return chain;
        },
        limit: (n) => {
          results = results.slice(0, n);
          return chain;
        },
        lean: async () => results,
        then: (resolve) => resolve(results),
      };
      return chain;
    }),
  };
}

function loadExpenseController(allDocs) {
  jest.resetModules();
  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: jest.fn(async () => ({ _id: USER_ID })) },
    ExpenseModel: makeExpenseModel(allDocs),
  }));
  jest.doMock(RECURRING_STATE_PATH, () => ({
    annotateRecurringState: jest.fn(async (_userId, docs) => docs.map((d) => ({ ...d, isRecurring: false }))),
  }));
  return require("../Controllers/GetExpenseControllers/getbycustom");
}

function loadIncomeController(allDocs) {
  jest.resetModules();
  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: jest.fn(async () => ({ _id: USER_ID })) },
    IncomeModel: makeIncomeModel(allDocs),
  }));
  jest.doMock(PERIOD_RESOLVER_PATH, () => ({
    resolvePeriod: jest.fn(() => null),
  }));
  return require("../Controllers/IncomeControllers/getIncome");
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("GET /expense/search -- large-dataset cursor pagination", () => {
  test(`walks all ${DOC_COUNT} documents across many pages with no duplicates, no gaps, correct order, and a bounded page size, within ${WALL_CLOCK_BUDGET_MS}ms`, async () => {
    const docs = buildDocs(DOC_COUNT, (dateStr, id) => ({
      _id: id,
      userId: USER_ID,
      expenseDate: new Date(dateStr),
      expenseAmount: 10,
      expenseName: "x",
      expenseCategory: "Food",
    }));
    const { getByCustom } = loadExpenseController(docs);

    const startedAt = Date.now();
    const seenIds = [];
    const pageBoundaries = []; // { oldestInPage, newestInPage } per page, in fetch order (newest page first)
    let pageCount = 0;
    let cursor;
    let hasMore = true;

    while (hasMore) {
      const req = { userId: USER_ID, query: { startDate: "2020-01-01", endDate: "2050-01-01", limit: String(PAGE_SIZE), ...(cursor ? { cursor } : {}) } };
      const res = buildRes();
      await getByCustom(req, res);

      expect(res.statusCode).toBe(200);
      pageCount += 1;
      // Every page except possibly the last is exactly PAGE_SIZE -- proves
      // the server never returns a short page while more data remains.
      if (res.body.hasMore) {
        expect(res.body.data).toHaveLength(PAGE_SIZE);
      } else {
        expect(res.body.data.length).toBeLessThanOrEqual(PAGE_SIZE);
      }

      // getByCustomPaginated re-sorts each PAGE to ascending (chronological)
      // order before returning it (sortAscending in getbycustom.js), even
      // though pages themselves are fetched newest-first via the cursor --
      // so a page's own data must be ascending...
      for (let i = 1; i < res.body.data.length; i++) {
        expect(new Date(res.body.data[i].expenseDate).getTime()).toBeGreaterThanOrEqual(
          new Date(res.body.data[i - 1].expenseDate).getTime()
        );
      }
      if (res.body.data.length > 0) {
        pageBoundaries.push({
          oldestInPage: new Date(res.body.data[0].expenseDate).getTime(),
          newestInPage: new Date(res.body.data[res.body.data.length - 1].expenseDate).getTime(),
        });
      }

      res.body.data.forEach((d) => seenIds.push(d._id));
      hasMore = res.body.hasMore;
      cursor = res.body.nextCursor;
    }

    const elapsedMs = Date.now() - startedAt;

    expect(seenIds).toHaveLength(DOC_COUNT);
    expect(new Set(seenIds).size).toBe(DOC_COUNT); // no duplicates
    expect(pageCount).toBe(Math.ceil(DOC_COUNT / PAGE_SIZE));

    // ...and pages themselves must be non-overlapping and strictly
    // newest-to-oldest: each page's own newest item must be no newer than
    // the PREVIOUS page's oldest item -- checked across the ENTIRE walk,
    // so a boundary bug would show up as two pages sharing or reversing a
    // date range.
    for (let i = 1; i < pageBoundaries.length; i++) {
      expect(pageBoundaries[i].newestInPage).toBeLessThanOrEqual(pageBoundaries[i - 1].oldestInPage);
    }

    expect(elapsedMs).toBeLessThan(WALL_CLOCK_BUDGET_MS);
  });
});

describe("GET /income/get -- large-dataset cursor pagination", () => {
  test(`walks all ${DOC_COUNT} documents across many pages with no duplicates, no gaps, and a bounded page size, within ${WALL_CLOCK_BUDGET_MS}ms`, async () => {
    const docs = buildDocs(DOC_COUNT, (dateStr, id) => ({
      _id: id,
      userId: USER_ID,
      incomeDate: new Date(dateStr),
      incomeAmount: 100,
      incomeSource: "salary",
    }));
    const { getIncome } = loadIncomeController(docs);

    const startedAt = Date.now();
    const seenIds = [];
    let pageCount = 0;
    let cursor;
    let hasMore = true;

    while (hasMore) {
      const req = { userId: USER_ID, query: { limit: String(PAGE_SIZE), ...(cursor ? { cursor } : {}) } };
      const res = buildRes();
      await getIncome(req, res);

      expect(res.statusCode).toBe(200);
      pageCount += 1;
      if (res.body.hasMore) {
        expect(res.body.data).toHaveLength(PAGE_SIZE);
      } else {
        expect(res.body.data.length).toBeLessThanOrEqual(PAGE_SIZE);
      }

      res.body.data.forEach((d) => seenIds.push(d._id));
      hasMore = res.body.hasMore;
      cursor = res.body.nextCursor;
    }

    const elapsedMs = Date.now() - startedAt;

    expect(seenIds).toHaveLength(DOC_COUNT);
    expect(new Set(seenIds).size).toBe(DOC_COUNT);
    expect(pageCount).toBe(Math.ceil(DOC_COUNT / PAGE_SIZE));

    for (let i = 1; i < seenIds.length; i++) {
      expect(seenIds[i] < seenIds[i - 1]).toBe(true);
    }

    expect(elapsedMs).toBeLessThan(WALL_CLOCK_BUDGET_MS);
  });
});
