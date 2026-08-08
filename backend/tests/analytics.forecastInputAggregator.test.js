// Forecasting V2 architecture-closure: isolated characterization of
// analytics/forecastInputAggregator.js -- the ONLY module that reads
// transaction-level fields off a raw expense pool for forecasting
// purposes. forecastAnalyzer.js itself is proven, in
// tests/analytics.forecast.test.js, to never receive this raw shape at
// all -- these tests instead prove the aggregation boundary itself is
// correct: bounded, aggregate-only, order-independent, non-mutating, and
// tolerant of malformed input.
"use strict";

const {
  buildCompletedMonthSeries,
  computeCurrentPartialMonthTotal,
} = require("../analytics/forecastInputAggregator");
const { forecast: RULES } = require("../analytics/analyzers/scores/forecastRules");

const CURRENT_MONTH_START = new Date(2026, 7, 1); // August 2026, local time

const makeExpense = (monthsAgo, amount, day = 15, overrides = {}) => {
  const date = new Date(CURRENT_MONTH_START.getFullYear(), CURRENT_MONTH_START.getMonth() - monthsAgo, day);
  return {
    _id: `exp-${monthsAgo}-${day}-${amount}`,
    userId: "user-should-not-leak",
    expenseName: "Some purchase",
    expenseCategory: "Food",
    expenseAmount: amount,
    expenseDate: date,
    ...overrides,
  };
};

describe("analytics/forecastInputAggregator -- buildCompletedMonthSeries", () => {
  it("produces only { monthKey, totalAmount } entries -- no transaction-shaped fields survive", () => {
    const pool = [makeExpense(1, 1000), makeExpense(2, 1000), makeExpense(3, 1000)];
    const series = buildCompletedMonthSeries(pool, CURRENT_MONTH_START);

    expect(series.length).toBe(3);
    for (const entry of series) {
      expect(Object.keys(entry).sort()).toEqual(["monthKey", "totalAmount"]);
    }
    expect(JSON.stringify(series)).not.toMatch(/exp-|user-should-not-leak|Some purchase|Food/);
  });

  it("excludes the current, in-progress month strictly by date", () => {
    const pool = [...Array.from({ length: 3 }, (_, i) => makeExpense(i + 1, 1000)), makeExpense(0, 999999, 1)];
    const series = buildCompletedMonthSeries(pool, CURRENT_MONTH_START);
    expect(series.length).toBe(3);
  });

  it("excludes records older than RULES.maxHistoryMonths", () => {
    const tooOld = makeExpense(RULES.maxHistoryMonths + 1, 999999);
    const pool = [...Array.from({ length: 6 }, (_, i) => makeExpense(i + 1, 1000)), tooOld];
    const series = buildCompletedMonthSeries(pool, CURRENT_MONTH_START);
    expect(series.length).toBe(6);
  });

  it("is independent of raw input array order", () => {
    const pool = [makeExpense(1, 1000), makeExpense(2, 5000), makeExpense(3, 1000)];
    const reversed = [...pool].reverse();

    const a = buildCompletedMonthSeries(pool, CURRENT_MONTH_START);
    const b = buildCompletedMonthSeries(reversed, CURRENT_MONTH_START);

    expect(b).toEqual(a);
  });

  it("skips malformed records (non-object, invalid date, uncoercible amount) without throwing or mutating input", () => {
    const pool = Object.freeze([
      null,
      undefined,
      42,
      "not-an-expense",
      { expenseDate: "not-a-date", expenseAmount: 100 },
      { expenseDate: new Date(2026, 1, 15), expenseAmount: Object.create(null) },
      makeExpense(1, 1000),
      makeExpense(2, 1000),
      makeExpense(3, 1000),
    ]);

    expect(() => buildCompletedMonthSeries(pool, CURRENT_MONTH_START)).not.toThrow();
    const series = buildCompletedMonthSeries(pool, CURRENT_MONTH_START);
    expect(series.length).toBe(3);
  });

  it("a month with no recorded expenses at all is genuinely absent, not zero-filled", () => {
    const pool = [makeExpense(1, 1000), makeExpense(3, 1000), makeExpense(5, 1000)];
    const series = buildCompletedMonthSeries(pool, CURRENT_MONTH_START);
    expect(series.length).toBe(3);
  });

  it("a month whose recorded expenses sum to exactly 0 appears as a real 0 entry", () => {
    const pool = [
      makeExpense(1, 100),
      makeExpense(1, -100), // same month, nets to 0
      makeExpense(2, 1000),
      makeExpense(3, 1000),
    ];
    const series = buildCompletedMonthSeries(pool, CURRENT_MONTH_START);
    expect(series.length).toBe(3);
    expect(series.some((e) => e.totalAmount === 0)).toBe(true);
  });

  it("returns an empty series for an invalid anchor date without throwing", () => {
    expect(() => buildCompletedMonthSeries([], new Date("not-a-date"))).not.toThrow();
    expect(buildCompletedMonthSeries([], new Date("not-a-date"))).toEqual([]);
  });

  it("never mutates the input pool", () => {
    const pool = Object.freeze([makeExpense(1, 1000)].map((e) => Object.freeze(e)));
    expect(() => buildCompletedMonthSeries(pool, CURRENT_MONTH_START)).not.toThrow();
  });
});

describe("analytics/forecastInputAggregator -- computeCurrentPartialMonthTotal", () => {
  it("returns a single rounded scalar, summing only finite amounts", () => {
    const records = [makeExpense(0, 100.01), makeExpense(0, 50), { expenseAmount: "not-a-number" }, null];
    const total = computeCurrentPartialMonthTotal(records);
    expect(typeof total).toBe("number");
    expect(total).toBe(150.01);
  });

  it("returns 0 for empty/non-array input without throwing", () => {
    expect(computeCurrentPartialMonthTotal([])).toBe(0);
    expect(computeCurrentPartialMonthTotal(undefined)).toBe(0);
    expect(computeCurrentPartialMonthTotal(null)).toBe(0);
  });
});
