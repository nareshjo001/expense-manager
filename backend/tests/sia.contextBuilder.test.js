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
    budgets: { hasData: true, utilization: 43.21 },
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
});
