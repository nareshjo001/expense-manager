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

describe("getByCustom -- backward compatibility (no pagination params)", () => {
  test("omitting limit returns the exact previous unbounded shape (no hasMore/nextCursor)", async () => {
    const { getByCustom } = loadController({ allDocs: DOCS });
    const req = { userId: USER_ID, query: { startDate: "2026-01-01", endDate: "2026-01-31" } };
    const res = buildRes();

    await getByCustom(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(5);
    expect(res.body.hasMore).toBeUndefined();
    expect(res.body.nextCursor).toBeUndefined();
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

  test("rejects a well-formed cursor supplied without a limit", async () => {
    const { encodeCursor } = require("../utils/pagination");
    const { getByCustom } = loadController({ allDocs: DOCS });
    const validCursor = encodeCursor({ date: new Date("2026-01-08"), id: "64f1a2b3c4d5e6f7a8b9c003" });
    const req = { userId: USER_ID, query: { startDate: "2026-01-01", endDate: "2026-01-31", cursor: validCursor } };
    const res = buildRes();

    await getByCustom(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/limit is required/);
  });
});
