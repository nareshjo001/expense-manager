// Unit tests for backend/sia/contextBuilder.js.
//
// reportService.getReport is fully mocked -- no MongoDB, Redis, ML service,
// HTTP route, or external network is ever touched. Follows the same
// module-reset isolation style as tests/sia.config.test.js: each test loads
// a fresh module registry and a fresh mock, so no mock call history or
// mock implementation can leak between tests.
//
// M1-2 production-contract correction (Option A): the real report shape
// never populates summary.healthScore/summary.riskLevel -- confirmed by
// tracing healthAnalyzer.js -> reportGenerator.js -> Report.js. The real
// source values are report.financialHealth.overall and
// report.financialHealth.risk.label. This fixture reflects that real shape
// (no summary.healthScore/summary.riskLevel by default, matching
// tests/fixtures/reportFixtures.js's buildFakeCachedReport), and a
// dedicated test below proves decoy values planted at those broken
// locations are never read.
"use strict";

// Loads a brand-new reportService mock and a brand-new contextBuilder module
// for a single test, so `getReport`'s call history and resolved/rejected
// value are always specific to the test that set them up.
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
// real FinancialReport document could carry is present, so "unrelated
// fields are excluded" and "raw data is excluded" tests have real
// extraneous data to prove is actually dropped -- not just absent by
// coincidence. Deliberately does NOT include summary.healthScore or
// summary.riskLevel, because a real generated report never has them (see
// the M1-2 contract-gap verification).
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
    // `analyze()` output (plus `budgetInsights`, which
    // analytics/reportGenerator.js spreads in alongside it as
    // `budgets: { ...budgetReport, budgetInsights }`). Deliberately uses
    // non-round numbers so a test asserting an exact value proves the field
    // was passed through unmodified rather than recalculated/re-rounded.
    // Like the top-level `...overrides` spread at the end of this function,
    // a test that passes `overrides.budgets` replaces this whole object
    // (the same full-replacement convention `financialHealth`/`summary`
    // already follow below) -- tests below that only need to change one or
    // two fields do so with an intentionally minimal `budgets` override.
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
    categories: { monthly: { hasData: true }, yearly: { hasData: true } },
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
    // array that must never leak through" so the exclusion tests below
    // have something concrete to prove is dropped.
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
    // leftover healthScore/riskLevel values that do NOT match
    // financialHealth.overall/.risk.label. The correct output must come
    // from financialHealth only.
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
    // mutation of `report` (or any nested object within it) throws instead
    // of silently succeeding.
    await expect(buildContext("user-p", "HEALTH_EXPLANATION")).resolves.toBeDefined();
    await expect(buildContext("user-p", "SPENDING_CHANGE_EXPLANATION")).resolves.toBeDefined();
  });

  // -- M2-3A: BUDGET_STATUS_EXPLANATION -------------------------------------
  // Context foundation only -- no classifier, prompt, controller, or
  // response-formatting behavior exists yet for this intent.

  it("BUDGET_STATUS_EXPLANATION is a supported intent (reaches reportService, unlike an unsupported intent)", async () => {
    const { buildContext, reportService } = loadContextBuilder();
    reportService.getReport.mockResolvedValue(buildFixtureReport());

    await buildContext("user-budget-a", "BUDGET_STATUS_EXPLANATION");

    expect(reportService.getReport).toHaveBeenCalledTimes(1);
    expect(reportService.getReport).toHaveBeenCalledWith("user-budget-a");
  });

  it("SUPPORTED_INTENTS contains exactly HEALTH_EXPLANATION, SPENDING_CHANGE_EXPLANATION, and BUDGET_STATUS_EXPLANATION -- proven behaviorally, not assumed", async () => {
    const supported = ["HEALTH_EXPLANATION", "SPENDING_CHANGE_EXPLANATION", "BUDGET_STATUS_EXPLANATION"];
    for (const intent of supported) {
      const { buildContext, reportService } = loadContextBuilder();
      reportService.getReport.mockResolvedValue(buildFixtureReport());
      await buildContext("user-supported", intent);
      expect(reportService.getReport).toHaveBeenCalledTimes(1);
    }

    // Includes plausible-looking but NOT-added identifiers, to prove no
    // extra intent was accidentally introduced alongside the real one.
    const unsupported = [
      "SOME_UNKNOWN_INTENT",
      "BUDGET_RISK_EXPLANATION",
      "BUDGET_UTILIZATION_EXPLANATION",
      "budget_status_explanation",
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
    // (e.g. accidentally reading the wrong source field) would fail this
    // exact-equality check rather than passing by coincidence.
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
      // Report has no real `income` field at all (confirmed in
      // backend/models/Report.js), but this proves it would be dropped if
      // present.
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
});
