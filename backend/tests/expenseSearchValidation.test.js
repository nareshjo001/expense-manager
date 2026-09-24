// EXP-002-T02 -- expenseSearchValidation (GET /expense/search query
// validation). Unit-tests the middleware function directly, matching the
// controller-unit-test pattern already established for the other
// AuthValidation.js middlewares (see tests/accountDeletion.test.js's
// requestDeletionValidation coverage) -- not a supertest/`require('../app')`
// route test, which this codebase has separately documented as costing
// 67-98s across a whole file (tests/expense.mutationReliability.test.js's
// own header comment) for a cost this middleware's own logic does not need.
"use strict";

const { expenseSearchValidation } = require("../Middlewares/AuthValidation");
const { MAX_PERIOD_SPAN_DAYS } = require("../utils/dateRangeLimits");

const makeReq = (query) => ({ query });
const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};
const responseBody = (res) => res.json.mock.calls[0][0];

describe("EXP-002-T02 expenseSearchValidation -- required fields", () => {
  test("rejects a missing startDate", () => {
    const req = makeReq({ endDate: "2026-01-31" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects a missing endDate", () => {
    const req = makeReq({ startDate: "2026-01-01" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  test("rejects a malformed date", () => {
    const req = makeReq({ startDate: "not-a-date", endDate: "2026-01-31" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("accepts a valid startDate/endDate pair with nothing else", () => {
    const req = makeReq({ startDate: "2026-01-01", endDate: "2026-01-31" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("EXP-002-T02 expenseSearchValidation -- ordering and max span (EXP-002-T01's flagged gap)", () => {
  test("rejects endDate before startDate", () => {
    const req = makeReq({ startDate: "2026-02-01", endDate: "2026-01-01" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(responseBody(res).message).toMatch(/endDate must not be before startDate/i);
    expect(next).not.toHaveBeenCalled();
  });

  test("accepts a span exactly at MAX_PERIOD_SPAN_DAYS", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date(start.getTime() + MAX_PERIOD_SPAN_DAYS * 24 * 60 * 60 * 1000);
    const req = makeReq({ startDate: start.toISOString(), endDate: end.toISOString() });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("rejects a span one day beyond MAX_PERIOD_SPAN_DAYS", () => {
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date(start.getTime() + (MAX_PERIOD_SPAN_DAYS + 1) * 24 * 60 * 60 * 1000);
    const req = makeReq({ startDate: start.toISOString(), endDate: end.toISOString() });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(responseBody(res).message).toMatch(new RegExp(`${MAX_PERIOD_SPAN_DAYS} days`));
    expect(next).not.toHaveBeenCalled();
  });
});

describe("EXP-002-T02 expenseSearchValidation -- the four new optional filters", () => {
  const base = { startDate: "2026-01-01", endDate: "2026-01-31" };

  test("accepts nameContains", () => {
    const req = makeReq({ ...base, nameContains: "coffee" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.query.nameContains).toBe("coffee");
  });

  test("rejects an empty-string nameContains (not the same as omitting it)", () => {
    const req = makeReq({ ...base, nameContains: "" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("accepts category", () => {
    const req = makeReq({ ...base, category: "Food" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("accepts minAmount and maxAmount, coerced to numbers", () => {
    const req = makeReq({ ...base, minAmount: "10", maxAmount: "100" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.query.minAmount).toBe(10);
    expect(req.query.maxAmount).toBe(100);
  });

  test("rejects a negative minAmount", () => {
    const req = makeReq({ ...base, minAmount: "-5" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("rejects maxAmount less than minAmount", () => {
    const req = makeReq({ ...base, minAmount: "100", maxAmount: "50" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(responseBody(res).message).toMatch(/maxAmount must not be less than minAmount/i);
  });

  test("accepts minAmount alone, or maxAmount alone", () => {
    for (const query of [{ ...base, minAmount: "10" }, { ...base, maxAmount: "10" }]) {
      const req = makeReq(query);
      const res = makeRes();
      const next = jest.fn();
      expenseSearchValidation(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  test("accepts isRecurring as a query-string boolean, coerced to a real boolean", () => {
    const req = makeReq({ ...base, isRecurring: "true" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.query.isRecurring).toBe(true);
  });

  test("rejects a non-boolean isRecurring", () => {
    const req = makeReq({ ...base, isRecurring: "maybe" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("leaves limit/cursor untouched for utils/pagination.js to validate on its own", () => {
    const req = makeReq({ ...base, limit: "not-a-number", cursor: "whatever" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    // This middleware does not know about limit/cursor's own contract --
    // `unknown(true)` lets them through unvalidated, and next() still runs.
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.query.limit).toBe("not-a-number");
  });

  test("all four filters together, combined with a valid date range", () => {
    const req = makeReq({ ...base, nameContains: "coffee", category: "Food", minAmount: "5", maxAmount: "50", isRecurring: "false" });
    const res = makeRes();
    const next = jest.fn();
    expenseSearchValidation(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
