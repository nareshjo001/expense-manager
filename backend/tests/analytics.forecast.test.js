// Forecasting V2: isolated characterization of the pure, deterministic
// forecastAnalyzer.analyze() contract.
//
// Architecture-closure correction: forecastAnalyzer.js's public input
// contract changed from raw transaction pools (`recentExpensePool`,
// `currentMonthExpenses`) to an already-aggregated series (`monthlySeries`,
// `currentPartialMonthTotal`) -- see analytics/forecastInputAggregator.js
// and tests/analytics.forecastInputAggregator.test.js for the aggregation
// boundary itself. These tests prove forecastAnalyzer.js's own math and
// contract in isolation, using plain `{ monthKey, totalAmount }` series
// directly -- and separately prove it has no code path capable of reading
// transaction-shaped fields even if one leaked in.
"use strict";

const { analyze, fitRobustTrend } = require("../analytics/analyzers/forecastAnalyzer");
const { forecast: RULES } = require("../analytics/analyzers/scores/forecastRules");

const CURRENT_MONTH_START = new Date(2026, 7, 1); // August 2026, local time

// Real `${year}-${monthIndex}` monthKeys, exactly the shape
// analytics/forecastInputAggregator.js produces and
// forecastAnalyzer.js's monthKeyToOrdinal() parses -- required now that
// the analyzer fits its trend against real calendar-month ordinals rather
// than array position (see the calendar-gap fix below). `monthsAgo` counts
// back from CURRENT_MONTH_START (1 = the most recent complete month).
function monthKeyMonthsAgo(monthsAgo) {
  const d = new Date(CURRENT_MONTH_START.getFullYear(), CURRENT_MONTH_START.getMonth() - monthsAgo, 1);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

// Builds a chronological (oldest-first), CONTIGUOUS (no calendar gaps)
// monthlySeries of `count` months, each with `amount` (constant history --
// "stable spending").
function stableSeries(count, amount) {
  const entries = [];
  for (let monthsAgo = count; monthsAgo >= 1; monthsAgo -= 1) {
    entries.push({ monthKey: monthKeyMonthsAgo(monthsAgo), totalAmount: amount });
  }
  return entries;
}

// `amounts` given oldest-first, mapped onto `amounts.length` CONTIGUOUS
// (no calendar gaps) months ending at the most recent complete month.
function seriesFromAmounts(amounts) {
  const count = amounts.length;
  return amounts.map((amount, index) => ({ monthKey: monthKeyMonthsAgo(count - index), totalAmount: amount }));
}

describe("backend/analytics/analyzers/forecastAnalyzer -- aggregate-input boundary", () => {
  it("has no code path that reads transaction-shaped fields -- a leaked raw record contributes nothing but its numeric totalAmount", () => {
    const leaked = {
      // The exact monthKey stableSeries(3, ...) would have generated for
      // its 3rd (most recent, monthsAgo=1) entry -- dropped by slice(0, 2)
      // below and reintroduced here with extra transaction-shaped fields.
      monthKey: monthKeyMonthsAgo(1),
      totalAmount: 1000,
      _id: "should-not-be-read",
      userId: "should-not-be-read",
      expenseName: "should-not-be-read",
      expenseCategory: "should-not-be-read",
      expenseDate: new Date(2026, 6, 15),
    };
    const cleanSeries = stableSeries(3, 1000);
    const withLeakedEntry = [...cleanSeries.slice(0, 2), leaked];

    const cleanResult = analyze({ monthlySeries: cleanSeries, currentMonthStart: CURRENT_MONTH_START });
    const leakedResult = analyze({ monthlySeries: withLeakedEntry, currentMonthStart: CURRENT_MONTH_START });

    // Identical output proves only `.totalAmount` was ever read -- the
    // extra transaction-shaped fields on the third entry had zero effect.
    expect(leakedResult).toEqual(cleanResult);
    expect(JSON.stringify(leakedResult)).not.toMatch(/should-not-be-read/);
  });

  it("entries lacking a valid monthKey/totalAmount are silently dropped, not thrown", () => {
    const series = [
      null,
      undefined,
      42,
      { monthKey: "not-a-real-calendar-key" }, // unparseable monthKey, missing totalAmount
      { totalAmount: 1000 }, // missing monthKey entirely
      { monthKey: monthKeyMonthsAgo(4), totalAmount: "not-a-number" }, // unparseable amount
      { monthKey: monthKeyMonthsAgo(1), totalAmount: 1000 },
      { monthKey: monthKeyMonthsAgo(2), totalAmount: 1000 },
      { monthKey: monthKeyMonthsAgo(3), totalAmount: 1000 },
    ];
    expect(() => analyze({ monthlySeries: series, currentMonthStart: CURRENT_MONTH_START })).not.toThrow();
    const result = analyze({ monthlySeries: series, currentMonthStart: CURRENT_MONTH_START });
    expect(result.historyMonthsAvailable).toBe(3);
  });

  it("an entry whose monthKey does not parse into a real calendar-month ordinal is dropped as malformed", () => {
    const series = [
      { monthKey: monthKeyMonthsAgo(1), totalAmount: 1000 },
      { monthKey: monthKeyMonthsAgo(2), totalAmount: 1000 },
      { monthKey: "abc-def", totalAmount: 1000 },
      { monthKey: "2026", totalAmount: 1000 },
      { monthKey: "", totalAmount: 1000 },
    ];
    const result = analyze({ monthlySeries: series, currentMonthStart: CURRENT_MONTH_START });
    expect(result.historyMonthsAvailable).toBe(2);
  });

  it("caps accepted history to RULES.maxHistoryMonths even if a caller passes a longer series", () => {
    const oversized = stableSeries(RULES.maxHistoryMonths + 5, 1000);
    const result = analyze({ monthlySeries: oversized, currentMonthStart: CURRENT_MONTH_START });
    expect(result.historyMonthsAvailable).toBe(RULES.maxHistoryMonths);
  });
});

describe("backend/analytics/analyzers/forecastAnalyzer -- insufficient history", () => {
  it("returns hasData:false with the correct reason codes when there is no history at all", () => {
    const result = analyze({ monthlySeries: [], currentPartialMonthTotal: 0, currentMonthStart: CURRENT_MONTH_START });

    expect(result.hasData).toBe(false);
    expect(result.historyMonthsAvailable).toBe(0);
    expect(result.nextMonthForecast.reasonCode).toBe("INSUFFICIENT_HISTORY_FOR_NEXT_MONTH");
    expect(result.nextQuarterForecast.reasonCode).toBe("INSUFFICIENT_HISTORY_FOR_NEXT_QUARTER");
    expect(result.nextYearForecast.reasonCode).toBe("INSUFFICIENT_HISTORY_FOR_NEXT_YEAR");
  });

  it("handles completely missing input without throwing", () => {
    expect(() => analyze({})).not.toThrow();
    expect(() => analyze()).not.toThrow();
    expect(analyze().hasData).toBe(false);
  });

  it("does not compute nextMonthForecast with exactly two complete months (below the 3-month minimum)", () => {
    const result = analyze({ monthlySeries: stableSeries(2, 1000), currentMonthStart: CURRENT_MONTH_START });
    expect(result.nextMonthForecast.hasData).toBe(false);
    expect(result.historyMonthsAvailable).toBe(2);
  });

  it("computes nextMonthForecast at exactly the 3-month minimum, but not nextYearForecast (needs 6)", () => {
    const result = analyze({ monthlySeries: stableSeries(3, 1000), currentMonthStart: CURRENT_MONTH_START });
    expect(result.nextMonthForecast.hasData).toBe(true);
    expect(result.nextQuarterForecast.hasData).toBe(true);
    expect(result.nextYearForecast.hasData).toBe(false);
    expect(result.nextYearForecast.reasonCode).toBe("INSUFFICIENT_HISTORY_FOR_NEXT_YEAR");
  });

  it("computes all three horizons once 6 complete months of history exist", () => {
    const result = analyze({ monthlySeries: stableSeries(6, 1000), currentMonthStart: CURRENT_MONTH_START });
    expect(result.nextMonthForecast.hasData).toBe(true);
    expect(result.nextQuarterForecast.hasData).toBe(true);
    expect(result.nextYearForecast.hasData).toBe(true);
  });
});

// fitRobustTrend() now fits against real calendar-month ordinals, not
// array position -- these "exact math" tests build simple, explicitly
// contiguous integer-ordinal points (0, 1, 2, ...) so the arithmetic stays
// easy to hand-verify, while the calendar-gap-specific tests below use
// real, non-contiguous monthKey-derived ordinals.
function pointsFromTotals(totals) {
  return totals.map((total, ordinal) => ({ ordinal, total }));
}

describe("backend/analytics/analyzers/forecastAnalyzer -- fitRobustTrend exact math", () => {
  it("a perfectly flat series fits slope=0, intercept=level, residualMad=0", () => {
    const { slope, intercept, residualMad } = fitRobustTrend(pointsFromTotals([2000, 2000, 2000, 2000, 2000, 2000]));
    expect(slope).toBe(0);
    expect(intercept).toBe(2000);
    expect(residualMad).toBe(0);
  });

  it("a perfectly linear upward series fits the exact slope and intercept (Theil-Sen on a perfect line is exact)", () => {
    // 1000, 1200, 1400, 1600, 1800, 2000 (oldest -> newest), step +200/month
    const { slope, intercept, residualMad } = fitRobustTrend(pointsFromTotals([1000, 1200, 1400, 1600, 1800, 2000]));
    expect(slope).toBe(200);
    expect(intercept).toBe(1000);
    expect(residualMad).toBe(0);
  });

  it("a perfectly linear downward series fits the exact negative slope", () => {
    const { slope, intercept } = fitRobustTrend(pointsFromTotals([2000, 1800, 1600, 1400, 1200, 1000]));
    expect(slope).toBe(-200);
    expect(intercept).toBe(2000);
  });

  it("a single mid-series outlier does not move the fitted slope off zero for an otherwise-flat series", () => {
    // 1000, 50000, 1000, 1000, 1000, 1000 -- matches the exact pool used in
    // the "large outliers" describe block below.
    const { slope, intercept } = fitRobustTrend(pointsFromTotals([1000, 50000, 1000, 1000, 1000, 1000]));
    expect(slope).toBe(0);
    expect(intercept).toBe(1000);
  });

  it("CALENDAR-GAP PROOF: January=1000, February MISSING, March=1400 fits the true 200/month rate (2 calendar months apart), not the wrong 400/month an index-based fit would give", () => {
    // Real calendar ordinals: January and March are 2 apart, not 1 --
    // exactly the January/February(missing)/March example this proof was
    // requested against.
    const january = { ordinal: 0, total: 1000 };
    const march = { ordinal: 2, total: 1400 }; // February (ordinal 1) has no entry at all
    const { slope, intercept } = fitRobustTrend([january, march]);

    // The ONLY two-point slope possible: (1400-1000)/(2-0) = 200, never
    // (1400-1000)/(1-0) = 400 (which is what treating them as adjacent
    // array positions would incorrectly produce).
    expect(slope).toBe(200);
    expect(intercept).toBe(1000); // total - slope*ordinal = 1000 - 200*0 = 1000, consistent for both points
  });
});

describe("backend/analytics/analyzers/forecastAnalyzer -- calendar-gap end-to-end regression (analyze())", () => {
  // Extends the task's exact example (January=1000, February MISSING,
  // March=1400, anchor=April) with one earlier point (December=800) so
  // historyMonthsUsed reaches the 3-month minimum for nextMonthForecast/
  // nextQuarterForecast to actually compute -- the example alone only has
  // 2 real data points (Jan, Mar), which correctly reports insufficient
  // history (proven in the dedicated test below), not a wrong number.
  const ANCHOR_APRIL = new Date(2026, 3, 1); // April 2026, local time
  const seriesWithGap = [
    { monthKey: "2025-11", totalAmount: 800 }, // December 2025 (4 months before anchor)
    { monthKey: "2026-0", totalAmount: 1000 }, // January 2026 (3 months before anchor)
    // February 2026 ("2026-1") has NO entry -- omitted, not zero-filled.
    { monthKey: "2026-2", totalAmount: 1400 }, // March 2026 (1 month before anchor)
  ];

  it("1) the exact aggregate series received by forecastAnalyzer omits February entirely", () => {
    const monthKeys = seriesWithGap.map((e) => e.monthKey);
    expect(monthKeys).toEqual(["2025-11", "2026-0", "2026-2"]);
    expect(monthKeys).not.toContain("2026-1"); // February
  });

  it("2) historyMonthsAvailable counts only the 3 months with real data -- February is neither zero nor counted", () => {
    const result = analyze({ monthlySeries: seriesWithGap, currentMonthStart: ANCHOR_APRIL });
    expect(result.historyMonthsAvailable).toBe(3);
  });

  it("3) the January/February(missing)/March example ALONE (no December point) correctly reports insufficient history rather than a wrong 2-point estimate", () => {
    const result = analyze({
      monthlySeries: [
        { monthKey: "2026-0", totalAmount: 1000 }, // January
        { monthKey: "2026-2", totalAmount: 1400 }, // March
      ],
      currentMonthStart: ANCHOR_APRIL,
    });
    expect(result.historyMonthsAvailable).toBe(2);
    expect(result.nextMonthForecast.hasData).toBe(false);
    expect(result.nextMonthForecast.reasonCode).toBe("INSUFFICIENT_HISTORY_FOR_NEXT_MONTH");
  });

  it("4) with enough history (December added), nextMonthForecast reflects the true 200/month calendar rate through the gap -- not a naive 400/month adjacent-index rate", () => {
    const result = analyze({ monthlySeries: seriesWithGap, currentMonthStart: ANCHOR_APRIL });

    expect(result.nextMonthForecast.hasData).toBe(true);
    // Hand-verified: slope=200/month (Theil-Sen on Dec/Jan/Mar's real
    // calendar ordinals, all three pairwise slopes are exactly 200),
    // intercept=800, anchor (April) is 4 calendar months after December ->
    // estimate = 800 + 200*4 = 1600. A naive index-adjacent fit (treating
    // Dec,Jan,Mar as positions 0,1,2) would instead compute slope=300 and
    // a wrong estimate of 1700 -- this assertion fails under that bug.
    expect(result.nextMonthForecast.estimate).toBe(1600);
  });

  it("5) nextQuarterForecast sums three real per-month calendar-correct projections, not a multiplication shortcut", () => {
    const result = analyze({ monthlySeries: seriesWithGap, currentMonthStart: ANCHOR_APRIL });
    // April=1600, May=1800, June=2000 -> sum = 5400.
    expect(result.nextQuarterForecast.estimate).toBe(5400);
  });

  it("6) duplicate records within one month aggregate exactly once before reaching the analyzer (proven at the aggregator boundary -- see tests/analytics.forecastInputAggregator.test.js)", () => {
    // forecastAnalyzer.js itself also defends against a duplicate monthKey
    // reaching it directly (defense in depth) by summing same-ordinal
    // entries rather than only keeping one.
    const duplicated = [
      { monthKey: "2026-0", totalAmount: 600 },
      { monthKey: "2026-0", totalAmount: 400 }, // same month, split across two entries
      { monthKey: "2026-1", totalAmount: 1000 },
      { monthKey: "2026-2", totalAmount: 1000 },
    ];
    const result = analyze({ monthlySeries: duplicated, currentMonthStart: ANCHOR_APRIL });
    // 3 distinct months (Jan merged to 1000, Feb 1000, Mar 1000) -- not 4.
    expect(result.historyMonthsAvailable).toBe(3);
    expect(result.nextMonthForecast.estimate).toBe(1000); // flat, once merged
  });

  it("7) reordered records produce identical output at the analyzer level too, regardless of monthlySeries array order", () => {
    const reordered = [seriesWithGap[2], seriesWithGap[0], seriesWithGap[1]];
    const resultA = analyze({ monthlySeries: seriesWithGap, currentMonthStart: ANCHOR_APRIL });
    const resultB = analyze({ monthlySeries: reordered, currentMonthStart: ANCHOR_APRIL });
    expect(resultB).toEqual(resultA);
  });

  it("8) the current partial April amount never enters completed-month trend fitting", () => {
    const withoutPartial = analyze({ monthlySeries: seriesWithGap, currentMonthStart: ANCHOR_APRIL, currentPartialMonthTotal: 0 });
    const withHugePartial = analyze({
      monthlySeries: seriesWithGap,
      currentMonthStart: ANCHOR_APRIL,
      currentPartialMonthTotal: 999999,
    });
    expect(withHugePartial.nextMonthForecast.estimate).toBe(withoutPartial.nextMonthForecast.estimate);
    expect(withHugePartial.currentPartialMonth.totalSoFar).toBe(999999);
    expect(withHugePartial.currentPartialMonth.included).toBe(false);
  });

  it("9) future indices begin at the anchor month's own ordinal (April), immediately after the latest POSSIBLE completed month (March) -- not merely after however many data points exist", () => {
    // A gap directly adjacent to the anchor month (March itself missing,
    // only Dec/Jan/Feb present) must still project starting at April, not
    // silently slide forward to "one month after the last data point."
    const gapRightBeforeAnchor = [
      { monthKey: "2025-10", totalAmount: 700 }, // November 2025
      { monthKey: "2025-11", totalAmount: 900 }, // December 2025
      { monthKey: "2026-0", totalAmount: 1100 }, // January 2026
      // February ("2026-1") and March ("2026-2") both missing.
    ];
    const result = analyze({ monthlySeries: gapRightBeforeAnchor, currentMonthStart: ANCHOR_APRIL });

    expect(result.historyMonthsAvailable).toBe(3);
    expect(result.nextMonthForecast.hasData).toBe(true);

    // Structural proof that the projection starts at April (the anchor),
    // not at "one month after January" (the last data point): compare
    // against a second series with the identical Nov/Dec/Jan data but a
    // DIFFERENT anchor month (May instead of April). If the horizon start
    // tracked "last data point + 1" instead of the real anchor, both
    // would produce the same nextMonthForecast -- they must not.
    const anchorMay = new Date(2026, 4, 1);
    const resultMay = analyze({ monthlySeries: gapRightBeforeAnchor, currentMonthStart: anchorMay });
    expect(resultMay.nextMonthForecast.estimate).not.toBe(result.nextMonthForecast.estimate);
  });

  it("10) missing-month behaviour is centrally documented in forecastInputAggregator.js and deterministic across repeated calls", () => {
    const first = analyze({ monthlySeries: seriesWithGap, currentMonthStart: ANCHOR_APRIL });
    const second = analyze({ monthlySeries: seriesWithGap, currentMonthStart: ANCHOR_APRIL });
    expect(second).toEqual(first);
  });

  it("11) no raw transaction fields reach the analyzer -- the gap series carries none, and the output never mentions any", () => {
    const result = analyze({ monthlySeries: seriesWithGap, currentMonthStart: ANCHOR_APRIL });
    const serialized = JSON.stringify(result);
    for (const forbidden of ["_id", "userId", "expenseName", "expenseCategory", "expenseDate"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("backend/analytics/analyzers/forecastAnalyzer -- stable spending", () => {
  it("produces an estimate equal to the constant monthly amount, with a zero-width range (MAD=0)", () => {
    const result = analyze({ monthlySeries: stableSeries(6, 2000), currentMonthStart: CURRENT_MONTH_START });

    expect(result.nextMonthForecast.estimate).toBe(2000);
    expect(result.nextMonthForecast.range).toEqual({ lower: 2000, upper: 2000 });
    expect(result.nextQuarterForecast.estimate).toBe(6000);
    expect(result.nextYearForecast.estimate).toBe(24000);
  });
});

describe("backend/analytics/analyzers/forecastAnalyzer -- directional trend (exact assertions)", () => {
  // Oldest -> newest: 1000, 1200, 1400, 1600, 1800, 2000. Perfectly linear,
  // so Theil-Sen recovers the exact slope (200/month) and intercept (1000)
  // -- see the fitRobustTrend exact-math tests above. nextMonthForecast
  // projects index 6: 1000 + 200*6 = 2200.
  const upwardSeries = seriesFromAmounts([1000, 1200, 1400, 1600, 1800, 2000]);
  // Same six values, reversed chronologically (declining 2000 -> 1000):
  // slope=-200, intercept=2000, index 6: 2000 - 200*6 = 800.
  const downwardSeries = seriesFromAmounts([2000, 1800, 1600, 1400, 1200, 1000]);
  // Flat series at 1500 -- the exact median/mean of the six trend values
  // above, so this isolates "same central level, no trend" as the
  // comparison baseline the task requires.
  const flatSameLevelSeries = stableSeries(6, 1500);

  it("an upward trend produces the exact expected higher estimate", () => {
    const result = analyze({ monthlySeries: upwardSeries, currentMonthStart: CURRENT_MONTH_START });
    expect(result.nextMonthForecast.estimate).toBe(2200);
  });

  it("a downward trend produces the exact expected lower estimate", () => {
    const result = analyze({ monthlySeries: downwardSeries, currentMonthStart: CURRENT_MONTH_START });
    expect(result.nextMonthForecast.estimate).toBe(800);
  });

  it("upward trend estimate is meaningfully higher than a flat series at the same central level (1500)", () => {
    const upward = analyze({ monthlySeries: upwardSeries, currentMonthStart: CURRENT_MONTH_START });
    const flat = analyze({ monthlySeries: flatSameLevelSeries, currentMonthStart: CURRENT_MONTH_START });

    expect(flat.nextMonthForecast.estimate).toBe(1500);
    expect(upward.nextMonthForecast.estimate).toBeGreaterThan(flat.nextMonthForecast.estimate);
    expect(upward.nextMonthForecast.estimate - flat.nextMonthForecast.estimate).toBe(700);
  });

  it("downward trend estimate is meaningfully lower than a flat series at the same central level (1500)", () => {
    const downward = analyze({ monthlySeries: downwardSeries, currentMonthStart: CURRENT_MONTH_START });
    const flat = analyze({ monthlySeries: flatSameLevelSeries, currentMonthStart: CURRENT_MONTH_START });

    expect(downward.nextMonthForecast.estimate).toBeLessThan(flat.nextMonthForecast.estimate);
    expect(flat.nextMonthForecast.estimate - downward.nextMonthForecast.estimate).toBe(700);
  });

  it("a downward trend produces a lower estimate than a flat-high history of the same peak magnitude", () => {
    const downwardResult = analyze({ monthlySeries: downwardSeries, currentMonthStart: CURRENT_MONTH_START });
    const flatHighResult = analyze({ monthlySeries: stableSeries(6, 2000), currentMonthStart: CURRENT_MONTH_START });
    expect(downwardResult.nextMonthForecast.estimate).toBeLessThan(flatHighResult.nextMonthForecast.estimate);
  });

  it("quarter/year estimates are the sum of per-month trend projections, not a naive single-month multiplication -- upward trend's quarter total exceeds 3x its own next-month estimate", () => {
    const result = analyze({ monthlySeries: upwardSeries, currentMonthStart: CURRENT_MONTH_START });
    // Month indices 6,7,8: (1000+200*6)+(1000+200*7)+(1000+200*8) = 2200+2400+2600 = 7200.
    expect(result.nextQuarterForecast.estimate).toBe(7200);
    // A naive "multiply the next-month estimate by 3" would give 6600 --
    // proving the quarter figure is NOT that.
    expect(result.nextQuarterForecast.estimate).not.toBe(result.nextMonthForecast.estimate * 3);
    expect(result.nextQuarterForecast.estimate).toBeGreaterThan(result.nextMonthForecast.estimate * 3);
  });
});

describe("backend/analytics/analyzers/forecastAnalyzer -- large outliers", () => {
  it("the trend fit is not dragged by a single extreme outlier month", () => {
    // Chronological (oldest -> newest): 1000, 50000, 1000, 1000, 1000, 1000.
    const pool = seriesFromAmounts([1000, 50000, 1000, 1000, 1000, 1000]);
    const result = analyze({ monthlySeries: pool, currentMonthStart: CURRENT_MONTH_START });
    expect(result.nextMonthForecast.estimate).toBe(1000);
  });
});

describe("backend/analytics/analyzers/forecastAnalyzer -- zero, negative, and invalid values", () => {
  it("includes a genuine negative-amount month (e.g. net refunds) in the aggregate rather than crashing", () => {
    const pool = seriesFromAmounts([-200, 1000, 1000]);
    expect(() => analyze({ monthlySeries: pool, currentMonthStart: CURRENT_MONTH_START })).not.toThrow();
  });

  it("never produces NaN or Infinity in any numeric output field", () => {
    const result = analyze({ monthlySeries: stableSeries(6, 0), currentMonthStart: CURRENT_MONTH_START });
    const check = (n) => expect(Number.isFinite(n)).toBe(true);
    check(result.nextMonthForecast.estimate);
    check(result.nextMonthForecast.range.lower);
    check(result.nextMonthForecast.range.upper);
    check(result.nextYearForecast.estimate);
  });

  it("floors a strongly negative trend projection at zero rather than returning a negative estimate", () => {
    // A steep decline that would project below zero by the horizon.
    const pool = seriesFromAmounts([6000, 4800, 3600, 2400, 1200, 0]);
    const result = analyze({ monthlySeries: pool, currentMonthStart: CURRENT_MONTH_START });
    expect(result.nextYearForecast.estimate).toBeGreaterThanOrEqual(0);
  });
});

describe("backend/analytics/analyzers/forecastAnalyzer -- range invariant", () => {
  it("0 <= lower <= estimate <= upper holds for stable, trending, and degenerate inputs", () => {
    const cases = [
      stableSeries(6, 0),
      stableSeries(6, 1500),
      seriesFromAmounts([1000, 1200, 1400, 1600, 1800, 2000]),
      seriesFromAmounts([2000, 1800, 1600, 1400, 1200, 1000]),
      seriesFromAmounts([100, 100, 5000]),
      seriesFromAmounts([6000, 4800, 3600, 2400, 1200, 0]),
    ];
    for (const series of cases) {
      const result = analyze({ monthlySeries: series, currentMonthStart: CURRENT_MONTH_START });
      for (const horizon of [result.nextMonthForecast, result.nextQuarterForecast, result.nextYearForecast]) {
        if (!horizon.hasData) continue;
        expect(horizon.range.lower).toBeGreaterThanOrEqual(0);
        expect(horizon.range.lower).toBeLessThanOrEqual(horizon.estimate);
        expect(horizon.estimate).toBeLessThanOrEqual(horizon.range.upper);
      }
    }
  });
});

describe("backend/analytics/analyzers/forecastAnalyzer -- current partial month representation", () => {
  it("reports the current partial month's total separately, and never folds it into history or estimates", () => {
    const result = analyze({
      monthlySeries: stableSeries(6, 1000),
      currentPartialMonthTotal: 500,
      currentMonthStart: CURRENT_MONTH_START,
    });

    expect(result.currentPartialMonth.included).toBe(false);
    expect(result.currentPartialMonth.totalSoFar).toBe(500);
    expect(result.nextMonthForecast.estimate).toBe(1000); // unaffected by the 500 partial-month figure
  });
});

describe("backend/analytics/analyzers/forecastAnalyzer -- determinism and purity", () => {
  it("repeated calls with the same input return equal results", () => {
    const input = { monthlySeries: stableSeries(6, 1234.56), currentMonthStart: CURRENT_MONTH_START };
    expect(analyze(input)).toEqual(analyze(input));
  });

  it("never mutates its inputs", () => {
    const series = Object.freeze(stableSeries(6, 1000).map((e) => Object.freeze(e)));
    expect(() => analyze({ monthlySeries: series, currentMonthStart: CURRENT_MONTH_START })).not.toThrow();
  });
});

describe("backend/analytics/analyzers/forecastAnalyzer -- output contract", () => {
  it("uses unrounded internal computation but only rounded public fields (2 decimal places)", () => {
    const result = analyze({
      monthlySeries: seriesFromAmounts([333.333, 111.111, 777.777]),
      currentMonthStart: CURRENT_MONTH_START,
    });
    const decimalsOf = (n) => (String(n).split(".")[1] || "").length;
    expect(decimalsOf(result.nextMonthForecast.estimate)).toBeLessThanOrEqual(2);
    expect(decimalsOf(result.nextMonthForecast.range.lower)).toBeLessThanOrEqual(2);
    expect(decimalsOf(result.nextMonthForecast.range.upper)).toBeLessThanOrEqual(2);
  });

  it("labels the method explicitly and never claims AI/ML/trained accuracy or seasonality", () => {
    const result = analyze({ monthlySeries: stableSeries(6, 1000), currentMonthStart: CURRENT_MONTH_START });

    expect(result.method).toBe("ROBUST_TREND_MEDIAN_V2");
    expect(result.nextMonthForecast.method).toBe(RULES.methodVersion);
    const serialized = JSON.stringify(result);
    expect(serialized.toLowerCase()).not.toMatch(/\bai\b|accuracy|trained|machine learning|seasonal/);
  });

  it("is deeply frozen at the rules level and mutation cannot alter later analyzer results", () => {
    expect(Object.isFrozen(RULES)).toBe(true);
    const before = analyze({ monthlySeries: stableSeries(6, 1000), currentMonthStart: CURRENT_MONTH_START });
    try {
      RULES.minHistoryMonthsForNextMonth = 999;
    } catch {
      // frozen -- throws in strict mode or silently no-ops, either is fine
    }
    expect(RULES.minHistoryMonthsForNextMonth).toBe(3);
    const after = analyze({ monthlySeries: stableSeries(6, 1000), currentMonthStart: CURRENT_MONTH_START });
    expect(after).toEqual(before);
  });
});
