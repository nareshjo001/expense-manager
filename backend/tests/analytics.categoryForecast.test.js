// Prediction Layer V1: per-category forecast breakdown regression suite. Covers the aggregation boundary (forecastInputAggregator's category series + active-day count), the allocator's own contract (dynamic categories, sparse fallback, non-negativity, EXACT reconciliation to the published total, deterministic ordering), and the analyzer's integration of both -- real production modules throughout, no mocked analyzer, no pre-decided allocation.
"use strict";

const {
  buildCompletedMonthCategorySeries,
  countActiveDays,
} = require("../analytics/forecastInputAggregator");
const categoryForecastAllocator = require("../analytics/analyzers/categoryForecastAllocator");
const forecastAnalyzer = require("../analytics/analyzers/forecastAnalyzer");
const { forecast: RULES } = require("../analytics/analyzers/scores/forecastRules");

// Anchor: 1 Aug 2026. Completed history is therefore Jul 2026 backwards.
const MONTH_START = new Date(2026, 7, 1);

const expense = (monthsAgo, amount, category, day = 15) => ({
  expenseDate: new Date(2026, 7 - monthsAgo, day),
  expenseAmount: amount,
  expenseCategory: category,
});

const sumAmounts = (categories) =>
  Number(categories.reduce((sum, entry) => sum + entry.predictedAmount, 0).toFixed(2));

describe("forecastInputAggregator -- category series (Prediction Layer V1)", () => {
  it("discovers categories dynamically, with no fixed list or count", () => {
    const pool = [
      expense(1, 100, "Food"),
      expense(1, 50, "Travel"),
      expense(2, 70, "Pet Grooming"),
      expense(2, 20, "Food"),
    ];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);
    const names = series.map((entry) => entry.category);

    // Whatever the user actually used -- including a category name this
    // codebase has never heard of.
    expect(names).toEqual(["Food", "Pet Grooming", "Travel"]);
    expect(names).toContain("Pet Grooming");
  });

  it("excludes the current partial month and future-dated expenses", () => {
    const pool = [
      expense(1, 100, "Food"),
      { expenseDate: new Date(2026, 7, 10), expenseAmount: 999, expenseCategory: "Food" }, // current month
      { expenseDate: new Date(2027, 0, 5), expenseAmount: 888, expenseCategory: "Food" }, // future
    ];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);
    const food = series.find((entry) => entry.category === "Food");

    expect(food.monthlySeries).toHaveLength(1);
    expect(food.monthlySeries[0].totalAmount).toBe(100);
  });

  it("orders each category's series oldest-first regardless of input order", () => {
    const pool = [expense(1, 10, "Food"), expense(3, 30, "Food"), expense(2, 20, "Food")];

    const [food] = buildCompletedMonthCategorySeries(pool, MONTH_START);

    expect(food.monthlySeries.map((point) => point.totalAmount)).toEqual([30, 20, 10]);
  });

  // Category Normalization -- updated for the deliberate behaviour change
  // in buildCompletedMonthCategorySeries: a blank/non-string category is no
  // longer SKIPPED, it groups under the explicit `Uncategorized` marker, so
  // its amount is still counted somewhere (it already counted toward the
  // overall completed-month total this breakdown reconciles against). The
  // date/amount skip rules below are unchanged and still drop those records.
  it("groups blank/non-string categories under Uncategorized and still skips malformed records without throwing", () => {
    const pool = [
      expense(1, 100, "Food"),
      null,
      "not-an-object",
      { expenseDate: new Date(2026, 6, 5), expenseAmount: 10, expenseCategory: "   " },
      { expenseDate: new Date(2026, 6, 5), expenseAmount: 10, expenseCategory: 42 },
      { expenseDate: "not-a-date", expenseAmount: 10, expenseCategory: "Food" },
      { expenseDate: new Date(2026, 6, 5), expenseAmount: "abc", expenseCategory: "Food" },
    ];

    expect(() => buildCompletedMonthCategorySeries(pool, MONTH_START)).not.toThrow();
    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);
    expect(series.map((entry) => entry.category)).toEqual(["Food", "Uncategorized"]);

    // Only the two records with a valid date AND amount but an unusable
    // category land in Uncategorized (10 + 10); the invalid-date and
    // uncoercible-amount records are still dropped entirely.
    const uncategorized = series.find((entry) => entry.category === "Uncategorized");
    const uncategorizedTotal = uncategorized.monthlySeries.reduce((sum, p) => sum + p.totalAmount, 0);
    expect(uncategorizedTotal).toBe(20);
  });

  it("counts distinct active days, not the calendar span", () => {
    const pool = [
      expense(1, 10, "Food", 3),
      expense(1, 20, "Travel", 3), // same day -> still one active day
      expense(1, 30, "Food", 9),
      expense(4, 40, "Food", 21),
    ];

    expect(countActiveDays(pool, MONTH_START)).toBe(3);
  });
});

