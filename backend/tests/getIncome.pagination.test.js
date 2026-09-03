// EXP-003 -- backend/Controllers/IncomeControllers/getIncome.js pagination.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const PERIOD_RESOLVER_PATH = "../Services/InsightServices/periodResolver";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

function buildRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

function incomeDoc(dateStr, id) {
  return { _id: id, userId: USER_ID, incomeDate: new Date(dateStr), incomeAmount: 100, incomeSource: "salary" };
}

// Fake IncomeModel.find(...).sort(...).limit(...).lean() chain (paginated
// path) that also supports the plain .sort() (no .lean()) shape the
// unpaginated path uses, exercising the real $or keyset filter shape.
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
        then: (resolve) => resolve(results), // makes the un-lean()'d chain awaitable too
      };
      return chain;
    }),
  };
}

function loadController({ allDocs }) {
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

const DOCS = [
  incomeDoc("2026-01-10", "64f1a2b3c4d5e6f7a8b9d001"),
  incomeDoc("2026-01-09", "64f1a2b3c4d5e6f7a8b9d002"),
  incomeDoc("2026-01-08", "64f1a2b3c4d5e6f7a8b9d003"),
  incomeDoc("2026-01-07", "64f1a2b3c4d5e6f7a8b9d004"),
];

describe("getIncome -- backward compatibility (no pagination params)", () => {
  test("omitting limit returns the exact previous unbounded shape", async () => {
    const { getIncome } = loadController({ allDocs: DOCS });
    const req = { userId: USER_ID, query: {} };
    const res = buildRes();

    await getIncome(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(4);
    expect(res.body.hasMore).toBeUndefined();
    expect(res.body.nextCursor).toBeUndefined();
  });
});

describe("getIncome -- cursor pagination", () => {
  test("returns a bounded page with hasMore and a usable nextCursor", async () => {
    const { getIncome } = loadController({ allDocs: DOCS });
    const req = { userId: USER_ID, query: { limit: "2" } };
    const res = buildRes();

    await getIncome(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.hasMore).toBe(true);
    expect(typeof res.body.nextCursor).toBe("string");
  });

  test("paging through with the returned cursor covers every record exactly once", async () => {
    const { getIncome } = loadController({ allDocs: DOCS });
    const seenIds = [];
    let cursor;
    let hasMore = true;

    while (hasMore) {
      const req = { userId: USER_ID, query: { limit: "2", ...(cursor ? { cursor } : {}) } };
      const res = buildRes();
      await getIncome(req, res);

      res.body.data.forEach((d) => seenIds.push(d._id));
      hasMore = res.body.hasMore;
      cursor = res.body.nextCursor;
    }

    expect(new Set(seenIds).size).toBe(4);
  });

  test("rejects an invalid limit before running any query", async () => {
    const { getIncome } = loadController({ allDocs: DOCS });
    const req = { userId: USER_ID, query: { limit: "0" } };
    const res = buildRes();

    await getIncome(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_PAGINATION_PARAMS");
  });
});
