// EXP-003 -- backend/Controllers/GetExpenseControllers/getbycustom.js pagination.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const FETCH_EXPENSES_PATH = "./fetchExpenses";
const RECURRING_STATE_PATH = "../Services/RecurringServices/recurringStateService";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

function buildRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function expenseDoc(dateStr, id) {
  return { _id: id, userId: USER_ID, expenseDate: new Date(dateStr), expenseAmount: 10, expenseName: "x", expenseCategory: "Food" };
}

// Builds a fake ExpenseModel.find(...).sort(...).limit(...).lean() chain
// over an in-memory array, applying the exact $or keyset filter shape
// pagination.js produces (so the test exercises the real filter, not a
// hand-simplified stand-in for it).
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

function loadController({ allDocs }) {
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

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const DOCS = [
  expenseDoc("2026-01-10", "64f1a2b3c4d5e6f7a8b9c001"),
  expenseDoc("2026-01-09", "64f1a2b3c4d5e6f7a8b9c002"),
  expenseDoc("2026-01-08", "64f1a2b3c4d5e6f7a8b9c003"),
  expenseDoc("2026-01-07", "64f1a2b3c4d5e6f7a8b9c004"),
  expenseDoc("2026-01-06", "64f1a2b3c4d5e6f7a8b9c005"),
];

// EXP-003-T03 -- this route no longer has an unbounded path. These tests
// previously asserted the opposite (omitting `limit` returned the whole
// range); that behaviour was the "unbounded user history" the feature exists
// to remove, so the assertions were inverted rather than deleted.
describe("getByCustom -- bounded by default (no pagination params)", () => {
  test("omitting limit still returns a bounded page carrying hasMore/nextCursor", async () => {
    const { getByCustom } = loadController({ allDocs: DOCS });
    const req = { userId: USER_ID, query: { startDate: "2026-01-01", endDate: "2026-01-31" } };
    const res = buildRes();

    await getByCustom(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // Fewer documents than DEFAULT_LIMIT exist, so all 5 come back -- but the
    // pagination envelope is present, which is what proves the bounded path
    // ran rather than the old unbounded one.
    expect(res.body.data).toHaveLength(5);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.nextCursor).toBeNull();
  });

  test("never returns more than DEFAULT_LIMIT documents when limit is omitted", async () => {
    const { DEFAULT_LIMIT } = require("../utils/pagination");
    const many = Array.from({ length: DEFAULT_LIMIT + 25 }, (_, i) =>
      expenseDoc(
        new Date(Date.UTC(2026, 0, 31) - i * 86400000).toISOString().slice(0, 10),
        `64f1a2b3c4d5e6f7a8b9${String(i).padStart(4, "0")}`
      )
    );
    const { getByCustom } = loadController({ allDocs: many });
    const req = { userId: USER_ID, query: { startDate: "2025-01-01", endDate: "2026-12-31" } };
    const res = buildRes();

    await getByCustom(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(DEFAULT_LIMIT);
    expect(res.body.hasMore).toBe(true);
    expect(typeof res.body.nextCursor).toBe("string");
  });
});

describe("getByCustom -- cursor pagination", () => {
  test("returns a bounded first page with hasMore and a usable nextCursor", async () => {
    const { getByCustom } = loadController({ allDocs: DOCS });
    const req = { userId: USER_ID, query: { startDate: "2026-01-01", endDate: "2026-01-31", limit: "2" } };
    const res = buildRes();

    await getByCustom(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);
    expect(typeof res.body.nextCursor).toBe("string");
  });

  test("paging through with the returned cursor never repeats or skips a document", async () => {
    const { getByCustom } = loadController({ allDocs: DOCS });
    const seenIds = [];
    let cursor;
    let hasMore = true;

    while (hasMore) {
      const req = { userId: USER_ID, query: { startDate: "2026-01-01", endDate: "2026-01-31", limit: "2", ...(cursor ? { cursor } : {}) } };
      const res = buildRes();
      await getByCustom(req, res);

      res.body.data.forEach((d) => seenIds.push(d._id));
      hasMore = res.body.hasMore;
      cursor = res.body.nextCursor;
    }

    expect(new Set(seenIds).size).toBe(5);
    expect(seenIds).toHaveLength(5);
  });

  test("rejects an invalid limit with a stable error code, before any query runs", async () => {
    const { getByCustom } = loadController({ allDocs: DOCS });
    const req = { userId: USER_ID, query: { startDate: "2026-01-01", endDate: "2026-01-31", limit: "not-a-number" } };
    const res = buildRes();

    await getByCustom(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_PAGINATION_PARAMS");
  });

  // Previously a 400. With a documented default page size, a cursor on its
  // own is no longer ambiguous, so it is accepted and uses DEFAULT_LIMIT.
  test("accepts a well-formed cursor supplied without a limit, using the default page size", async () => {
    const { encodeCursor } = require("../utils/pagination");
    const { getByCustom } = loadController({ allDocs: DOCS });
    const validCursor = encodeCursor({ date: new Date("2026-01-08"), id: "64f1a2b3c4d5e6f7a8b9c003" });
    const req = { userId: USER_ID, query: { startDate: "2026-01-01", endDate: "2026-01-31", cursor: validCursor } };
    const res = buildRes();

    await getByCustom(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.hasMore).toBe(false);
  });

  // A present-but-invalid limit is still rejected: quietly serving the default
  // would hide the client's mistake and make the page size look intentional.
  test("still rejects a present but out-of-range limit rather than defaulting", async () => {
    const { MAX_LIMIT } = require("../utils/pagination");
    const { getByCustom } = loadController({ allDocs: DOCS });
    const req = { userId: USER_ID, query: { startDate: "2026-01-01", endDate: "2026-01-31", limit: String(MAX_LIMIT + 1) } };
    const res = buildRes();

    await getByCustom(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_PAGINATION_PARAMS");
  });
});
