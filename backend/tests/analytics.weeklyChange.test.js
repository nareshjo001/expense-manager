// ANL-001-T03 -- weeklyChangeAnalyzer.analyze contract coverage.
"use strict";

const { analyze } = require("../analytics/analyzers/weeklyChangeAnalyzer");

const expensesTotaling = (amounts) =>
  amounts.map((expenseAmount, index) => ({
    expenseAmount,
    expenseCategory: "Test",
    expenseDate: `2026-08-${String((index % 27) + 1).padStart(2, "0")}`,
  }));

describe("weeklyChangeAnalyzer.analyze", () => {
  it("returns hasData:false with NO_WEEKLY_EXPENSE_DATA when both weeks are empty", () => {
    const result = analyze({ currentWeekExpenses: [], previousWeekExpenses: [], stability: {} });

    expect(result).toEqual({
      hasData: false,
      reasonCode: "NO_WEEKLY_EXPENSE_DATA",
      currentWeekTotal: 0,
      previousWeekTotal: 0,
      changeRatio: null,
      adaptiveThreshold: 0.3,
      volatility: null,
      isSignificant: false,
      direction: "same",
      anomalySource: null,
    });
  });

  it("flags a clear upward spike as significant, attributed to the current week", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([2000]),
      previousWeekExpenses: expensesTotaling([1000]),
      stability: {},
    });

    expect(result.hasData).toBe(true);
    expect(result.reasonCode).toBeNull();
    expect(result.currentWeekTotal).toBe(2000);
    expect(result.previousWeekTotal).toBe(1000);
    expect(result.changeRatio).toBe(1);
    expect(result.direction).toBe("up");
    expect(result.isSignificant).toBe(true);
    expect(result.anomalySource).toBe("CURRENT_WEEK");
  });

  it("flags a clear downward drop as significant, attributed to the previous week", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([500]),
      previousWeekExpenses: expensesTotaling([2000]),
      stability: {},
    });

    expect(result.currentWeekTotal).toBe(500);
    expect(result.previousWeekTotal).toBe(2000);
    expect(result.changeRatio).toBe(0.75);
    expect(result.direction).toBe("down");
    expect(result.isSignificant).toBe(true);
    expect(result.anomalySource).toBe("PREVIOUS_WEEK");
  });

  it("treats a zero previousWeekTotal as no baseline: changeRatio null and not significant", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([750]),
      previousWeekExpenses: [],
      stability: {},
    });

    expect(result.hasData).toBe(true);
    expect(result.currentWeekTotal).toBe(750);
    expect(result.previousWeekTotal).toBe(0);
    expect(result.changeRatio).toBeNull();
    expect(result.isSignificant).toBe(false);
    expect(result.direction).toBe("up");
    // isSignificant is false, so anomalySource must stay null even though direction is "up".
    expect(result.anomalySource).toBeNull();
  });

  it("falls back to the flat 0.3 threshold when volatility is unavailable (empty stability)", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([1100]),
      previousWeekExpenses: expensesTotaling([1000]),
      stability: {},
    });

    expect(result.volatility).toBeNull();
    expect(result.adaptiveThreshold).toBe(0.3);
  });

  it("falls back to the flat 0.3 threshold when coefficientOfVariation is undefined", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([1100]),
      previousWeekExpenses: expensesTotaling([1000]),
      stability: { coefficientOfVariation: undefined },
    });

    expect(result.volatility).toBeNull();
    expect(result.adaptiveThreshold).toBe(0.3);
  });

  it("clamps a low volatility (below 0.25) up to the 0.25 floor", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([1100]),
      previousWeekExpenses: expensesTotaling([1000]),
      stability: { coefficientOfVariation: 0.1 },
    });

    expect(result.volatility).toBe(0.1);
    expect(result.adaptiveThreshold).toBe(0.25);
  });

  it("clamps a high volatility (above 0.6) down to the 0.6 ceiling", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([1100]),
      previousWeekExpenses: expensesTotaling([1000]),
      stability: { coefficientOfVariation: 0.9 },
    });

    expect(result.volatility).toBe(0.9);
    expect(result.adaptiveThreshold).toBe(0.6);
  });

  it("passes a volatility already inside [0.25, 0.6] through unchanged", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([1100]),
      previousWeekExpenses: expensesTotaling([1000]),
      stability: { coefficientOfVariation: 0.4 },
    });

    expect(result.volatility).toBe(0.4);
    expect(result.adaptiveThreshold).toBe(0.4);
  });

  it("boundary: a changeRatio just under the threshold is NOT significant", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([12999]),
      previousWeekExpenses: expensesTotaling([10000]),
      stability: {},
    });

    expect(result.changeRatio).toBe(0.2999);
    expect(result.adaptiveThreshold).toBe(0.3);
    expect(result.isSignificant).toBe(false);
    expect(result.anomalySource).toBeNull();
  });

  it("boundary: a changeRatio exactly at the threshold IS significant (>=, not >)", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([13000]),
      previousWeekExpenses: expensesTotaling([10000]),
      stability: {},
    });

    expect(result.changeRatio).toBe(0.3);
    expect(result.adaptiveThreshold).toBe(0.3);
    expect(result.isSignificant).toBe(true);
    expect(result.direction).toBe("up");
    expect(result.anomalySource).toBe("CURRENT_WEEK");
  });

  it("reports direction 'same' and no anomalySource when totals are equal", () => {
    const result = analyze({
      currentWeekExpenses: expensesTotaling([1000]),
      previousWeekExpenses: expensesTotaling([1000]),
      stability: {},
    });

    expect(result.changeRatio).toBe(0);
    expect(result.direction).toBe("same");
    expect(result.isSignificant).toBe(false);
    expect(result.anomalySource).toBeNull();
  });

  it("coerces non-finite/NaN expenseAmount values to 0 when summing week totals", () => {
    const result = analyze({
      currentWeekExpenses: [
        { expenseAmount: 500 },
        { expenseAmount: "not-a-number" },
        { expenseAmount: NaN },
        { expenseAmount: undefined },
      ],
      previousWeekExpenses: expensesTotaling([500]),
      stability: {},
    });

    expect(result.currentWeekTotal).toBe(500);
    expect(result.previousWeekTotal).toBe(500);
    expect(result.changeRatio).toBe(0);
  });
});
