"use strict";

// AI-001-T02 -- unit tests for the template-only baseline monthly summary
// (backend/sia/monthlySummaryService.js). Pure function of a report
// object -- no database, no Express app, no LLM/provider call.

const { buildMonthlySummary } = require("../sia/monthlySummaryService");

const fullReport = {
  metadata: { version: 10, reportPeriod: { month: 9, year: 2026 } },
  summary: { totalSpent: 45230.5, transactionCount: 62, dailyAverage: 1959.15 },
  spending: {
    hasData: true,
    largestExpense: {
      expenseAmount: 8000,
      expenseCategory: "Electronics",
      expenseName: "Laptop bag",
      expenseDescription: "New laptop bag with extra padding, bought for my mother",
    },
    stability: { coefficientOfVariation: 0.42 },
  },
  budgets: {
    hasData: true,
    hasBudget: true,
    budget: 50000,
    spent: 45230.5,
    utilization: 90.46,
    remainingBudget: 4769.5,
    isOverspent: false,
    exceededBy: 0,
    status: "Critical",
    projectedOverspend: 2000,
    projectedOverspendPercent: 4,
    daysUntilExhaustion: 3,
    projectionReliable: true,
    projectionStatus: "ProjectedOverspend",
  },
  categories: {
    monthly: {
      hasData: true,
      topCategory: { category: "Food", total: 15000 },
      top3Concentration: 68.2,
      biggestJump: { category: "Travel", growthPercentage: 300 },
    },
  },
  trends: {
    hasData: true,
    monthlyTrend: { percentageChange: 12.4, isNewSpending: false, direction: "up" },
  },
  insights: {
    weeklyChange: { hasData: true, changeRatio: 0.5, direction: "up", isSignificant: true },
    categoryPattern: { hasData: true, dominantCategory: "Food", classification: "Habit" },
    stability: { hasData: true, score: 58, tier: "ModeratelyStable" },
  },
  financialHealth: {
    overall: 62,
    risk: "Medium",
    signals: [
      {
        type: "weakness",
        id: "TREND_INCREASING",
        metric: "spendingDirection",
        value: "Increasing",
        message: "Spending is increasing compared to previous periods.",
      },
      {
        type: "strength",
        id: "BUDGET_STREAK",
        metric: "currentStreak",
        value: 2,
        message: "Maintains budget consistently.",
      },
    ],
  },
  anomalies: { hasData: true, flaggedCount: 2 },
  forecast: {
    hasData: true,
    nextCalendarMonthForecast: { hasData: true, estimate: 47000 },
  },
};

describe("buildMonthlySummary -- empty/absent data", () => {
  test("returns a fallback narrative and no citations when there is no report", () => {
    const result = buildMonthlySummary(null);
    expect(result.hasData).toBe(false);
    expect(result.isFallback).toBe(true);
    expect(result.sections).toEqual([]);
    expect(result.citedFacts).toEqual([]);
    expect(typeof result.narrative).toBe("string");
    expect(result.narrative.length).toBeGreaterThan(0);
  });

  test("returns a fallback narrative when spending.hasData is false (empty account / first-use state)", () => {
    const result = buildMonthlySummary({ metadata: { version: 10 }, spending: { hasData: false } });
    expect(result.hasData).toBe(false);
    expect(result.sections).toEqual([]);
    expect(result.citedFacts).toEqual([]);
  });
});

