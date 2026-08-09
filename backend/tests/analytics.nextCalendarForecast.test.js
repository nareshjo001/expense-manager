// Prediction Layer V1 remediation: true next-calendar-month forecast,
// legacy parity, and corrected category-timeline alignment.
//
// Two defects are guarded here:
//   A) Intermittent categories were built from ONLY the months they
//      appeared in, so 3 scattered observations across a 12-month active
//      timeline were treated as a complete category history.
//   B) The legacy `nextMonthForecast` field projects the CURRENT,
//      in-progress month despite its name. Prediction Layer V1 promises a
//      NEXT-calendar-month figure, so a distinct field was added rather
//      than the legacy one being relabelled.
//
// Legacy expectations below are STABLE FIXTURES captured from the
// committed d3f0011 behavior -- no test here shells out to Git.
"use strict";

const {
  buildCompletedMonthSeries,
  buildCompletedMonthCategorySeries,
  countActiveDays,
} = require("../analytics/forecastInputAggregator");
const forecastAnalyzer = require("../analytics/analyzers/forecastAnalyzer");
const { forecast: RULES } = require("../analytics/analyzers/scores/forecastRules");

const MONTH_START = new Date(2026, 7, 1); // Aug 2026 -> target Sep 2026

const expense = (monthsAgo, amount, category, day = 15) => ({
  expenseDate: new Date(2026, 7 - monthsAgo, day),
  expenseAmount: amount,
  expenseCategory: category,
});

function analyzePool(pool, { monthStart = MONTH_START, targetMonthBudget = null, partial = 0 } = {}) {
  return forecastAnalyzer.analyze({
    monthlySeries: buildCompletedMonthSeries(pool, monthStart),
    currentPartialMonthTotal: partial,
    currentMonthStart: monthStart,
    categorySeries: buildCompletedMonthCategorySeries(pool, monthStart),
    activeDays: countActiveDays(pool, monthStart),
    targetMonthBudget,
  });
}

// A strictly rising history: 6 completed months, +100 per month.
const risingPool = () => {
  const pool = [];
  for (let m = 1; m <= 6; m += 1) pool.push(expense(m, 1000 + (6 - m) * 100, "Food"));
  return pool;
};

describe("legacy v3 parity (stable fixtures from d3f0011)", () => {
  it("keeps the legacy current-month projection and its range byte-identical", () => {
    const report = analyzePool(risingPool(), { partial: 777 });

    // Captured from the committed d3f0011 analyzer for this exact input.
    expect(report.nextMonthForecast).toEqual({
      hasData: true,
      reasonCode: null,
      method: "ROBUST_TREND_MEDIAN_V2",
      estimate: 1600,
      range: { lower: 1600, upper: 1600 },
      historyMonthsUsed: 6,
      horizonMonths: 1,
    });
  });

  it("keeps the legacy quarter and year horizons unchanged, including gates and reason codes", () => {
    const report = analyzePool(risingPool());

    expect(report.nextQuarterForecast).toEqual({
      hasData: true,
      reasonCode: null,
      method: "ROBUST_TREND_MEDIAN_V2",
      estimate: 5100,
      range: { lower: 5100, upper: 5100 },
      historyMonthsUsed: 6,
      horizonMonths: 3,
    });
    expect(report.nextYearForecast.hasData).toBe(true);
    expect(report.nextYearForecast.horizonMonths).toBe(12);
  });

  it("keeps the legacy insufficient-history gate and reason code unchanged", () => {
    const pool = [expense(1, 500, "Food"), expense(2, 500, "Food")]; // 2 months < gate of 3
    const report = analyzePool(pool);

    expect(report.nextMonthForecast.hasData).toBe(false);
    expect(report.nextMonthForecast.reasonCode).toBe(RULES.reasonCodes.insufficientHistoryNextMonth);
    expect(report.nextMonthForecast.estimate).toBeNull();
  });

  it("no longer attaches category fields to the legacy horizon (they were never part of v3)", () => {
    const report = analyzePool(risingPool());

    expect(report.nextMonthForecast).not.toHaveProperty("categories");
    expect(report.nextMonthForecast).not.toHaveProperty("categoriesReasonCode");
  });

  it("keeps the legacy partial-month exclusion record unchanged", () => {
    const report = analyzePool(risingPool(), { partial: 4321 });

    expect(report.currentPartialMonth.included).toBe(false);
    expect(report.currentPartialMonth.totalSoFar).toBe(4321);
  });
});

