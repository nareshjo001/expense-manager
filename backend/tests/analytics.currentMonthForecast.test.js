"use strict";

const { buildCurrentMonthForecastInput } = require("../analytics/currentMonthForecastInputAggregator");
const currentMonthForecastAnalyzer = require("../analytics/analyzers/currentMonthForecastAnalyzer");

const MONTH_START = new Date(2026, 7, 1);
const AS_OF = new Date(2026, 7, 15, 12);
const expense = (name, category, amount, monthIndex, day, recurring = false) => ({
  _id: `${name}-${monthIndex}-${day}-${amount}`,
  expenseName: name,
  expenseCategory: category,
  expenseAmount: amount,
  expenseDate: new Date(2026, monthIndex, day),
  isRecurring: recurring,
});

function routineHistory() {
  const rows = [];
  for (let month = 2; month <= 6; month += 1) {
    rows.push(expense("Groceries", "Food", 1000, month, 1));
    rows.push(expense("Groceries", "Food", 1000, month, 10));
    rows.push(expense("Groceries", "Food", 1000, month, 20));
  }
  return rows;
}

describe("current-month forecast input", () => {
  it("softens a rare extreme historical purchase without removing its normal-sized contribution", () => {
    const history = routineHistory();
    history.push(expense("New Mobile", "Shopping", 35000, 6, 12));
    const input = buildCurrentMonthForecastInput({
      recentExpensePool: history,
      currentMonthExpenses: [],
      currentMonthStart: MONTH_START,
      asOfDate: AS_OF,
    });

    expect(input.historicalAdjustments).toHaveLength(1);
    expect(input.historicalAdjustments[0]).toMatchObject({
      expenseName: "New Mobile",
      originalAmount: 35000,
      treatment: "HISTORICAL_EXCESS_NOT_CARRIED_FORWARD",
    });
    expect(input.historicalAdjustments[0].baselineAmount).toBeGreaterThan(0);
    expect(input.monthlySeries.at(-1).totalAmount).toBeLessThan(38000);
  });

  it("does not soften a repeated or explicitly recurring high legitimate expense", () => {
    const history = routineHistory();
    history.push(expense("Rent", "Bills", 20000, 4, 2, true));
    history.push(expense("Rent", "Bills", 20000, 5, 2, true));
    history.push(expense("Rent", "Bills", 20000, 6, 2, true));
    const input = buildCurrentMonthForecastInput({
      recentExpensePool: history,
      currentMonthExpenses: [],
      currentMonthStart: MONTH_START,
      asOfDate: AS_OF,
    });
    expect(input.historicalAdjustments).toEqual([]);
    expect(input.monthlySeries.at(-1).totalAmount).toBe(23000);
  });

  it("keeps a rare but non-extreme legitimate expense at its full amount", () => {
    const history = routineHistory();
    history.push(expense("Dental visit", "Health", 2000, 6, 12));
    const input = buildCurrentMonthForecastInput({
      recentExpensePool: history,
      currentMonthExpenses: [],
      currentMonthStart: MONTH_START,
      asOfDate: AS_OF,
    });
    expect(input.historicalAdjustments).toEqual([]);
    expect(input.monthlySeries.at(-1).totalAmount).toBe(5000);
  });

  it("keeps a current one-off fully in actual spending but caps only its forecasting influence", () => {
    const current = [
      expense("Groceries", "Food", 1200, 7, 10),
      expense("Laptop", "Shopping", 40000, 7, 12),
    ];
    const input = buildCurrentMonthForecastInput({
      recentExpensePool: routineHistory(),
      currentMonthExpenses: current,
      currentMonthStart: MONTH_START,
      asOfDate: AS_OF,
    });
    expect(input.spentSoFar).toBe(41200);
    expect(input.forecastableSpentSoFar).toBeLessThan(41200);
    expect(input.currentAdjustments).toHaveLength(1);
    expect(input.currentAdjustments[0].treatment).toBe("INCLUDED_NOT_EXTRAPOLATED");
  });
});

describe("current-month forecast analyzer", () => {
  it("publishes actual plus expected remaining, compares the current budget, and reconciles categories", () => {
    const input = buildCurrentMonthForecastInput({
      recentExpensePool: routineHistory(),
      currentMonthExpenses: [expense("Groceries", "Food", 1200, 7, 10)],
      currentMonthStart: MONTH_START,
      asOfDate: AS_OF,
    });
    const result = currentMonthForecastAnalyzer.analyze({
      input,
      currentMonthStart: MONTH_START,
      currentMonthBudget: { budget: 5000 },
    });
    expect(result.hasData).toBe(true);
    expect(result.targetMonth).toBe("2026-08");
    expect(result.spentSoFar).toBe(1200);
    expect(result.expectedRemaining).toBeGreaterThan(0);
    expect(result.estimate).toBe(result.spentSoFar + result.expectedRemaining);
    expect(result.budgetRisk.budgetAmount).toBe(5000);
    expect(result.categories.reduce((sum, entry) => sum + entry.projectedAmount, 0)).toBeCloseTo(
      result.estimate,
      2
    );
  });

  it("never projects below actual spending when a current one-off is very large", () => {
    const input = buildCurrentMonthForecastInput({
      recentExpensePool: routineHistory(),
      currentMonthExpenses: [expense("Laptop", "Shopping", 40000, 7, 12)],
      currentMonthStart: MONTH_START,
      asOfDate: AS_OF,
    });
    const result = currentMonthForecastAnalyzer.analyze({ input, currentMonthStart: MONTH_START });
    expect(result.spentSoFar).toBe(40000);
    expect(result.estimate).toBeGreaterThanOrEqual(40000);
    expect(result.range.lower).toBeGreaterThanOrEqual(40000);
  });

  it("returns an honest unavailable state below three complete months", () => {
    const input = buildCurrentMonthForecastInput({
      recentExpensePool: routineHistory().filter((row) => row.expenseDate.getMonth() >= 5),
      currentMonthExpenses: [],
      currentMonthStart: MONTH_START,
      asOfDate: AS_OF,
    });
    const result = currentMonthForecastAnalyzer.analyze({ input, currentMonthStart: MONTH_START });
    expect(result.hasData).toBe(false);
    expect(result.reasonCode).toBe("INSUFFICIENT_HISTORY_FOR_CURRENT_MONTH");
  });
});