describe("categoryForecastAllocator -- reconciliation and fallbacks", () => {
  const trendingSeries = (category, amounts) => ({
    category,
    monthlySeries: amounts.map((totalAmount, index) => ({
      monthKey: `2026-${index}`, // Jan..  (0-indexed months, real ordinals)
      totalAmount,
    })),
  });

  const ANCHOR_ORDINAL = 2026 * 12 + 7; // Aug 2026

  it("rounded category amounts sum EXACTLY to the published total", () => {
    const result = categoryForecastAllocator.allocate({
      categorySeries: [
        trendingSeries("Food", [300, 320, 340, 360]),
        trendingSeries("Travel", [100, 110, 120, 130]),
        trendingSeries("Bills", [55, 56, 57, 58]),
      ],
      // Deliberately awkward: a total that does not divide evenly.
      predictedTotal: 1000.01,
      anchorOrdinal: ANCHOR_ORDINAL,
    });

    expect(result.hasData).toBe(true);
    expect(sumAmounts(result.categories)).toBe(1000.01);
  });

  it("reconciles exactly for a wide range of awkward totals and category counts", () => {
    const totals = [0.03, 7.77, 99.99, 1234.56, 10000.01];
    const counts = [1, 2, 3, 7, 11];

    for (const total of totals) {
      for (const count of counts) {
        const categorySeries = Array.from({ length: count }, (_, index) =>
          trendingSeries(`Cat${index}`, [10 + index, 12 + index, 14 + index, 16 + index])
        );

        const result = categoryForecastAllocator.allocate({
          categorySeries,
          predictedTotal: total,
          anchorOrdinal: ANCHOR_ORDINAL,
        });

        expect(result.hasData).toBe(true);
        expect(sumAmounts(result.categories)).toBe(total);
      }
    }
  });

  it("never produces a negative category amount even when a category's trend collapses", () => {
    const result = categoryForecastAllocator.allocate({
      categorySeries: [
        trendingSeries("Collapsing", [900, 600, 300, 10]),
        trendingSeries("Steady", [200, 200, 200, 200]),
      ],
      predictedTotal: 400,
      anchorOrdinal: ANCHOR_ORDINAL,
    });

    for (const entry of result.categories) {
      expect(entry.predictedAmount).toBeGreaterThanOrEqual(0);
    }
    expect(sumAmounts(result.categories)).toBe(400);
  });

  it("uses the smoothed-share fallback for a sparse/intermittent category", () => {
    const result = categoryForecastAllocator.allocate({
      categorySeries: [
        trendingSeries("Food", [300, 310, 320, 330]),
        // Only one observed month -> below minMonthsForOwnTrend.
        { category: "Rare", monthlySeries: [{ monthKey: "2026-3", totalAmount: 90 }] },
      ],
      predictedTotal: 500,
      anchorOrdinal: ANCHOR_ORDINAL,
    });

    const rare = result.categories.find((entry) => entry.category === "Rare");
    const food = result.categories.find((entry) => entry.category === "Food");

    expect(rare.method).toBe(RULES.category.methods.smoothedShare);
    expect(food.method).toBe(RULES.category.methods.ownTrend);
    expect(sumAmounts(result.categories)).toBe(500);
  });

  it("is deterministic: identical input produces byte-identical output", () => {
    const input = {
      categorySeries: [
        trendingSeries("B", [10, 20, 30, 40]),
        trendingSeries("A", [10, 20, 30, 40]),
        trendingSeries("C", [5, 5, 5, 5]),
      ],
      predictedTotal: 333.33,
      anchorOrdinal: ANCHOR_ORDINAL,
    };

    const first = categoryForecastAllocator.allocate(input);
    const second = categoryForecastAllocator.allocate(input);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("sorts categories largest-first, breaking exact ties by name ascending", () => {
    const result = categoryForecastAllocator.allocate({
      categorySeries: [
        trendingSeries("Zebra", [100, 100, 100, 100]),
        trendingSeries("Apple", [100, 100, 100, 100]),
      ],
      predictedTotal: 200,
      anchorOrdinal: ANCHOR_ORDINAL,
    });

    expect(result.categories.map((entry) => entry.category)).toEqual(["Apple", "Zebra"]);
  });

  it("reports no breakdown honestly rather than inventing one", () => {
    const noSeries = categoryForecastAllocator.allocate({
      categorySeries: [],
      predictedTotal: 500,
      anchorOrdinal: ANCHOR_ORDINAL,
    });

    expect(noSeries.hasData).toBe(false);
    expect(noSeries.reasonCode).toBe(RULES.reasonCodes.noCategoryBreakdown);
    expect(noSeries.categories).toEqual([]);

    const noTotal = categoryForecastAllocator.allocate({
      categorySeries: [trendingSeries("Food", [10, 20, 30, 40])],
      predictedTotal: 0,
      anchorOrdinal: ANCHOR_ORDINAL,
    });
    expect(noTotal.hasData).toBe(false);
  });

  it("handles extreme-but-valid values without losing exact reconciliation", () => {
    const result = categoryForecastAllocator.allocate({
      categorySeries: [
        trendingSeries("Huge", [9e7, 9.1e7, 9.2e7, 9.3e7]),
        trendingSeries("Tiny", [0.01, 0.01, 0.01, 0.01]),
      ],
      predictedTotal: 95000000.55,
      anchorOrdinal: ANCHOR_ORDINAL,
    });

    expect(result.hasData).toBe(true);
    expect(sumAmounts(result.categories)).toBe(95000000.55);
  });
});

describe("forecastAnalyzer -- category integration (Prediction Layer V1)", () => {
  const buildPool = (months) => {
    const pool = [];
    for (let m = 1; m <= months; m += 1) {
      pool.push(expense(m, 1000 + m * 10, "Food"));
      pool.push(expense(m, 400, "Travel", 20));
    }
    return pool;
  };

  const analyzeWith = (months, targetMonthBudget = null) => {
    const pool = buildPool(months);
    const {
      buildCompletedMonthSeries,
    } = require("../analytics/forecastInputAggregator");
    return forecastAnalyzer.analyze({
      monthlySeries: buildCompletedMonthSeries(pool, MONTH_START),
      currentPartialMonthTotal: 0,
      currentMonthStart: MONTH_START,
      categorySeries: buildCompletedMonthCategorySeries(pool, MONTH_START),
      activeDays: countActiveDays(pool, MONTH_START),
      targetMonthBudget,
    });
  };

  it("attaches a reconciled category breakdown to the next-month horizon", () => {
    const report = analyzeWith(6);

    expect(report.nextCalendarMonthForecast.hasData).toBe(true);
    expect(report.nextCalendarMonthForecast.categories.length).toBeGreaterThan(0);
    expect(sumAmounts(report.nextCalendarMonthForecast.categories)).toBe(report.nextCalendarMonthForecast.estimate);
  });

  it("preserves the bound invariant 0 <= lower <= estimate <= upper", () => {
    const report = analyzeWith(6);
    const { estimate, range } = report.nextCalendarMonthForecast;

    expect(range.lower).toBeGreaterThanOrEqual(0);
    expect(range.lower).toBeLessThanOrEqual(estimate);
    expect(estimate).toBeLessThanOrEqual(range.upper);
  });

  it("omits the breakdown (never guesses one) when the next-month horizon is unavailable", () => {
    const report = analyzeWith(1); // below minHistoryMonthsForNextMonth

    expect(report.nextCalendarMonthForecast.hasData).toBe(false);
    expect(report.nextCalendarMonthForecast.categories).toEqual([]);
    expect(report.nextCalendarMonthForecast.categoriesReasonCode).toBe(RULES.reasonCodes.noCategoryBreakdown);
  });

  it("reports a descriptive data-quality summary without any accuracy claim", () => {
    const limited = analyzeWith(3);
    const sufficient = analyzeWith(8);

    expect(limited.dataQuality.status).toBe(RULES.dataQuality.statuses.limited);
    expect(limited.dataQuality.warnings).toContain(RULES.dataQuality.warnings.limitedHistory);
    expect(sufficient.dataQuality.status).toBe(RULES.dataQuality.statuses.sufficient);
    expect(sufficient.dataQuality.completedMonths).toBe(8);
    expect(sufficient.dataQuality.activeDays).toBeGreaterThan(0);

    // Nothing anywhere in the contract claims a measured accuracy.
    expect(JSON.stringify(sufficient)).not.toMatch(/accuracy|confidenceScore|precisionScore/i);
  });

  // Corrected: `targetMonth` is the NEXT calendar month after the anchor,
  // which is what nextCalendarMonthForecast actually predicts. The anchor
  // month (2026-08) is what the LEGACY nextMonthForecast projects, and that
  // field keeps its own unchanged behavior -- see
  // tests/analytics.nextCalendarForecast.test.js for both.
  it("labels the target month as the next calendar month after the anchor", () => {
    expect(analyzeWith(6).targetMonth).toBe("2026-09");
  });

  it("flags a calendar gap in history as an explicit warning", () => {
    const pool = [
      expense(1, 500, "Food"),
      expense(2, 500, "Food"),
      // month 3 deliberately missing
      expense(4, 500, "Food"),
      expense(5, 500, "Food"),
    ];
    const { buildCompletedMonthSeries } = require("../analytics/forecastInputAggregator");

    const report = forecastAnalyzer.analyze({
      monthlySeries: buildCompletedMonthSeries(pool, MONTH_START),
      currentPartialMonthTotal: 0,
      currentMonthStart: MONTH_START,
      categorySeries: buildCompletedMonthCategorySeries(pool, MONTH_START),
      activeDays: countActiveDays(pool, MONTH_START),
    });

    expect(report.dataQuality.warnings).toContain(RULES.dataQuality.warnings.historyGaps);
  });

  it("remains fully backward compatible when the new inputs are omitted", () => {
    const { buildCompletedMonthSeries } = require("../analytics/forecastInputAggregator");
    const pool = buildPool(6);

    expect(() =>
      forecastAnalyzer.analyze({
        monthlySeries: buildCompletedMonthSeries(pool, MONTH_START),
        currentPartialMonthTotal: 0,
        currentMonthStart: MONTH_START,
      })
    ).not.toThrow();

    const report = forecastAnalyzer.analyze({
      monthlySeries: buildCompletedMonthSeries(pool, MONTH_START),
      currentPartialMonthTotal: 0,
      currentMonthStart: MONTH_START,
    });

    expect(report.nextCalendarMonthForecast.hasData).toBe(true);
    expect(report.nextCalendarMonthForecast.categories).toEqual([]);
  });
});
