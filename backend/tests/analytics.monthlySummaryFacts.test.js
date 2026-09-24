"use strict";

// AI-001-T02 -- unit tests for the eligible-fact catalog defined in
// backend/analytics/monthlySummaryFacts.js (AI-001-T01's contract turned
// into code). No database, no Express app, no mocks -- this module is a
// pure function of a report object, so these tests run in isolation.

const {
  FACT_IDS,
  CONTRACT_VERSION,
  isFactEligible,
  getFact,
  listEligibleFactIds,
} = require("../analytics/monthlySummaryFacts");
const { CURRENT_REPORT_VERSION } = require("../analytics/reportContractVersion");

const fullReport = {
  metadata: { version: 10, reportPeriod: { month: 9, year: 2026 } },
  summary: { totalSpent: 45230.5, transactionCount: 62, dailyAverage: 1959.15 },
  spending: {
    hasData: true,
    largestExpense: {
      expenseAmount: 8000,
      expenseCategory: "Electronics",
      expenseName: "Laptop bag",
      expenseDate: "2026-09-05",
      expenseDescription: "New laptop bag with extra padding, bought for my mother",
    },
    stability: { coefficientOfVariation: 0.42, weeklyTotals: [1000, 2000], reason: null },
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

describe("monthlySummaryFacts -- contract shape", () => {
  test("CONTRACT_VERSION is the same shared constant reportContractVersion.js exports", () => {
    expect(CONTRACT_VERSION).toBe(CURRENT_REPORT_VERSION);
  });

  test("no fact ID references budgetInsights (canned template text, excluded by AI-001-T01's contract)", () => {
    expect(FACT_IDS.some((id) => id.toLowerCase().includes("budgetinsight"))).toBe(false);
  });

  test("no fact ID references financialHealth.signals[].message (canned template text)", () => {
    expect(FACT_IDS.some((id) => id.toLowerCase().includes("message"))).toBe(false);
  });

  test("FACT_IDS has no duplicates", () => {
    expect(new Set(FACT_IDS).size).toBe(FACT_IDS.length);
  });
});

describe("monthlySummaryFacts -- eligibility gating (never fabricates)", () => {
  test("every fact is ineligible against an empty report, and none of it throws", () => {
    FACT_IDS.forEach((factId) => {
      expect(isFactEligible({}, factId)).toBe(false);
      expect(getFact({}, factId)).toBeNull();
    });
  });

  test("every fact is ineligible against a null/undefined report, and none of it throws", () => {
    FACT_IDS.forEach((factId) => {
      expect(isFactEligible(null, factId)).toBe(false);
      expect(isFactEligible(undefined, factId)).toBe(false);
      expect(getFact(null, factId)).toBeNull();
    });
  });

  test("unknown fact ID is never eligible and never resolves", () => {
    expect(isFactEligible(fullReport, "not.a.real.fact")).toBe(false);
    expect(getFact(fullReport, "not.a.real.fact")).toBeNull();
  });

  test("summary facts are ineligible when spending.hasData is false, even if summary itself is populated", () => {
    const report = { ...fullReport, spending: { hasData: false } };
    expect(getFact(report, "summary.totalSpent")).toBeNull();
    expect(getFact(report, "summary.transactionCount")).toBeNull();
  });

  test("budgets.exceededBy is only eligible when isOverspent is true", () => {
    expect(getFact(fullReport, "budgets.exceededBy")).toBeNull(); // isOverspent: false in fixture

    const overspent = {
      ...fullReport,
      budgets: { ...fullReport.budgets, isOverspent: true, exceededBy: 1500 },
    };
    expect(getFact(overspent, "budgets.exceededBy").value).toBe(1500);
  });

  test("budgets.projectedOverspendPercent requires projectionReliable AND projectionStatus === ProjectedOverspend", () => {
    expect(getFact(fullReport, "budgets.projectedOverspendPercent").value).toBe(4);

    const atRisk = {
      ...fullReport,
      budgets: { ...fullReport.budgets, projectionStatus: "AtRisk" },
    };
    expect(getFact(atRisk, "budgets.projectedOverspendPercent")).toBeNull();
  });

  test("anomalies.flaggedCount of 0 is a real, eligible fact -- not treated as falsy/absent", () => {
    const noAnomalies = { ...fullReport, anomalies: { hasData: true, flaggedCount: 0 } };
    const fact = getFact(noAnomalies, "anomalies.flaggedCount");
    expect(fact).not.toBeNull();
    expect(fact.value).toBe(0);
  });

  test("categories.monthly.biggestJump.* is ineligible when biggestJump is null", () => {
    const noJump = {
      ...fullReport,
      categories: { monthly: { ...fullReport.categories.monthly, biggestJump: null } },
    };
    expect(getFact(noJump, "categories.monthly.biggestJump.category")).toBeNull();
    expect(getFact(noJump, "categories.monthly.biggestJump.growthPercentage")).toBeNull();
  });

  test("spending.largestExpense.* is ineligible when largestExpense is null (e.g. all refunds)", () => {
    const allRefunds = { ...fullReport, spending: { hasData: true, largestExpense: null } };
    expect(getFact(allRefunds, "spending.largestExpense.amount")).toBeNull();
    expect(getFact(allRefunds, "spending.largestExpense.category")).toBeNull();
  });
});

describe("monthlySummaryFacts -- resolves the correct values", () => {
  test("summary facts resolve real numbers", () => {
    expect(getFact(fullReport, "summary.totalSpent").value).toBe(45230.5);
    expect(getFact(fullReport, "summary.transactionCount").value).toBe(62);
  });

  test("spending.largestExpense.* resolves amount/category only -- never description/name/date", () => {
    const amount = getFact(fullReport, "spending.largestExpense.amount");
    const category = getFact(fullReport, "spending.largestExpense.category");
    expect(amount.value).toBe(8000);
    expect(category.value).toBe("Electronics");
    // No fact in the catalog can ever surface expenseDescription/expenseName/expenseDate.
    expect(FACT_IDS.some((id) => /description|expensename|expensedate/i.test(id))).toBe(false);
  });

  test("financialHealth.topStrength/topWeakness resolve id/metric/value only -- never .message", () => {
    const weaknessMetric = getFact(fullReport, "financialHealth.topWeakness.metric");
    const weaknessValue = getFact(fullReport, "financialHealth.topWeakness.value");
    expect(weaknessMetric.value).toBe("spendingDirection");
    expect(weaknessValue.value).toBe("Increasing");
    expect(weaknessMetric.value).not.toMatch(/Spending is increasing/);

    const strengthMetric = getFact(fullReport, "financialHealth.topStrength.metric");
    const strengthValue = getFact(fullReport, "financialHealth.topStrength.value");
    expect(strengthMetric.value).toBe("currentStreak");
    expect(strengthValue.value).toBe(2);
  });

  test("forecast.nextMonthEstimate resolves the nested nextCalendarMonthForecast.estimate", () => {
    expect(getFact(fullReport, "forecast.nextMonthEstimate").value).toBe(47000);
  });

  test("every resolved fact carries the shared contract version", () => {
    const fact = getFact(fullReport, "summary.totalSpent");
    expect(fact.contractVersion).toBe(CURRENT_REPORT_VERSION);
  });

  test("listEligibleFactIds returns only facts eligible against this report, all resolvable", () => {
    const eligible = listEligibleFactIds(fullReport);
    expect(eligible.length).toBeGreaterThan(0);
    eligible.forEach((factId) => {
      expect(getFact(fullReport, factId)).not.toBeNull();
    });
    // Sanity: at least one known-ineligible fact for this fixture is excluded.
    expect(eligible).not.toContain("budgets.exceededBy");
  });
});
