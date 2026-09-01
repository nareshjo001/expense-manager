// Unit tests for backend/sia/contextBuilder.js.
"use strict";

// Loads a brand-new reportService mock and a brand-new contextBuilder module
function loadContextBuilder() {
  jest.resetModules();
  jest.doMock("../Services/reportService", () => ({
    getReport: jest.fn(),
  }));
  const reportService = require("../Services/reportService");
  const { buildContext } = require("../sia/contextBuilder");
  return { buildContext, reportService };
}

// A structurally complete, production-shaped Report fixture. Every field a
function buildFixtureReport(overrides = {}) {
  return {
    metadata: {
      version: 1,
      generatedAt: "2026-01-15T10:00:00.000Z",
      reportPeriod: { month: 1, year: 2026 },
    },
    summary: {
      totalSpent: 4321,
      transactionCount: 5,
      dailyAverage: 140,
      comparePastMonth: 332.1,
      topCategory: "Groceries",
      budgetUtilization: 43.21,
      budgetStatus: "OnTrack",
      ...overrides.summary,
    },
    spending: { hasData: true, byDay: {} },
    // A structurally complete backend/analytics/analyzers/budgetAnalyzer.js
    budgets: {
      hasData: true,
      budget: 5000,
      spent: 3187.5,
      hasBudget: true,
      utilization: 63.75,
      remainingBudget: 1812.5,
      budgetLeft: 36.25,
      isOverspent: false,
      exceededBy: 0,
      status: "Warning",
      currentStreak: 2,
      longestStreak: 5,
      streakBrokenReason: null,
      projectedSpent: 4312.4,
      projectedOverspend: 0,
      projectedOverspendPercent: 0,
      daysUntilExhaustion: 12,
      projectionReliable: true,
      projectionStatus: "AtRisk",
      budgetInsights: {
        type: "AT_RISK",
        title: "Budget At Risk",
        message: "Your current spending trend leaves very little room before reaching your budget.",
        tip: "₹1812.5 (36.25% remaining) is left. Spend cautiously for the rest of the month.",
      },
    },
    // A structurally complete backend/analytics/analyzers/categoryAnalyzer.js
    categories: {
      monthly: {
        hasData: true,
        topCategory: { category: "Groceries", total: 1234.567 },
        leastCategory: { category: "Books", total: 12.345 },
        categoryDistribution: [
          { category: "Groceries", amount: 1234.567, percentage: 999.99 },
          { category: "Rent", amount: 5000, percentage: 1.11 },
          { category: "Books", amount: 12.345, percentage: 50 },
        ],
        concentrationIndex: 37.77,
        top3Concentration: 12.34,
        categoryGrowth: [
          {
            category: "Groceries",
            previous: 1000,
            current: 1234.567,
            change: 999.99,
            growthPercentage: 5.5,
            isNewCategory: false,
            trend: "up",
          },
          {
            category: "Rent",
            previous: 5000,
            current: 5000,
            change: 0,
            growthPercentage: 0,
            isNewCategory: false,
            trend: "same",
          },
          {
            category: "Books",
            previous: 0,
            current: 12.345,
            change: 12.345,
            growthPercentage: null,
            isNewCategory: true,
            trend: "up",
          },
        ],
        biggestJump: {
          category: "Books",
          previous: 0,
          current: 12.345,
          change: 12.345,
          growthPercentage: null,
          isNewCategory: true,
          trend: "up",
        },
        biggestDrop: null,
      },
      yearly: {
        hasData: true,
        topCategory: { category: "Rent", total: 60000 },
        leastCategory: { category: "Books", total: 200 },
        categoryDistribution: [
          { category: "Rent", amount: 60000, percentage: 80 },
          { category: "Books", amount: 200, percentage: 20 },
        ],
        concentrationIndex: 68,
        top3Concentration: 100,
        categoryGrowth: [],
        biggestJump: null,
        biggestDrop: null,
      },
    },
    trends: {
      hasData: true,
      monthlyTrend: { current: 4321, previous: 1000, percentageChange: 332.1 },
    },
    habits: { monthly: { hasData: true }, yearly: { hasData: true } },
    financialHealth: {
      scores: { spending: 80, budget: 70 },
      overall: 75,
      risk: { label: "Low", color: "green" },
      signals: ["Spending increased vs. last month"],
      ...overrides.financialHealth,
    },
    forecast: {},
    // Deliberately not a real Report field -- stands in for "some raw
    rawExpenses: [{ expenseAmount: 4000 }, { expenseAmount: 321 }],
    ...overrides,
  };
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("backend/sia/contextBuilder", () => {
  it("HEALTH_EXPLANATION returns exactly financialHealth and the two allowed summary fields, aliased from financialHealth.overall/.risk.label", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-a", "HEALTH_EXPLANATION");

    expect(result).toEqual({
      intent: "HEALTH_EXPLANATION",
      fields: {
        financialHealth: report.financialHealth,
        summary: {
          healthScore: 75, // alias of report.financialHealth.overall
          riskLevel: "Low", // alias of report.financialHealth.risk.label
        },
      },
      sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    });
    // Exactly these two summary keys -- nothing else leaked in.
    expect(Object.keys(result.fields.summary).sort()).toEqual(["healthScore", "riskLevel"]);
  });

  it("SPENDING_CHANGE_EXPLANATION returns exactly trends and the two allowed summary fields (unchanged behaviour)", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-b", "SPENDING_CHANGE_EXPLANATION");

    expect(result).toEqual({
      intent: "SPENDING_CHANGE_EXPLANATION",
      fields: {
        trends: report.trends,
        summary: {
          comparePastMonth: 332.1,
          totalSpent: 4321,
        },
      },
      sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    });
    expect(Object.keys(result.fields.summary).sort()).toEqual(["comparePastMonth", "totalSpent"]);
  });

  it("sourceReportGeneratedAt comes from the fixture Report and is not newly generated", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const fixedTimestamp = "2020-06-01T00:00:00.000Z"; // deliberately far from "now"
    const report = buildFixtureReport({ metadata: { generatedAt: fixedTimestamp } });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-c", "HEALTH_EXPLANATION");

    expect(result.sourceReportGeneratedAt).toBe(fixedTimestamp);
    expect(typeof result.sourceReportGeneratedAt).toBe("string");
  });

  it("calls getReport exactly once with the supplied userId, unchanged", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    await buildContext("exact-user-id-123", "HEALTH_EXPLANATION");

    expect(reportService.getReport).toHaveBeenCalledTimes(1);
    expect(reportService.getReport).toHaveBeenCalledWith("exact-user-id-123");
  });

  it("excludes unrelated Report fields", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    const result = await buildContext("user-d", "HEALTH_EXPLANATION");
    const serialized = JSON.stringify(result);

    for (const excludedField of [
      "topCategory",
      "budgetStatus",
      "budgetUtilization",
      "transactionCount",
      "dailyAverage",
      "categories",
      "habits",
      "forecast",
    ]) {
      expect(serialized).not.toContain(excludedField);
    }
  });

  it("excludes raw expense/income data", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    const result = await buildContext("user-e", "SPENDING_CHANGE_EXPLANATION");
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("rawExpenses");
    expect(serialized).not.toContain("4000");
  });

  it("preserves a healthScore of 0 (financialHealth.overall = 0) instead of treating it as missing", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      financialHealth: { overall: 0, risk: { label: "Low", color: "green" } },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-f", "HEALTH_EXPLANATION");

    expect(result.fields.summary.healthScore).toBe(0);
    expect(result.reason).toBeUndefined();
  });

  it("preserves valid zero-valued spending financial fields instead of treating them as missing", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      summary: { totalSpent: 0, comparePastMonth: 0 },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-g", "SPENDING_CHANGE_EXPLANATION");

    expect(result.fields.summary.totalSpent).toBe(0);
    expect(result.fields.summary.comparePastMonth).toBe(0);
  });

  it('returns fields:null and reason:"no_data" when there is no report', async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(null);

    const result = await buildContext("user-h", "HEALTH_EXPLANATION");

    expect(result).toEqual({
      intent: "HEALTH_EXPLANATION",
      fields: null,
      reason: "no_data",
    });
  });

  it("returns the no-data result when financialHealth.overall is missing", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    delete report.financialHealth.overall;
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-i", "HEALTH_EXPLANATION");

    expect(result).toEqual({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when financialHealth.overall is null", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({ financialHealth: { overall: null } });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-i2", "HEALTH_EXPLANATION");

    expect(result).toEqual({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when financialHealth.risk is missing", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    delete report.financialHealth.risk;
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-j", "HEALTH_EXPLANATION");

    expect(result).toEqual({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when financialHealth.risk is null", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({ financialHealth: { risk: null } });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-j2", "HEALTH_EXPLANATION");

    expect(result).toEqual({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when financialHealth.risk.label is missing", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({ financialHealth: { risk: { color: "green" } } });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-k", "HEALTH_EXPLANATION");

    expect(result).toEqual({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when financialHealth.risk.label is null", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({ financialHealth: { risk: { label: null, color: "green" } } });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-k2", "HEALTH_EXPLANATION");

    expect(result).toEqual({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("ignores decoy/broken summary.healthScore and summary.riskLevel values and never reads them", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    // Simulates a stale or otherwise-broken report where summary carries
    const report = buildFixtureReport({
      summary: { healthScore: 999, riskLevel: "DECOY-RISK" },
      financialHealth: { overall: 75, risk: { label: "Low", color: "green" } },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-l", "HEALTH_EXPLANATION");

    expect(result.fields.summary.healthScore).toBe(75);
    expect(result.fields.summary.riskLevel).toBe("Low");
    expect(result.fields.summary.healthScore).not.toBe(999);
    expect(result.fields.summary.riskLevel).not.toBe("DECOY-RISK");
    expect(JSON.stringify(result)).not.toContain("DECOY-RISK");
  });

  it("returns the no-data result when required spending/trend data is missing", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    delete report.trends; // simulate the field being absent
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-m", "SPENDING_CHANGE_EXPLANATION");

    expect(result).toEqual({
      intent: "SPENDING_CHANGE_EXPLANATION",
      fields: null,
      reason: "no_data",
    });
  });

  it("returns the no-data result when getReport rejects", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockRejectedValue(new Error("boom"));

    const result = await buildContext("user-n", "HEALTH_EXPLANATION");

    expect(result).toEqual({
      intent: "HEALTH_EXPLANATION",
      fields: null,
      reason: "no_data",
    });
  });

  it("returns the same explicit no-data shape for an unsupported intent, without guessing", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    const result = await buildContext("user-o", "SOME_UNKNOWN_INTENT");

    expect(result).toEqual({
      intent: "SOME_UNKNOWN_INTENT",
      fields: null,
      reason: "no_data",
    });
    // An unsupported intent must never even reach reportService.
    expect(reportService.getReport).not.toHaveBeenCalled();
  });

  it("does not mutate the source Report object", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = deepFreeze(buildFixtureReport());
    reportService.getReport.mockResolvedValue(report);

    // Object.freeze + "use strict" in contextBuilder.js means any attempted
    await expect(buildContext("user-p", "HEALTH_EXPLANATION")).resolves.toBeDefined();
    await expect(buildContext("user-p", "SPENDING_CHANGE_EXPLANATION")).resolves.toBeDefined();
  });

  // -- M2-3A: BUDGET_STATUS_EXPLANATION -------------------------------------

  it("BUDGET_STATUS_EXPLANATION is a supported intent (reaches reportService, unlike an unsupported intent)", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    await buildContext("user-budget-a", "BUDGET_STATUS_EXPLANATION");

    expect(reportService.getReport).toHaveBeenCalledTimes(1);
    expect(reportService.getReport).toHaveBeenCalledWith("user-budget-a");
  });

  it("SUPPORTED_INTENTS contains exactly HEALTH_EXPLANATION, SPENDING_CHANGE_EXPLANATION, BUDGET_STATUS_EXPLANATION, and CATEGORY_SPENDING_EXPLANATION -- proven behaviorally, not assumed", async () => {
    const supported = [
      "HEALTH_EXPLANATION",
      "SPENDING_CHANGE_EXPLANATION",
      "BUDGET_STATUS_EXPLANATION",
      "CATEGORY_SPENDING_EXPLANATION",
    ];
    for (const intent of supported) {
      const { buildContext, reportService } = loadContextBuilder();
      reportService.getReport.mockResolvedValue(buildFixtureReport());
      await buildContext("user-supported", intent);
      expect(reportService.getReport).toHaveBeenCalledTimes(1);
    }

    // Includes plausible-looking but NOT-added identifiers, to prove no
    // extra intent was accidentally introduced alongside the real ones.
    const unsupported = [
      "SOME_UNKNOWN_INTENT",
      "BUDGET_RISK_EXPLANATION",
      "BUDGET_UTILIZATION_EXPLANATION",
      "budget_status_explanation",
      "CATEGORY_EXPLANATION",
      "TOP_CATEGORY_EXPLANATION",
      "CATEGORY_BREAKDOWN_EXPLANATION",
      "category_spending_explanation",
      "",
      null,
    ];
    for (const intent of unsupported) {
      const { buildContext, reportService } = loadContextBuilder();
      reportService.getReport.mockResolvedValue(buildFixtureReport());
      await buildContext("user-unsupported", intent);
      expect(reportService.getReport).not.toHaveBeenCalled();
    }
  });

  it("BUDGET_STATUS_EXPLANATION returns exactly the approved budget context for a valid report", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-budget-b", "BUDGET_STATUS_EXPLANATION");

    expect(result).toEqual({
      intent: "BUDGET_STATUS_EXPLANATION",
      fields: {
        budget: {
          budget: 5000,
          spent: 3187.5,
          hasBudget: true,
          status: "Warning",
          isOverspent: false,
          exceededBy: 0,
          utilization: 63.75,
          remainingBudget: 1812.5,
          budgetLeft: 36.25,
          projectionStatus: "AtRisk",
          projectionReliable: true,
          projectedSpent: 4312.4,
          projectedOverspend: 0,
          projectedOverspendPercent: 0,
        },
      },
      sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    });
    // Exactly these fourteen fields -- nothing else leaked in.
    expect(Object.keys(result.fields.budget).sort()).toEqual(
      [
        "budget",
        "spent",
        "hasBudget",
        "status",
        "isOverspent",
        "exceededBy",
        "utilization",
        "remainingBudget",
        "budgetLeft",
        "projectionStatus",
        "projectionReliable",
        "projectedSpent",
        "projectedOverspend",
        "projectedOverspendPercent",
      ].sort()
    );
  });

  it("every returned budget field maps to the exact report.budgets source path it was read from", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    // Distinct, unmistakable per-field values so a mismatched mapping
    const report = buildFixtureReport({
      budgets: {
        hasData: true,
        budget: 11111,
        spent: 22222,
        hasBudget: true,
        status: "Critical",
        isOverspent: true,
        exceededBy: 33333,
        utilization: 44444,
        remainingBudget: 55555,
        budgetLeft: 66666,
        projectionStatus: "ProjectedOverspend",
        projectionReliable: false,
        projectedSpent: 77777,
        projectedOverspend: 88888,
        projectedOverspendPercent: 99999,
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-budget-c", "BUDGET_STATUS_EXPLANATION");

    expect(result.fields.budget).toEqual({
      budget: 11111,
      spent: 22222,
      hasBudget: true,
      status: "Critical",
      isOverspent: true,
      exceededBy: 33333,
      utilization: 44444,
      remainingBudget: 55555,
      budgetLeft: 66666,
      projectionStatus: "ProjectedOverspend",
      projectionReliable: false,
      projectedSpent: 77777,
      projectedOverspend: 88888,
      projectedOverspendPercent: 99999,
    });
  });

  it("preserves legitimate zero values (fully-used budget: zero remaining, zero left, zero overspend) instead of treating them as missing", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      budgets: {
        hasData: true,
        budget: 1000,
        spent: 1000,
        hasBudget: true,
        status: "Critical",
        isOverspent: false,
        exceededBy: 0,
        utilization: 100,
        remainingBudget: 0,
        budgetLeft: 0,
        projectionStatus: "OnTrack",
        projectionReliable: true,
        projectedSpent: 1000,
        projectedOverspend: 0,
        projectedOverspendPercent: 0,
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-budget-d", "BUDGET_STATUS_EXPLANATION");

    expect(result.fields.budget.remainingBudget).toBe(0);
    expect(result.fields.budget.budgetLeft).toBe(0);
    expect(result.fields.budget.exceededBy).toBe(0);
    expect(result.fields.budget.projectedOverspend).toBe(0);
    expect(result.fields.budget.projectedOverspendPercent).toBe(0);
    expect(result.reason).toBeUndefined();
  });

  it('returns fields:null and reason:"no_data" for BUDGET_STATUS_EXPLANATION when there is no report', async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(null);

    const result = await buildContext("user-budget-e", "BUDGET_STATUS_EXPLANATION");

    expect(result).toEqual({ intent: "BUDGET_STATUS_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when report.budgets.hasData is false", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({ budgets: { hasData: false } });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-budget-f", "BUDGET_STATUS_EXPLANATION");

    expect(result).toEqual({ intent: "BUDGET_STATUS_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when report.budgets is missing entirely", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    delete report.budgets;
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-budget-g", "BUDGET_STATUS_EXPLANATION");

    expect(result).toEqual({ intent: "BUDGET_STATUS_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when no budget is configured for the current month (hasBudget: false)", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      budgets: {
        hasData: true,
        budget: 0,
        spent: 250,
        hasBudget: false,
        status: "NoBudgetSet",
        isOverspent: true,
        exceededBy: 250,
        utilization: null,
        remainingBudget: null,
        budgetLeft: null,
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-budget-h", "BUDGET_STATUS_EXPLANATION");

    expect(result).toEqual({ intent: "BUDGET_STATUS_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when a mandatory budget field is missing", async () => {
    const baseValidBudgets = {
      hasData: true,
      budget: 5000,
      spent: 3187.5,
      hasBudget: true,
      status: "Warning",
      isOverspent: false,
      exceededBy: 0,
      utilization: 63.75,
      remainingBudget: 1812.5,
      budgetLeft: 36.25,
      projectionStatus: "AtRisk",
      projectionReliable: true,
      projectedSpent: 4312.4,
      projectedOverspend: 0,
      projectedOverspendPercent: 0,
    };
    const fieldsToDrop = [
      "budget",
      "spent",
      "status",
      "isOverspent",
      "exceededBy",
      "utilization",
      "remainingBudget",
      "budgetLeft",
      "projectionStatus",
      "projectionReliable",
      "projectedSpent",
      "projectedOverspend",
      "projectedOverspendPercent",
    ];

    for (const field of fieldsToDrop) {
      const { buildContext, reportService } = loadContextBuilder();
      const budgets = { ...baseValidBudgets };
      delete budgets[field];
      const report = buildFixtureReport({ budgets });
      reportService.getReport.mockResolvedValue(report);

      const result = await buildContext("user-budget-i", "BUDGET_STATUS_EXPLANATION");

      expect(result).toEqual({ intent: "BUDGET_STATUS_EXPLANATION", fields: null, reason: "no_data" });
    }
  });

  it("excludes budgetInsights, currentStreak, longestStreak, streakBrokenReason, and daysUntilExhaustion from the budget context", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    const result = await buildContext("user-budget-j", "BUDGET_STATUS_EXPLANATION");
    const serialized = JSON.stringify(result);

    expect(result.fields.budget).not.toHaveProperty("budgetInsights");
    expect(result.fields.budget).not.toHaveProperty("currentStreak");
    expect(result.fields.budget).not.toHaveProperty("longestStreak");
    expect(result.fields.budget).not.toHaveProperty("streakBrokenReason");
    expect(result.fields.budget).not.toHaveProperty("daysUntilExhaustion");
    for (const excluded of [
      "budgetInsights",
      "currentStreak",
      "longestStreak",
      "streakBrokenReason",
      "daysUntilExhaustion",
      "Spend cautiously",
      "Avoid additional spending",
    ]) {
      expect(serialized).not.toContain(excluded);
    }
  });

  it("excludes raw expense arrays, income data, financialHealth, and trends from the budget context", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      // Decoy field, like the top-level `rawExpenses` fixture field --
      income: [{ amount: 50000, source: "Salary" }],
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-budget-k", "BUDGET_STATUS_EXPLANATION");
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("rawExpenses");
    expect(serialized).not.toContain("expenseAmount");
    expect(serialized).not.toContain("income");
    expect(serialized).not.toContain("Salary");
    expect(serialized).not.toContain("financialHealth");
    expect(serialized).not.toContain("monthlyTrend");
    expect(result.fields).not.toHaveProperty("financialHealth");
    expect(result.fields).not.toHaveProperty("trends");
  });

  it("excludes userId and database metadata from the budget context", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const authenticatedUserId = "user-should-not-leak-budget-l";
    const report = buildFixtureReport({
      _id: "507f1f77bcf86cd799439011",
      __v: 0,
      user: authenticatedUserId,
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext(authenticatedUserId, "BUDGET_STATUS_EXPLANATION");
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(authenticatedUserId);
    expect(serialized).not.toContain("_id");
    expect(serialized).not.toContain("__v");
    expect(Object.keys(result).sort()).toEqual(["fields", "intent", "sourceReportGeneratedAt"]);
  });

  it("a malicious or different user's data cannot enter the context -- getReport is called with exactly the supplied userId", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    await buildContext("exact-budget-user-id-456", "BUDGET_STATUS_EXPLANATION");

    expect(reportService.getReport).toHaveBeenCalledTimes(1);
    expect(reportService.getReport).toHaveBeenCalledWith("exact-budget-user-id-456");
  });

  it("HEALTH_EXPLANATION remains unchanged after the BUDGET_STATUS_EXPLANATION branch was added", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-regression-health", "HEALTH_EXPLANATION");

    expect(result).toEqual({
      intent: "HEALTH_EXPLANATION",
      fields: {
        financialHealth: report.financialHealth,
        summary: { healthScore: 75, riskLevel: "Low" },
      },
      sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    });
    expect(result.fields).not.toHaveProperty("budget");
  });

  it("SPENDING_CHANGE_EXPLANATION remains unchanged after the BUDGET_STATUS_EXPLANATION branch was added", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-regression-spending", "SPENDING_CHANGE_EXPLANATION");

    expect(result).toEqual({
      intent: "SPENDING_CHANGE_EXPLANATION",
      fields: {
        trends: report.trends,
        summary: { comparePastMonth: 332.1, totalSpent: 4321 },
      },
      sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    });
    expect(result.fields).not.toHaveProperty("budget");
  });

  it("does not mutate the source Report object for BUDGET_STATUS_EXPLANATION", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = deepFreeze(buildFixtureReport());
    reportService.getReport.mockResolvedValue(report);

    await expect(buildContext("user-budget-m", "BUDGET_STATUS_EXPLANATION")).resolves.toBeDefined();
  });

  it("passes budget values through unmodified -- no new rounding or recalculation", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    // Values with several decimal places that a re-round or recalculation
    // would very likely disturb.
    const report = buildFixtureReport({
      budgets: {
        hasData: true,
        budget: 5000,
        spent: 3187.567,
        hasBudget: true,
        status: "Warning",
        isOverspent: false,
        exceededBy: 0,
        utilization: 63.75134,
        remainingBudget: 1812.433,
        budgetLeft: 36.24866,
        projectionStatus: "AtRisk",
        projectionReliable: true,
        projectedSpent: 4312.409,
        projectedOverspend: 0,
        projectedOverspendPercent: 0,
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-budget-n", "BUDGET_STATUS_EXPLANATION");

    expect(result.fields.budget.spent).toBe(3187.567);
    expect(result.fields.budget.utilization).toBe(63.75134);
    expect(result.fields.budget.remainingBudget).toBe(1812.433);
    expect(result.fields.budget.budgetLeft).toBe(36.24866);
    expect(result.fields.budget.projectedSpent).toBe(4312.409);
  });

  // -- M2-4A: CATEGORY_SPENDING_EXPLANATION ---------------------------------

  it("CATEGORY_SPENDING_EXPLANATION is a supported intent (reaches reportService, unlike an unsupported intent)", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    await buildContext("user-category-a", "CATEGORY_SPENDING_EXPLANATION");

    expect(reportService.getReport).toHaveBeenCalledTimes(1);
    expect(reportService.getReport).toHaveBeenCalledWith("user-category-a");
  });

  it("CATEGORY_SPENDING_EXPLANATION returns exactly the approved category context for a valid report", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-b", "CATEGORY_SPENDING_EXPLANATION");

    expect(result).toEqual({
      intent: "CATEGORY_SPENDING_EXPLANATION",
      fields: {
        categories: {
          topCategory: { category: "Groceries", total: 1234.567 },
          leastCategory: { category: "Books", total: 12.345 },
          categoryDistribution: [
            { category: "Groceries", amount: 1234.567, percentage: 999.99 },
            { category: "Rent", amount: 5000, percentage: 1.11 },
            { category: "Books", amount: 12.345, percentage: 50 },
          ],
          concentrationIndex: 37.77,
          top3Concentration: 12.34,
          categoryGrowth: [
            {
              category: "Groceries",
              previous: 1000,
              current: 1234.567,
              change: 999.99,
              growthPercentage: 5.5,
              isNewCategory: false,
              trend: "up",
            },
            {
              category: "Rent",
              previous: 5000,
              current: 5000,
              change: 0,
              growthPercentage: 0,
              isNewCategory: false,
              trend: "same",
            },
            {
              category: "Books",
              previous: 0,
              current: 12.345,
              change: 12.345,
              growthPercentage: null,
              isNewCategory: true,
              trend: "up",
            },
          ],
        },
      },
      sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    });
    // Exactly these six fields -- nothing else (no biggestJump/biggestDrop,
    // no yearly branch) leaked in.
    expect(Object.keys(result.fields.categories).sort()).toEqual(
      [
        "topCategory",
        "leastCategory",
        "categoryDistribution",
        "concentrationIndex",
        "top3Concentration",
        "categoryGrowth",
      ].sort()
    );
    expect(Object.keys(result.fields).sort()).toEqual(["categories"]);
  });

  it("every returned category field maps to the exact report.categories.monthly source path it was read from", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    // Distinct, unmistakable per-field values so a mismatched mapping (e.g.
    const report = buildFixtureReport({
      categories: {
        monthly: {
          hasData: true,
          topCategory: { category: "MONTHLY-TOP", total: 11111 },
          leastCategory: { category: "MONTHLY-LEAST", total: 22222 },
          categoryDistribution: [{ category: "MONTHLY-DIST", amount: 33333, percentage: 44444 }],
          concentrationIndex: 55555,
          top3Concentration: 66666,
          categoryGrowth: [
            { category: "MONTHLY-GROWTH", previous: 77777, current: 88888, change: 99999, growthPercentage: 11.11, isNewCategory: false, trend: "up" },
          ],
          biggestJump: { category: "SHOULD-NOT-APPEAR-JUMP", previous: 1, current: 2, change: 1, growthPercentage: 100, isNewCategory: false, trend: "up" },
          biggestDrop: { category: "SHOULD-NOT-APPEAR-DROP", previous: 5, current: 1, change: -4, growthPercentage: -80, isNewCategory: false, trend: "down" },
        },
        yearly: {
          hasData: true,
          topCategory: { category: "YEARLY-DECOY", total: 999 },
          leastCategory: { category: "YEARLY-DECOY", total: 1 },
          categoryDistribution: [{ category: "YEARLY-DECOY", amount: 999, percentage: 100 }],
          concentrationIndex: 100,
          top3Concentration: 100,
          categoryGrowth: [],
        },
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-c", "CATEGORY_SPENDING_EXPLANATION");

    expect(result.fields.categories).toEqual({
      topCategory: { category: "MONTHLY-TOP", total: 11111 },
      leastCategory: { category: "MONTHLY-LEAST", total: 22222 },
      categoryDistribution: [{ category: "MONTHLY-DIST", amount: 33333, percentage: 44444 }],
      concentrationIndex: 55555,
      top3Concentration: 66666,
      categoryGrowth: [
        { category: "MONTHLY-GROWTH", previous: 77777, current: 88888, change: 99999, growthPercentage: 11.11, isNewCategory: false, trend: "up" },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("YEARLY-DECOY");
    expect(serialized).not.toContain("SHOULD-NOT-APPEAR");
  });

  it("a malicious or different user's data cannot enter the context -- getReport is called with exactly the supplied userId", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    await buildContext("exact-category-user-id-789", "CATEGORY_SPENDING_EXPLANATION");

    expect(reportService.getReport).toHaveBeenCalledTimes(1);
    expect(reportService.getReport).toHaveBeenCalledWith("exact-category-user-id-789");
  });

  it('returns fields:null and reason:"no_data" for CATEGORY_SPENDING_EXPLANATION when there is no report', async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(null);

    const result = await buildContext("user-category-d", "CATEGORY_SPENDING_EXPLANATION");

    expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when report.categories is missing entirely", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    delete report.categories;
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-e", "CATEGORY_SPENDING_EXPLANATION");

    expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when report.categories.monthly is missing entirely", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    delete report.categories.monthly;
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-f", "CATEGORY_SPENDING_EXPLANATION");

    expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when report.categories.monthly.hasData is false (genuinely no expenses this month)", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({ categories: { monthly: { hasData: false } } });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-g", "CATEGORY_SPENDING_EXPLANATION");

    expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
  });

  it("returns the no-data result when hasData is truthy but not strictly true (no truthiness check)", async () => {
    for (const hasDataValue of [1, "yes", "true", {}]) {
      const { buildContext, reportService } = loadContextBuilder();
      const report = buildFixtureReport({
        categories: {
          monthly: {
            hasData: hasDataValue,
            topCategory: { category: "Groceries", total: 100 },
            leastCategory: { category: "Books", total: 10 },
            categoryDistribution: [{ category: "Groceries", amount: 100, percentage: 100 }],
            concentrationIndex: 100,
            top3Concentration: 100,
            categoryGrowth: [],
          },
        },
      });
      reportService.getReport.mockResolvedValue(report);

      const result = await buildContext("user-category-h", "CATEGORY_SPENDING_EXPLANATION");

      expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
    }
  });

  it("returns the no-data result when a mandatory category field is missing", async () => {
    const baseValidMonthly = {
      hasData: true,
      topCategory: { category: "Groceries", total: 1234.567 },
      leastCategory: { category: "Books", total: 12.345 },
      categoryDistribution: [{ category: "Groceries", amount: 1234.567, percentage: 100 }],
      concentrationIndex: 37.77,
      top3Concentration: 12.34,
      categoryGrowth: [{ category: "Groceries", previous: 1000, current: 1234.567, change: 234.567, growthPercentage: 23.46, isNewCategory: false, trend: "up" }],
    };
    const fieldsToDrop = [
      "topCategory",
      "leastCategory",
      "categoryDistribution",
      "concentrationIndex",
      "top3Concentration",
      "categoryGrowth",
    ];

    for (const field of fieldsToDrop) {
      const { buildContext, reportService } = loadContextBuilder();
      const monthly = { ...baseValidMonthly };
      delete monthly[field];
      const report = buildFixtureReport({ categories: { monthly } });
      reportService.getReport.mockResolvedValue(report);

      const result = await buildContext("user-category-i", "CATEGORY_SPENDING_EXPLANATION");

      expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
    }
  });

  it("returns the no-data result when categoryDistribution or categoryGrowth has the wrong type", async () => {
    for (const wrongValue of [{}, "not-an-array", 42, null]) {
      const { buildContext, reportService } = loadContextBuilder();
      const report = buildFixtureReport({
        categories: {
          monthly: {
            hasData: true,
            topCategory: { category: "Groceries", total: 100 },
            leastCategory: { category: "Books", total: 10 },
            categoryDistribution: wrongValue,
            concentrationIndex: 100,
            top3Concentration: 100,
            categoryGrowth: [{ category: "Groceries", previous: 1, current: 2, change: 1, growthPercentage: 100, isNewCategory: false, trend: "up" }],
          },
        },
      });
      reportService.getReport.mockResolvedValue(report);

      const result = await buildContext("user-category-j1", "CATEGORY_SPENDING_EXPLANATION");
      expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });

      const { buildContext: buildContext2, reportService: reportService2 } = loadContextBuilder();
      const report2 = buildFixtureReport({
        categories: {
          monthly: {
            hasData: true,
            topCategory: { category: "Groceries", total: 100 },
            leastCategory: { category: "Books", total: 10 },
            categoryDistribution: [{ category: "Groceries", amount: 100, percentage: 100 }],
            concentrationIndex: 100,
            top3Concentration: 100,
            categoryGrowth: wrongValue,
          },
        },
      });
      reportService2.getReport.mockResolvedValue(report2);

      const result2 = await buildContext2("user-category-j2", "CATEGORY_SPENDING_EXPLANATION");
      expect(result2).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
    }
  });

  it("returns the no-data result when categoryDistribution or categoryGrowth is an empty array (empty collection means no usable breakdown)", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      categories: {
        monthly: {
          hasData: true,
          topCategory: { category: "Groceries", total: 100 },
          leastCategory: { category: "Books", total: 10 },
          categoryDistribution: [],
          concentrationIndex: 100,
          top3Concentration: 100,
          categoryGrowth: [{ category: "Groceries", previous: 1, current: 2, change: 1, growthPercentage: 100, isNewCategory: false, trend: "up" }],
        },
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-k1", "CATEGORY_SPENDING_EXPLANATION");
    expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });

    const { buildContext: buildContext2, reportService: reportService2 } = loadContextBuilder();
    const report2 = buildFixtureReport({
      categories: {
        monthly: {
          hasData: true,
          topCategory: { category: "Groceries", total: 100 },
          leastCategory: { category: "Books", total: 10 },
          categoryDistribution: [{ category: "Groceries", amount: 100, percentage: 100 }],
          concentrationIndex: 100,
          top3Concentration: 100,
          categoryGrowth: [],
        },
      },
    });
    reportService2.getReport.mockResolvedValue(report2);

    const result2 = await buildContext2("user-category-k2", "CATEGORY_SPENDING_EXPLANATION");
    expect(result2).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
  });

  // -- M2-4A reconciliation remediation: nested record contract validation --

  it("returns the no-data result when topCategory or leastCategory is missing category, missing total, has the wrong field type, or is not a plain object", async () => {
    const validTop = { category: "Groceries", total: 100 };
    const validLeast = { category: "Books", total: 10 };
    const malformedVariants = [
      { category: "Groceries" }, // missing total
      { total: 100 }, // missing category
      { category: "Groceries", total: undefined },
      { category: undefined, total: 100 },
      { category: 42, total: 100 }, // category wrong type
      { category: "Groceries", total: "100" }, // numeric string, not a number
      { category: "Groceries", total: NaN },
      { category: "Groceries", total: Infinity },
      { category: "Groceries", total: -Infinity },
      "Groceries", // not an object at all
      42,
      [{ category: "Groceries", total: 100 }], // array, not a plain object
      null,
    ];

    for (const malformed of malformedVariants) {
      // topCategory malformed, leastCategory otherwise valid.
      let loaded = loadContextBuilder();
      let report = buildFixtureReport({
        categories: {
          monthly: {
            hasData: true,
            topCategory: malformed,
            leastCategory: validLeast,
            categoryDistribution: [{ category: "Groceries", amount: 100, percentage: 100 }],
            concentrationIndex: 100,
            top3Concentration: 100,
            categoryGrowth: [{ category: "Groceries", previous: 1, current: 2, change: 1, growthPercentage: 100, isNewCategory: false, trend: "up" }],
          },
        },
      });
      loaded.reportService.getReport.mockResolvedValue(report);
      let result = await loaded.buildContext("user-category-malformed-top", "CATEGORY_SPENDING_EXPLANATION");
      expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });

      // leastCategory malformed, topCategory otherwise valid.
      loaded = loadContextBuilder();
      report = buildFixtureReport({
        categories: {
          monthly: {
            hasData: true,
            topCategory: validTop,
            leastCategory: malformed,
            categoryDistribution: [{ category: "Groceries", amount: 100, percentage: 100 }],
            concentrationIndex: 100,
            top3Concentration: 100,
            categoryGrowth: [{ category: "Groceries", previous: 1, current: 2, change: 1, growthPercentage: 100, isNewCategory: false, trend: "up" }],
          },
        },
      });
      loaded.reportService.getReport.mockResolvedValue(report);
      result = await loaded.buildContext("user-category-malformed-least", "CATEGORY_SPENDING_EXPLANATION");
      expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
    }
  });

  it("returns the no-data result when a categoryDistribution record is missing a mandatory field, has the wrong type, or is malformed", async () => {
    const validRecord = { category: "Groceries", amount: 100, percentage: 50 };
    const malformedRecords = [
      { amount: 100, percentage: 50 }, // missing category
      { category: "Groceries", percentage: 50 }, // missing amount
      { category: "Groceries", amount: 100 }, // missing percentage
      { category: "Groceries", amount: "100", percentage: 50 }, // amount as string
      { category: "Groceries", amount: 100, percentage: NaN },
      { category: "Groceries", amount: Infinity, percentage: 50 },
      { category: "Groceries", amount: -Infinity, percentage: 50 },
      { category: 42, amount: 100, percentage: 50 }, // category wrong type
      "not-an-object",
      42,
      null,
      ["Groceries", 100, 50], // array, not a plain object
    ];

    for (const malformed of malformedRecords) {
      const { buildContext, reportService } = loadContextBuilder();
      const report = buildFixtureReport({
        categories: {
          monthly: {
            hasData: true,
            topCategory: { category: "Groceries", total: 100 },
            leastCategory: { category: "Books", total: 10 },
            categoryDistribution: [validRecord, malformed],
            concentrationIndex: 100,
            top3Concentration: 100,
            categoryGrowth: [{ category: "Groceries", previous: 1, current: 2, change: 1, growthPercentage: 100, isNewCategory: false, trend: "up" }],
          },
        },
      });
      reportService.getReport.mockResolvedValue(report);

      const result = await buildContext("user-category-malformed-dist", "CATEGORY_SPENDING_EXPLANATION");
      expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
    }
  });

  it("returns the no-data result when a categoryGrowth record is missing a mandatory field, has an invalid growthPercentage/trend, or is malformed", async () => {
    const validRecord = { category: "Groceries", previous: 1000, current: 1200, change: 200, growthPercentage: 20, isNewCategory: false, trend: "up" };
    const malformedRecords = [
      { previous: 1000, current: 1200, change: 200, growthPercentage: 20, isNewCategory: false, trend: "up" }, // missing category
      { category: "Groceries", current: 1200, change: 200, growthPercentage: 20, isNewCategory: false, trend: "up" }, // missing previous
      { category: "Groceries", previous: 1000, change: 200, growthPercentage: 20, isNewCategory: false, trend: "up" }, // missing current
      { category: "Groceries", previous: 1000, current: 1200, growthPercentage: 20, isNewCategory: false, trend: "up" }, // missing change
      { category: "Groceries", previous: 1000, current: 1200, change: 200, isNewCategory: false, trend: "up" }, // missing growthPercentage key entirely (distinct from an explicit null)
      { category: "Groceries", previous: 1000, current: 1200, change: 200, growthPercentage: 20, trend: "up" }, // missing isNewCategory
      { category: "Groceries", previous: 1000, current: 1200, change: 200, growthPercentage: 20, isNewCategory: false }, // missing trend
      { category: "Groceries", previous: 1000, current: 1200, change: 200, growthPercentage: "20", isNewCategory: false, trend: "up" }, // growthPercentage as string
      { category: "Groceries", previous: 1000, current: 1200, change: 200, growthPercentage: NaN, isNewCategory: false, trend: "up" },
      { category: "Groceries", previous: 1000, current: 1200, change: 200, growthPercentage: Infinity, isNewCategory: false, trend: "up" },
      { category: "Groceries", previous: 1000, current: 1200, change: NaN, growthPercentage: 20, isNewCategory: false, trend: "up" },
      { category: "Groceries", previous: "1000", current: 1200, change: 200, growthPercentage: 20, isNewCategory: false, trend: "up" }, // previous as string
      { category: "Groceries", previous: 1000, current: 1200, change: 200, growthPercentage: 20, isNewCategory: "false", trend: "up" }, // isNewCategory as string
      { category: "Groceries", previous: 1000, current: 1200, change: 200, growthPercentage: 20, isNewCategory: false, trend: "sideways" }, // invalid trend
      { category: "Groceries", previous: 1000, current: 1200, change: 200, growthPercentage: 20, isNewCategory: false, trend: "UP" }, // wrong case, still invalid
      "not-an-object",
      null,
      ["Groceries", 1000, 1200],
    ];

    for (const malformed of malformedRecords) {
      const { buildContext, reportService } = loadContextBuilder();
      const report = buildFixtureReport({
        categories: {
          monthly: {
            hasData: true,
            topCategory: { category: "Groceries", total: 100 },
            leastCategory: { category: "Books", total: 10 },
            categoryDistribution: [{ category: "Groceries", amount: 100, percentage: 100 }],
            concentrationIndex: 100,
            top3Concentration: 100,
            categoryGrowth: [validRecord, malformed],
          },
        },
      });
      reportService.getReport.mockResolvedValue(report);

      const result = await buildContext("user-category-malformed-growth", "CATEGORY_SPENDING_EXPLANATION");
      expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
    }
  });

  it("returns the no-data result when concentrationIndex or top3Concentration is not a finite number (rejects strings, NaN, Infinity, objects, arrays)", async () => {
    for (const invalidValue of ["50", NaN, Infinity, -Infinity, {}, []]) {
      const { buildContext, reportService } = loadContextBuilder();
      const report = buildFixtureReport({
        categories: {
          monthly: {
            hasData: true,
            topCategory: { category: "Groceries", total: 100 },
            leastCategory: { category: "Books", total: 10 },
            categoryDistribution: [{ category: "Groceries", amount: 100, percentage: 100 }],
            concentrationIndex: invalidValue,
            top3Concentration: 50,
            categoryGrowth: [{ category: "Groceries", previous: 1, current: 2, change: 1, growthPercentage: 100, isNewCategory: false, trend: "up" }],
          },
        },
      });
      reportService.getReport.mockResolvedValue(report);

      const result = await buildContext("user-category-bad-concentration", "CATEGORY_SPENDING_EXPLANATION");
      expect(result).toEqual({ intent: "CATEGORY_SPENDING_EXPLANATION", fields: null, reason: "no_data" });
    }
  });

  it("preserves valid zero, negative, and decimal financial values across topCategory, leastCategory, categoryDistribution, categoryGrowth, concentrationIndex, and top3Concentration", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      categories: {
        monthly: {
          hasData: true,
          topCategory: { category: "Refunds", total: -45.5 },
          leastCategory: { category: "Freebies", total: 0 },
          categoryDistribution: [
            { category: "Refunds", amount: -45.5, percentage: 0 },
            { category: "Freebies", amount: 0, percentage: 0 },
          ],
          concentrationIndex: 0,
          top3Concentration: 0,
          categoryGrowth: [
            { category: "Refunds", previous: -10, current: -45.5, change: -35.5, growthPercentage: 355, isNewCategory: false, trend: "down" },
          ],
        },
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-negzero", "CATEGORY_SPENDING_EXPLANATION");

    expect(result.fields.categories.topCategory.total).toBe(-45.5);
    expect(result.fields.categories.leastCategory.total).toBe(0);
    expect(result.fields.categories.categoryDistribution[1].amount).toBe(0);
    expect(result.fields.categories.concentrationIndex).toBe(0);
    expect(result.fields.categories.top3Concentration).toBe(0);
    expect(result.fields.categories.categoryGrowth[0].previous).toBe(-10);
    expect(result.reason).toBeUndefined();
  });

  it("preserves whitespace-containing category names byte-for-byte -- no trimming or normalization", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const nameWithWhitespace = "  Groceries   And Snacks  ";
    const report = buildFixtureReport({
      categories: {
        monthly: {
          hasData: true,
          topCategory: { category: nameWithWhitespace, total: 10 },
          leastCategory: { category: nameWithWhitespace, total: 10 },
          categoryDistribution: [{ category: nameWithWhitespace, amount: 10, percentage: 100 }],
          concentrationIndex: 100,
          top3Concentration: 100,
          categoryGrowth: [{ category: nameWithWhitespace, previous: 0, current: 10, change: 10, growthPercentage: null, isNewCategory: true, trend: "up" }],
        },
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-whitespace", "CATEGORY_SPENDING_EXPLANATION");

    expect(result.fields.categories.topCategory.category).toBe(nameWithWhitespace);
    expect(result.fields.categories.categoryDistribution[0].category).toBe(nameWithWhitespace);
    expect(result.fields.categories.categoryGrowth[0].category).toBe(nameWithWhitespace);
  });

  it("preserves legitimate zero values in categoryGrowth (zero change, zero growthPercentage) instead of treating them as missing", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    const result = await buildContext("user-category-l", "CATEGORY_SPENDING_EXPLANATION");
    const rentGrowth = result.fields.categories.categoryGrowth.find((c) => c.category === "Rent");

    expect(rentGrowth.change).toBe(0);
    expect(rentGrowth.growthPercentage).toBe(0);
    expect(rentGrowth.trend).toBe("same");
    expect(result.reason).toBeUndefined();
  });

  it("preserves null growthPercentage for a newly-appearing category (isNewCategory: true) rather than coercing it to 0 or dropping it", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    const result = await buildContext("user-category-m", "CATEGORY_SPENDING_EXPLANATION");
    const booksGrowth = result.fields.categories.categoryGrowth.find((c) => c.category === "Books");

    expect(booksGrowth.growthPercentage).toBeNull();
    expect(booksGrowth.isNewCategory).toBe(true);
  });

  it("passes decimal, unrounded category values through unmodified -- no new rounding or recalculation", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    const result = await buildContext("user-category-n", "CATEGORY_SPENDING_EXPLANATION");

    expect(result.fields.categories.topCategory.total).toBe(1234.567);
    expect(result.fields.categories.leastCategory.total).toBe(12.345);
    expect(result.fields.categories.categoryDistribution[0].amount).toBe(1234.567);
  });

  it("passes an arithmetically-inconsistent fixture through completely unchanged -- proof that no summing, percentage recalculation, reconciliation, ranking, sorting, rounding, or month-over-month recomputation was added", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    const result = await buildContext("user-category-o", "CATEGORY_SPENDING_EXPLANATION");
    const { categories } = result.fields;

    // Sentinel: these percentages deliberately do NOT sum to 100 and are
    expect(categories.categoryDistribution.map((c) => c.percentage)).toEqual([999.99, 1.11, 50]);
    const percentageSum = categories.categoryDistribution.reduce((sum, c) => sum + c.percentage, 0);
    expect(percentageSum).not.toBe(100);
    // Sentinel: concentrationIndex/top3Concentration are arbitrary values
    expect(categories.concentrationIndex).toBe(37.77);
    expect(categories.top3Concentration).toBe(12.34);
    // Sentinel: Groceries' `change` (999.99) deliberately does not equal
    const groceriesGrowth = categories.categoryGrowth.find((c) => c.category === "Groceries");
    expect(groceriesGrowth.change).toBe(999.99);
    expect(groceriesGrowth.change).not.toBe(groceriesGrowth.current - groceriesGrowth.previous);
  });

  it("preserves category array order exactly as given -- no sorting or re-ranking", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      categories: {
        monthly: {
          hasData: true,
          topCategory: { category: "Zebra", total: 5 },
          leastCategory: { category: "Zebra", total: 5 },
          // Deliberately NOT sorted by amount (Zebra's 5 is smallest but
          // listed first) -- a sort-on-output builder would reorder this.
          categoryDistribution: [
            { category: "Zebra", amount: 5, percentage: 1 },
            { category: "Apple", amount: 500, percentage: 90 },
            { category: "Mango", amount: 50, percentage: 9 },
          ],
          concentrationIndex: 10,
          top3Concentration: 100,
          categoryGrowth: [
            { category: "Zebra", previous: 4, current: 5, change: 1, growthPercentage: 25, isNewCategory: false, trend: "up" },
            { category: "Apple", previous: 400, current: 500, change: 100, growthPercentage: 25, isNewCategory: false, trend: "up" },
            { category: "Mango", previous: 40, current: 50, change: 10, growthPercentage: 25, isNewCategory: false, trend: "up" },
          ],
        },
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-p", "CATEGORY_SPENDING_EXPLANATION");

    expect(result.fields.categories.categoryDistribution.map((c) => c.category)).toEqual(["Zebra", "Apple", "Mango"]);
    expect(result.fields.categories.categoryGrowth.map((c) => c.category)).toEqual(["Zebra", "Apple", "Mango"]);
  });

  it("supports a report with only a single category (no fixed minimum category count assumed)", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      categories: {
        monthly: {
          hasData: true,
          topCategory: { category: "Solo Category", total: 42 },
          leastCategory: { category: "Solo Category", total: 42 },
          categoryDistribution: [{ category: "Solo Category", amount: 42, percentage: 100 }],
          concentrationIndex: 100,
          top3Concentration: 100,
          categoryGrowth: [{ category: "Solo Category", previous: 0, current: 42, change: 42, growthPercentage: null, isNewCategory: true, trend: "up" }],
        },
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-q", "CATEGORY_SPENDING_EXPLANATION");

    expect(result.fields.categories.categoryDistribution).toHaveLength(1);
    expect(result.reason).toBeUndefined();
  });

  it("supports a report with more than fifteen categories (no fixed or maximum category count assumed)", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const categoryDistribution = [];
    const categoryGrowth = [];
    for (let i = 1; i <= 20; i += 1) {
      categoryDistribution.push({ category: `Category ${i}`, amount: i * 10, percentage: i });
      categoryGrowth.push({ category: `Category ${i}`, previous: i * 5, current: i * 10, change: i * 5, growthPercentage: 100, isNewCategory: false, trend: "up" });
    }
    const report = buildFixtureReport({
      categories: {
        monthly: {
          hasData: true,
          topCategory: { category: "Category 20", total: 200 },
          leastCategory: { category: "Category 1", total: 10 },
          categoryDistribution,
          concentrationIndex: 50,
          top3Concentration: 45,
          categoryGrowth,
        },
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-r", "CATEGORY_SPENDING_EXPLANATION");

    expect(result.fields.categories.categoryDistribution).toHaveLength(20);
    expect(result.fields.categories.categoryGrowth).toHaveLength(20);
    expect(result.fields.categories.categoryDistribution[19]).toEqual({ category: "Category 20", amount: 200, percentage: 20 });
  });

  it("preserves custom and Unicode category names exactly -- no allowlist, no normalization", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const customNames = ["M2-4A-CUSTOM-CATEGORY-!@#", "食料品", "🎮 Gaming & Hobbies", "Café con Leche", "Misc / Other"];
    const categoryDistribution = customNames.map((category, i) => ({ category, amount: (i + 1) * 10, percentage: 20 }));
    const categoryGrowth = customNames.map((category, i) => ({ category, previous: i * 5, current: (i + 1) * 10, change: 10, growthPercentage: 10, isNewCategory: false, trend: "up" }));
    const report = buildFixtureReport({
      categories: {
        monthly: {
          hasData: true,
          topCategory: { category: customNames[0], total: 10 },
          leastCategory: { category: customNames[1], total: 20 },
          categoryDistribution,
          concentrationIndex: 20,
          top3Concentration: 60,
          categoryGrowth,
        },
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-s", "CATEGORY_SPENDING_EXPLANATION");

    expect(result.fields.categories.categoryDistribution.map((c) => c.category)).toEqual(customNames);
    expect(result.fields.categories.topCategory.category).toBe("M2-4A-CUSTOM-CATEGORY-!@#");
    expect(result.fields.categories.leastCategory.category).toBe("食料品");
  });

  it("excludes biggestJump and biggestDrop from the category context even though categoryAnalyzer.js produces them", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    const result = await buildContext("user-category-t", "CATEGORY_SPENDING_EXPLANATION");
    const serialized = JSON.stringify(result);

    expect(result.fields.categories).not.toHaveProperty("biggestJump");
    expect(result.fields.categories).not.toHaveProperty("biggestDrop");
    expect(serialized).not.toContain("biggestJump");
    expect(serialized).not.toContain("biggestDrop");
  });

  it("excludes report.categories.yearly, raw expense arrays, income, financialHealth, trends, and budgets from the category context", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      income: [{ amount: 50000, source: "Salary" }],
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-u", "CATEGORY_SPENDING_EXPLANATION");
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("YEARLY-DECOY");
    expect(serialized).not.toContain("rawExpenses");
    expect(serialized).not.toContain("expenseAmount");
    expect(serialized).not.toContain("income");
    expect(serialized).not.toContain("Salary");
    expect(serialized).not.toContain("financialHealth");
    expect(serialized).not.toContain("monthlyTrend");
    expect(result.fields).not.toHaveProperty("financialHealth");
    expect(result.fields).not.toHaveProperty("trends");
    expect(result.fields).not.toHaveProperty("budget");
    expect(result.fields.categories).not.toHaveProperty("yearly");
    // Also proves no pre-written insight/advice text (categoryAnalyzer.js
    // produces none, unlike budgetAnalyzer.js's budgetInsights) leaked in.
    expect(serialized).not.toContain("budgetInsights");
  });

  it("excludes userId and database metadata from the category context", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const authenticatedUserId = "user-should-not-leak-category-v";
    const report = buildFixtureReport({
      _id: "507f1f77bcf86cd799439011",
      __v: 0,
      user: authenticatedUserId,
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext(authenticatedUserId, "CATEGORY_SPENDING_EXPLANATION");
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(authenticatedUserId);
    expect(serialized).not.toContain("_id");
    expect(serialized).not.toContain("__v");
    expect(Object.keys(result).sort()).toEqual(["fields", "intent", "sourceReportGeneratedAt"]);
  });

  it("sources sourceReportGeneratedAt for CATEGORY_SPENDING_EXPLANATION from report.metadata.generatedAt, the same convention as every other intent", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      metadata: { version: 1, generatedAt: "2026-03-01T09:30:00.000Z", reportPeriod: { month: 3, year: 2026 } },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-w", "CATEGORY_SPENDING_EXPLANATION");

    expect(result.sourceReportGeneratedAt).toBe("2026-03-01T09:30:00.000Z");
  });

  it("does not mutate the source Report object for CATEGORY_SPENDING_EXPLANATION", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = deepFreeze(buildFixtureReport());
    reportService.getReport.mockResolvedValue(report);

    await expect(buildContext("user-category-x", "CATEGORY_SPENDING_EXPLANATION")).resolves.toBeDefined();
  });

  // -- M2-4A reconciliation remediation: defensive-copy proof --

  it("returns category context objects/arrays that are new instances, not the same references as the Report's", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-refcheck", "CATEGORY_SPENDING_EXPLANATION");
    const sourceMonthly = report.categories.monthly;

    expect(result.fields.categories.topCategory).not.toBe(sourceMonthly.topCategory);
    expect(result.fields.categories.leastCategory).not.toBe(sourceMonthly.leastCategory);
    expect(result.fields.categories.categoryDistribution).not.toBe(sourceMonthly.categoryDistribution);
    expect(result.fields.categories.categoryGrowth).not.toBe(sourceMonthly.categoryGrowth);
    sourceMonthly.categoryDistribution.forEach((record, i) => {
      expect(result.fields.categories.categoryDistribution[i]).not.toBe(record);
    });
    sourceMonthly.categoryGrowth.forEach((record, i) => {
      expect(result.fields.categories.categoryGrowth[i]).not.toBe(record);
    });
  });

  it("mutating the returned category context after buildContext resolves does not mutate the original Report fixture (proves defensive copying, not just non-throwing on a frozen object)", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    // Snapshot the original values BEFORE any mutation via a separate
    const originalSnapshot = JSON.parse(JSON.stringify(report.categories.monthly));
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-mutate", "CATEGORY_SPENDING_EXPLANATION");

    // Mutate every returned mutable value: both top-level objects, both
    result.fields.categories.topCategory.category = "MUTATED";
    result.fields.categories.topCategory.total = -999999;
    result.fields.categories.leastCategory.category = "MUTATED";
    result.fields.categories.leastCategory.total = -999999;
    result.fields.categories.categoryDistribution.push({ category: "INJECTED", amount: 1, percentage: 1 });
    result.fields.categories.categoryDistribution[0].category = "MUTATED";
    result.fields.categories.categoryDistribution[0].amount = -999999;
    result.fields.categories.categoryGrowth.push({
      category: "INJECTED", previous: 0, current: 0, change: 0, growthPercentage: null, isNewCategory: false, trend: "same",
    });
    result.fields.categories.categoryGrowth[0].category = "MUTATED";
    result.fields.categories.categoryGrowth[0].change = -999999;

    expect(report.categories.monthly).toEqual(originalSnapshot);
  });

  it("excludes extra or sensitive properties placed on source topCategory/leastCategory/distribution/growth records from the returned context", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport({
      categories: {
        monthly: {
          hasData: true,
          topCategory: { category: "Groceries", total: 100, __secret: "SHOULD-NOT-LEAK", userId: "SHOULD-NOT-LEAK" },
          leastCategory: { category: "Books", total: 10, __secret: "SHOULD-NOT-LEAK" },
          categoryDistribution: [{ category: "Groceries", amount: 100, percentage: 100, __secret: "SHOULD-NOT-LEAK" }],
          concentrationIndex: 100,
          top3Concentration: 100,
          categoryGrowth: [
            { category: "Groceries", previous: 1, current: 2, change: 1, growthPercentage: 100, isNewCategory: false, trend: "up", __secret: "SHOULD-NOT-LEAK" },
          ],
        },
      },
    });
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-category-extra-props", "CATEGORY_SPENDING_EXPLANATION");
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("SHOULD-NOT-LEAK");
    expect(serialized).not.toContain("__secret");
    expect(Object.keys(result.fields.categories.topCategory).sort()).toEqual(["category", "total"]);
    expect(Object.keys(result.fields.categories.leastCategory).sort()).toEqual(["category", "total"]);
    expect(Object.keys(result.fields.categories.categoryDistribution[0]).sort()).toEqual(["amount", "category", "percentage"]);
    expect(Object.keys(result.fields.categories.categoryGrowth[0]).sort()).toEqual(
      ["category", "change", "current", "growthPercentage", "isNewCategory", "previous", "trend"].sort()
    );
  });

  it("HEALTH_EXPLANATION remains byte-for-byte unchanged after the CATEGORY_SPENDING_EXPLANATION branch was added, and gains no categories key", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-regression-health-category", "HEALTH_EXPLANATION");

    expect(result).toEqual({
      intent: "HEALTH_EXPLANATION",
      fields: {
        financialHealth: report.financialHealth,
        summary: { healthScore: 75, riskLevel: "Low" },
      },
      sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    });
    expect(result.fields).not.toHaveProperty("categories");
    expect(result.fields).not.toHaveProperty("budget");
  });

  it("SPENDING_CHANGE_EXPLANATION remains byte-for-byte unchanged after the CATEGORY_SPENDING_EXPLANATION branch was added, and gains no categories key", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-regression-spending-category", "SPENDING_CHANGE_EXPLANATION");

    expect(result).toEqual({
      intent: "SPENDING_CHANGE_EXPLANATION",
      fields: {
        trends: report.trends,
        summary: { comparePastMonth: 332.1, totalSpent: 4321 },
      },
      sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    });
    expect(result.fields).not.toHaveProperty("categories");
    expect(result.fields).not.toHaveProperty("budget");
  });

  it("BUDGET_STATUS_EXPLANATION remains byte-for-byte unchanged after the CATEGORY_SPENDING_EXPLANATION branch was added, and gains no categories key", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    const report = buildFixtureReport();
    reportService.getReport.mockResolvedValue(report);

    const result = await buildContext("user-regression-budget-category", "BUDGET_STATUS_EXPLANATION");

    expect(result).toEqual({
      intent: "BUDGET_STATUS_EXPLANATION",
      fields: {
        budget: {
          budget: 5000,
          spent: 3187.5,
          hasBudget: true,
          status: "Warning",
          isOverspent: false,
          exceededBy: 0,
          utilization: 63.75,
          remainingBudget: 1812.5,
          budgetLeft: 36.25,
          projectionStatus: "AtRisk",
          projectionReliable: true,
          projectedSpent: 4312.4,
          projectedOverspend: 0,
          projectedOverspendPercent: 0,
        },
      },
      sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    });
    expect(result.fields).not.toHaveProperty("categories");
  });

  it("an unsupported intent's existing no-data/no-reportService-call behavior is preserved after the CATEGORY_SPENDING_EXPLANATION branch was added", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    const result = await buildContext("user-unsupported-category-check", "SOME_UNKNOWN_INTENT");

    expect(reportService.getReport).not.toHaveBeenCalled();
    expect(result).toEqual({ intent: "SOME_UNKNOWN_INTENT", fields: null, reason: "no_data" });
  });
});
