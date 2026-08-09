// Prediction Layer V1: forecast-vs-budget risk regression suite.
//
// The central guarantees under test:
//   1. The tier boundaries are NOT a second copy -- they are derived from
//      budgetAnalyzer.js's own exported STATUS_THRESHOLDS, so the two can
//      never silently drift. The final test here fails the moment someone
//      changes a boundary in one place only.
//   2. A next-month forecast is NEVER compared against a budget the user
//      did not create for that month (this repository's budget model has no
//      recurring/reusable monthly budget).
"use strict";

const forecastBudgetRisk = require("../analytics/analyzers/forecastBudgetRisk");
const budgetAnalyzer = require("../analytics/analyzers/budgetAnalyzer");
const { forecast: RULES } = require("../analytics/analyzers/scores/forecastRules");

const STATUSES = RULES.budgetRisk.statuses;

describe("forecastBudgetRisk -- target-month budget semantics", () => {
  it("returns no_budget when the user has not created a budget for the target month", () => {
    const result = forecastBudgetRisk.evaluate({ predictedTotal: 5000, targetMonthBudget: null });

    expect(result.status).toBe(STATUSES.noBudget);
    expect(result.budgetAmount).toBeNull();
    expect(result.predictedUtilizationPercentage).toBeNull();
    expect(result.predictedRemaining).toBeNull();
  });

  it("treats a zero or negative budget as no_budget, never as an instantly-exceeded 0 limit", () => {
    expect(forecastBudgetRisk.evaluate({ predictedTotal: 100, targetMonthBudget: { budget: 0 } }).status).toBe(
      STATUSES.noBudget
    );
    expect(forecastBudgetRisk.evaluate({ predictedTotal: 100, targetMonthBudget: { budget: -5 } }).status).toBe(
      STATUSES.noBudget
    );
  });

  it("treats a non-numeric budget as no_budget rather than coercing it", () => {
    expect(
      forecastBudgetRisk.evaluate({ predictedTotal: 100, targetMonthBudget: { budget: "abc" } }).status
    ).toBe(STATUSES.noBudget);
  });

  it("returns insufficient_data when there is no usable prediction, even with a real budget", () => {
    const result = forecastBudgetRisk.evaluate({ predictedTotal: null, targetMonthBudget: { budget: 9000 } });

    expect(result.status).toBe(STATUSES.insufficientData);
    expect(result.budgetAmount).toBeNull();
  });
});

describe("forecastBudgetRisk -- status tiers", () => {
  const at = (utilizationPercent, budget = 1000) =>
    forecastBudgetRisk.evaluate({
      predictedTotal: (utilizationPercent / 100) * budget,
      targetMonthBudget: { budget },
    });

  it("maps comfortably-within-budget predictions to safe", () => {
    expect(at(10).status).toBe(STATUSES.safe);
    expect(at(70).status).toBe(STATUSES.safe); // inclusive upper edge
  });

  it("maps close-to-the-limit predictions to watch", () => {
    expect(at(70.01).status).toBe(STATUSES.watch);
    expect(at(90).status).toBe(STATUSES.watch);
  });

  it("maps at-or-over-limit predictions to high", () => {
    expect(at(90.01).status).toBe(STATUSES.high);
    expect(at(100).status).toBe(STATUSES.high);
    expect(at(180).status).toBe(STATUSES.high);
  });

  it("reports a signed remaining figure, negative when the prediction exceeds the budget", () => {
    const under = forecastBudgetRisk.evaluate({ predictedTotal: 800, targetMonthBudget: { budget: 1000 } });
    const over = forecastBudgetRisk.evaluate({ predictedTotal: 1300, targetMonthBudget: { budget: 1000 } });

    expect(under.predictedRemaining).toBe(200);
    expect(under.predictedUtilizationPercentage).toBe(80);
    // Never clamped to zero -- an over-budget projection says so plainly.
    expect(over.predictedRemaining).toBe(-300);
    expect(over.predictedUtilizationPercentage).toBe(130);
  });
});

describe("forecastBudgetRisk -- threshold reuse (drift guard)", () => {
  it("derives its tiers from budgetAnalyzer's own exported thresholds", () => {
    // Not a restatement of the numbers: this walks budgetAnalyzer's real
    // exported table and asserts the forecast status agrees with the
    // budget status at every boundary it defines. Changing a boundary in
    // budgetAnalyzer.js alone will fail this test.
    const expectedForecastStatus = {
      Safe: STATUSES.safe,
      Warning: STATUSES.watch,
      Critical: STATUSES.high,
      Overspent: STATUSES.high,
    };

    for (const tier of budgetAnalyzer.STATUS_THRESHOLDS) {
      if (!Number.isFinite(tier.max)) continue;
      const budget = 1000;
      const atBoundary = forecastBudgetRisk.evaluate({
        predictedTotal: (tier.max / 100) * budget,
        targetMonthBudget: { budget },
      });

      expect(atBoundary.status).toBe(expectedForecastStatus[tier.status]);
    }
  });

  it("covers every budgetAnalyzer status with an explicit forecast mapping", () => {
    const mapped = new Set(["Safe", "Warning", "Critical", "Overspent"]);
    for (const tier of budgetAnalyzer.STATUS_THRESHOLDS) {
      expect(mapped.has(tier.status)).toBe(true);
    }
  });
});