describe("buildMonthlySummary -- full report", () => {
  const result = buildMonthlySummary(fullReport);

  test("always marks itself as the non-LLM fallback and carries the report's contract version", () => {
    expect(result.isFallback).toBe(true);
    expect(result.hasData).toBe(true);
    expect(result.contractVersion).toBe(10);
  });

  test("resolves the period label from metadata.reportPeriod", () => {
    expect(result.periodLabel).toBe("September 2026");
  });

  test("narrative cites the real total spent and transaction count", () => {
    expect(result.narrative).toContain("45230.5");
    expect(result.narrative).toContain("62 transactions");
  });

  test("narrative never contains a financialHealth signal's raw .message text (never cites .message)", () => {
    expect(result.narrative).not.toMatch(/Spending is increasing compared to previous periods\./);
    expect(result.narrative).not.toMatch(/Maintains budget consistently\./);
  });

  test("narrative never contains the largest expense's free-text description", () => {
    expect(result.narrative).not.toMatch(/laptop bag/i);
    expect(result.narrative).not.toMatch(/bought for my mother/i);
  });

  test("every citedFacts entry has a resolvable, defined value and the shared contract version", () => {
    expect(result.citedFacts.length).toBeGreaterThan(0);
    result.citedFacts.forEach((fact) => {
      expect(fact.value).toBeDefined();
      expect(fact.contractVersion).toBe(10);
      expect(typeof fact.factId).toBe("string");
    });
  });

  test("citedFacts has no duplicate factIds even though multiple sections may reference overlapping facts", () => {
    const ids = result.citedFacts.map((f) => f.factId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every section's citedFactIds are a subset of the overall citedFacts", () => {
    const allIds = new Set(result.citedFacts.map((f) => f.factId));
    result.sections.forEach((section) => {
      section.citedFactIds.forEach((factId) => {
        expect(allIds.has(factId)).toBe(true);
      });
    });
  });

  test("includes a budget section citing utilization and remaining budget (not overspent)", () => {
    const budgetSection = result.sections.find((s) => s.id === "budget");
    expect(budgetSection).toBeDefined();
    expect(budgetSection.citedFactIds).toEqual(
      expect.arrayContaining(["budgets.status", "budgets.utilization", "budgets.remainingBudget"])
    );
    expect(budgetSection.text).toMatch(/90\.46%/);
  });

  test("includes an anomaly section for a non-zero flagged count", () => {
    const anomalySection = result.sections.find((s) => s.id === "anomalies");
    expect(anomalySection).toBeDefined();
    expect(anomalySection.text).toMatch(/2 unusually large transactions/);
  });

  test("includes a forecast section citing the next-month estimate", () => {
    const forecastSection = result.sections.find((s) => s.id === "forecast");
    expect(forecastSection).toBeDefined();
    expect(forecastSection.text).toContain("47000");
  });
});

describe("buildMonthlySummary -- overspent budget", () => {
  test("budget section reports the exceeded amount instead of utilization when overspent", () => {
    const overspentReport = {
      ...fullReport,
      budgets: { ...fullReport.budgets, isOverspent: true, exceededBy: 1500, status: "Overspent" },
    };
    const result = buildMonthlySummary(overspentReport);
    const budgetSection = result.sections.find((s) => s.id === "budget");
    expect(budgetSection.text).toMatch(/exceeded by ₹1500/);
    expect(budgetSection.citedFactIds).toContain("budgets.exceededBy");
    expect(budgetSection.citedFactIds).not.toContain("budgets.utilization");
  });
});

describe("buildMonthlySummary -- no budget set", () => {
  test("omits the budget section entirely rather than fabricating one", () => {
    const noBudgetReport = { ...fullReport, budgets: { hasData: true, hasBudget: false } };
    const result = buildMonthlySummary(noBudgetReport);
    expect(result.sections.find((s) => s.id === "budget")).toBeUndefined();
    expect(result.citedFacts.some((f) => f.factId.startsWith("budgets."))).toBe(false);
  });
});

describe("buildMonthlySummary -- weekly pattern fallback", () => {
  test("falls back to the category-pattern sentence when the weekly change is not significant", () => {
    const notSignificant = {
      ...fullReport,
      insights: {
        ...fullReport.insights,
        weeklyChange: { hasData: true, changeRatio: 0.05, direction: "up", isSignificant: false },
      },
    };
    const result = buildMonthlySummary(notSignificant);
    const section = result.sections.find((s) => s.id === "weeklyPattern");
    expect(section).toBeDefined();
    expect(section.citedFactIds).toEqual(
      expect.arrayContaining(["insights.categoryPattern.classification", "insights.categoryPattern.dominantCategory"])
    );
  });

  test("omits the section entirely when neither weekly change nor category pattern is eligible", () => {
    const neither = {
      ...fullReport,
      insights: {
        weeklyChange: { hasData: false },
        categoryPattern: { hasData: false },
        stability: { hasData: false },
      },
    };
    const result = buildMonthlySummary(neither);
    expect(result.sections.find((s) => s.id === "weeklyPattern")).toBeUndefined();
  });
});

describe("buildMonthlySummary -- category section without a biggest jump", () => {
  test("still builds the category section, without the jump sentence, when biggestJump is null", () => {
    const noJump = {
      ...fullReport,
      categories: { monthly: { ...fullReport.categories.monthly, biggestJump: null } },
    };
    const result = buildMonthlySummary(noJump);
    const categorySection = result.sections.find((s) => s.id === "category");
    expect(categorySection).toBeDefined();
    expect(categorySection.citedFactIds).not.toContain("categories.monthly.biggestJump.category");
  });
});