describe("true next-calendar-month forecast", () => {
  it("is observably different from the legacy current-month projection on a rising trend", () => {
    const report = analyzePool(risingPool());

    // Legacy projects the anchor month; the true field projects one full
    // calendar month later, so a +100/month trend separates them by 100.
    expect(report.nextMonthForecast.estimate).toBe(1600);
    expect(report.nextCalendarMonthForecast.estimate).toBe(1700);
    expect(report.nextCalendarMonthForecast.estimate).not.toBe(report.nextMonthForecast.estimate);
  });

  it("targets the next calendar month, not the anchor month", () => {
    const report = analyzePool(risingPool());

    expect(report.targetMonth).toBe("2026-09");
    expect(report.nextCalendarMonthForecast.targetMonth).toBe("2026-09");
  });

  it("rolls December over into January of the following year", () => {
    const december = new Date(2026, 11, 1);
    const pool = [];
    for (let m = 1; m <= 6; m += 1) {
      pool.push({
        expenseDate: new Date(2026, 11 - m, 15),
        expenseAmount: 500,
        expenseCategory: "Food",
      });
    }

    const report = analyzePool(pool, { monthStart: december });

    expect(report.targetMonth).toBe("2027-01");
    expect(report.nextCalendarMonthForecast.targetMonth).toBe("2027-01");
  });

  it("excludes the current partial month from the estimate even though the target is farther ahead", () => {
    const base = risingPool();
    const withCurrentMonthSpending = [
      ...base,
      { expenseDate: new Date(2026, 7, 12), expenseAmount: 999999, expenseCategory: "Food" },
    ];

    const without = analyzePool(base);
    const with_ = analyzePool(withCurrentMonthSpending, { partial: 999999 });

    expect(with_.nextCalendarMonthForecast.estimate).toBe(without.nextCalendarMonthForecast.estimate);
  });

  it("excludes future-dated and invalid expenses", () => {
    const polluted = [
      ...risingPool(),
      { expenseDate: new Date(2027, 5, 1), expenseAmount: 500000, expenseCategory: "Food" },
      { expenseDate: "not-a-date", expenseAmount: 500000, expenseCategory: "Food" },
      { expenseDate: new Date(2026, 6, 3), expenseAmount: "abc", expenseCategory: "Food" },
      null,
    ];

    expect(analyzePool(polluted).nextCalendarMonthForecast.estimate).toBe(
      analyzePool(risingPool()).nextCalendarMonthForecast.estimate
    );
  });

  it("holds the range invariant 0 <= lower <= estimate <= upper", () => {
    const volatile = [];
    for (const [i, amount] of [9000, 100, 8000, 200, 7000, 300].entries()) {
      volatile.push(expense(6 - i, amount, "Food"));
    }
    const { estimate, range } = analyzePool(volatile).nextCalendarMonthForecast;

    expect(range.lower).toBeGreaterThanOrEqual(0);
    expect(range.lower).toBeLessThanOrEqual(estimate);
    expect(estimate).toBeLessThanOrEqual(range.upper);
  });

  it("reports insufficient history with the real reason and no invented number", () => {
    const report = analyzePool([expense(1, 500, "Food"), expense(2, 500, "Food")]);

    expect(report.nextCalendarMonthForecast.hasData).toBe(false);
    expect(report.nextCalendarMonthForecast.reasonCode).toBe(
      RULES.reasonCodes.insufficientHistoryNextMonth
    );
    expect(report.nextCalendarMonthForecast.estimate).toBeNull();
    expect(report.nextCalendarMonthForecast.categories).toEqual([]);
  });

  it("is deterministic across repeated runs", () => {
    const a = JSON.stringify(analyzePool(risingPool()));
    const b = JSON.stringify(analyzePool(risingPool()));
    expect(b).toBe(a);
  });
});

