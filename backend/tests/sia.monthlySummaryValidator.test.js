"use strict";

// AI-001-T04 -- unit tests for monthlySummaryValidator.js. Pure function --
// no database, no LLM call.

const { validateMonthlySummaryAnswer } = require("../sia/monthlySummaryValidator");

const report = {
  metadata: { version: 10 },
  spending: { hasData: true, largestExpense: null, stability: {} },
  summary: { totalSpent: 45230.5, transactionCount: 62 },
  budgets: {
    hasData: true,
    hasBudget: true,
    utilization: 90.46,
    remainingBudget: 4769.5,
    isOverspent: false,
    status: "Critical",
  },
  categories: { monthly: { hasData: false } },
  trends: { hasData: false },
  insights: { weeklyChange: { hasData: false }, categoryPattern: { hasData: false }, stability: { hasData: false } },
  financialHealth: { overall: 62, risk: "Medium", signals: [] },
  anomalies: { hasData: true, flaggedCount: 2 },
  forecast: { hasData: false },
};

describe("validateMonthlySummaryAnswer -- structural checks", () => {
  test("rejects an empty narrative", () => {
    expect(validateMonthlySummaryAnswer({ narrative: "  ", citedFactIds: [], report })).toEqual({
      valid: false,
      reasonCode: "EMPTY_OR_MALFORMED_ANSWER",
    });
  });

  test("rejects a narrative that leaks a raw field token", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "Your userId shows high spending.",
      citedFactIds: [],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "RAW_FIELD_LEAKAGE" });
  });

  test("rejects a narrative echoing a raw JSON key fragment", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: 'Your report shows "totalSpent": 45230.5 this month.',
      citedFactIds: ["summary.totalSpent"],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "RAW_FIELD_LEAKAGE" });
  });

  test("rejects fraud-language narratives", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "This looks like fraud on your account.",
      citedFactIds: [],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "FRAUD_CLAIM" });
  });

  test("rejects out-of-scope advice", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "You should invest in stocks to grow your savings.",
      citedFactIds: [],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "OUT_OF_SCOPE_ADVICE" });
  });

  test("rejects unsupported certainty language", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "You will definitely overspend next month.",
      citedFactIds: [],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_CERTAINTY_LANGUAGE" });
  });
});

describe("validateMonthlySummaryAnswer -- fact-ID grounding", () => {
  test("rejects a citedFactId that isn't a real fact ID at all", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "You spent a lot this month.",
      citedFactIds: ["not.a.real.fact"],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNKNOWN_CITED_FACT" });
  });

  test("rejects a citedFactId that is a real fact ID but ineligible against THIS report", () => {
    // forecast.nextMonthEstimate is a real fact ID, but forecast.hasData is
    // false on this report -- getFact() must return null for it.
    const result = validateMonthlySummaryAnswer({
      narrative: "Next month is projected at about ₹50000.",
      citedFactIds: ["forecast.nextMonthEstimate"],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNKNOWN_CITED_FACT" });
  });

  test("accepts a narrative whose every currency figure matches a cited fact's value", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "You spent ₹45230.5 across 62 transactions, using 90.46% of your budget.",
      citedFactIds: ["summary.totalSpent", "summary.transactionCount", "budgets.utilization"],
      report,
    });
    expect(result).toEqual({ valid: true });
  });

  test("rejects a narrative with an invented currency figure not backed by any cited fact", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "You spent ₹99999 this month.",
      citedFactIds: ["summary.totalSpent"],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" });
  });

  test("rejects a narrative citing a real fact but stating a different figure for it", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "Your remaining budget is ₹5000.",
      citedFactIds: ["budgets.remainingBudget"],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" });
  });

  test("rejects an invented percentage figure not backed by any cited percent-unit fact", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "You've used 50% of your budget.",
      citedFactIds: ["budgets.remainingBudget"],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_PERCENTAGE_CLAIM" });
  });

  test("accepts a correct percentage figure backed by a cited percent-unit fact", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "You've used 90.46% of your budget this month.",
      citedFactIds: ["budgets.utilization"],
      report,
    });
    expect(result).toEqual({ valid: true });
  });

  test("a count-unit fact (anomalies.flaggedCount) never satisfies a currency claim", () => {
    const result = validateMonthlySummaryAnswer({
      narrative: "You were charged ₹2 in flagged transactions.",
      citedFactIds: ["anomalies.flaggedCount"],
      report,
    });
    expect(result).toEqual({ valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" });
  });
});