describe("category timeline alignment (Defect A)", () => {
  // 12 active months; "Rare" appears in only 3 scattered months.
  const intermittentPool = () => {
    const pool = [];
    for (let m = 1; m <= 12; m += 1) pool.push(expense(m, 1000, "Regular", 10));
    for (const m of [11, 6, 1]) pool.push(expense(m, 900, "Rare", 12));
    return pool;
  };

  it("zero-fills an intermittent category across the full canonical timeline", () => {
    const series = buildCompletedMonthCategorySeries(intermittentPool(), MONTH_START);
    const rare = series.find((entry) => entry.category === "Rare");
    const regular = series.find((entry) => entry.category === "Regular");

    // 12 aligned points, NOT 3 -- with 9 explicit zeros.
    expect(rare.monthlySeries).toHaveLength(12);
    expect(rare.monthlySeries.filter((point) => point.totalAmount === 0)).toHaveLength(9);
    expect(regular.monthlySeries).toHaveLength(12);
    expect(regular.monthlySeries.every((point) => point.totalAmount === 1000)).toBe(true);
  });

  it("never invents months outside the canonical timeline", () => {
    // Only 2 months of activity overall -> every category aligns to 2 points.
    const pool = [expense(1, 100, "Food"), expense(2, 50, "Travel")];
    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    for (const entry of series) {
      expect(entry.monthlySeries).toHaveLength(2);
    }
    // The current partial month is never one of them.
    const keys = series[0].monthlySeries.map((point) => point.monthKey);
    expect(keys).not.toContain("2026-7");
  });

  it("routes an intermittent category to the smoothed-share fallback, not its own trend", () => {
    const report = analyzePool(intermittentPool());
    const rare = report.nextCalendarMonthForecast.categories.find((c) => c.category === "Rare");
    const regular = report.nextCalendarMonthForecast.categories.find((c) => c.category === "Regular");

    expect(rare.method).toBe(RULES.category.methods.smoothedShare);
    expect(regular.method).toBe(RULES.category.methods.ownTrend);
  });

  it("no longer over-predicts the intermittent category, and still surfaces it as a real cost", () => {
    const report = analyzePool(intermittentPool());
    const rare = report.nextCalendarMonthForecast.categories.find((c) => c.category === "Rare");

    // Before the fix this was ~473 (2.1x the honest 900*3/12 = 225 mean),
    // because 3 scattered observations were treated as a dense history.
    expect(rare.predictedAmount).toBeLessThan(300);
    // ...but it is not silently zeroed out either -- it is a real recurring cost.
    expect(rare.predictedAmount).toBeGreaterThan(0);
  });

  it("includes zero-share months in the sparse category's smoothed average", () => {
    // "Occasional" appears only in the OLDEST of 6 active months, so every
    // month in the trailing smoothing window contributes a 0% share.
    const pool = [];
    for (let m = 1; m <= 6; m += 1) pool.push(expense(m, 1000, "Regular", 10));
    pool.push(expense(6, 1000, "Occasional", 12));

    const report = analyzePool(pool);
    const occasional = report.nextCalendarMonthForecast.categories.find(
      (c) => c.category === "Occasional"
    );

    expect(occasional.method).toBe(RULES.category.methods.smoothedShare);
    // Zero-share months drag the average right down; without them this
    // would have been allocated a ~50% share.
    expect(occasional.sharePercentage).toBeLessThan(10);
  });

  it("keeps categories dynamic, non-negative and deterministic", () => {
    const pool = [];
    for (let m = 1; m <= 6; m += 1) {
      pool.push(expense(m, 500, "Pet Grooming", 5));
      pool.push(expense(m, 300, "Stationery", 6));
    }

    const first = analyzePool(pool).nextCalendarMonthForecast.categories;
    const second = analyzePool(pool).nextCalendarMonthForecast.categories;

    expect(first.map((c) => c.category).sort()).toEqual(["Pet Grooming", "Stationery"]);
    expect(first.every((c) => c.predictedAmount >= 0)).toBe(true);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("reconciles category amounts EXACTLY to nextCalendarMonthForecast.estimate, not the legacy value", () => {
    const report = analyzePool(intermittentPool());
    const sum = Number(
      report.nextCalendarMonthForecast.categories
        .reduce((total, c) => total + c.predictedAmount, 0)
        .toFixed(2)
    );

    expect(sum).toBe(report.nextCalendarMonthForecast.estimate);
    // And the legacy value is a genuinely different number on this data,
    // so the assertion above cannot pass by coincidence.
    const rising = analyzePool(risingPool());
    const risingSum = Number(
      rising.nextCalendarMonthForecast.categories
        .reduce((total, c) => total + c.predictedAmount, 0)
        .toFixed(2)
    );
    expect(risingSum).toBe(rising.nextCalendarMonthForecast.estimate);
    expect(risingSum).not.toBe(rising.nextMonthForecast.estimate);
  });
});

describe("forecast budget risk uses only the exact target-month budget", () => {
  it("ignores a current-month budget entirely and uses the next-month one", () => {
    // Target month is 2026-09; a 2026-08 budget must have no influence.
    const withTargetBudget = analyzePool(risingPool(), { targetMonthBudget: { budget: 2000 } });

    expect(withTargetBudget.budgetRisk.budgetAmount).toBe(2000);
    // 1700 / 2000 = 85% -> watch tier.
    expect(withTargetBudget.budgetRisk.predictedUtilizationPercentage).toBe(85);
    expect(withTargetBudget.budgetRisk.status).toBe(RULES.budgetRisk.statuses.watch);
    // Computed against the TRUE next-calendar estimate (1700), not the
    // legacy current-month projection (1600 -> would be 80%).
    expect(withTargetBudget.budgetRisk.predictedRemaining).toBe(300);
  });

  it("returns no_budget when the target month has no budget", () => {
    expect(analyzePool(risingPool(), { targetMonthBudget: null }).budgetRisk.status).toBe(
      RULES.budgetRisk.statuses.noBudget
    );
  });

  it("returns no_budget for an invalid or zero target-month budget", () => {
    expect(analyzePool(risingPool(), { targetMonthBudget: { budget: 0 } }).budgetRisk.status).toBe(
      RULES.budgetRisk.statuses.noBudget
    );
    expect(analyzePool(risingPool(), { targetMonthBudget: { budget: "abc" } }).budgetRisk.status).toBe(
      RULES.budgetRisk.statuses.noBudget
    );
  });

  it("returns insufficient_data when the next-calendar forecast is unavailable", () => {
    const thin = analyzePool([expense(1, 500, "Food")], { targetMonthBudget: { budget: 5000 } });

    expect(thin.nextCalendarMonthForecast.hasData).toBe(false);
    expect(thin.budgetRisk.status).toBe(RULES.budgetRisk.statuses.insufficientData);
  });
});
