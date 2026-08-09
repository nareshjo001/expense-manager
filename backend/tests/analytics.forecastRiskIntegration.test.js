// Forecasting V1 + Risk Intelligence V1 -- Batch 2: integration between
// analytics/reportGenerator.js, forecastAnalyzer.js, riskAnalyzer.js, and
// analytics/reportAssembler.js. Mirrors
// tests/analytics.anomalyIntegration.test.js's harness pattern exactly.
"use strict";

const ANALYTICS_CONTEXT_PATH = "../analytics/analyticsContext";
const SPENDING_ANALYZER_PATH = "../analytics/analyzers/spendingAnalyzer";
const BUDGET_ANALYZER_PATH = "../analytics/analyzers/budgetAnalyzer";
const CATEGORY_ANALYZER_PATH = "../analytics/analyzers/categoryAnalyzer";
const TREND_ANALYZER_PATH = "../analytics/analyzers/trendAnalyzer";
const HABIT_ANALYZER_PATH = "../analytics/analyzers/habitAnalyzer";
const HEALTH_ANALYZER_PATH = "../analytics/analyzers/healthAnalyzer";
const FORECAST_ANALYZER_PATH = "../analytics/analyzers/forecastAnalyzer";
const RISK_ANALYZER_PATH = "../analytics/analyzers/riskAnalyzer";
const BUDGET_INSIGHT_SERVICE_PATH = "../Services/BudgetServices/budgetInsight.service";
const REPORT_GENERATOR_PATH = "../analytics/reportGenerator";

const CURRENT_MONTH_START = new Date(2026, 7, 1);

function baseMocks(contextOverrides = {}) {
  jest.doMock(ANALYTICS_CONTEXT_PATH, () => ({
    createAnalyticsContext: jest.fn(async () => ({
      currentMonthExpenses: [],
      previousMonthExpenses: [],
      currentYearExpenses: [],
      previousYearExpenses: [],
      budgetHistory: [],
      trendData: {},
      daysInMonth: 31,
      recentExpensePool: [],
      currentMonthStart: CURRENT_MONTH_START,
      // Architecture-closure correction: analyticsContext.js's real
      // forecastInputAggregator boundary is bypassed by this mock (this
      // suite mocks createAnalyticsContext itself), so the aggregate-only
      // forecast inputs it would normally produce must be supplied
      // directly here, exactly as reportGenerator.js now expects them.
      forecastMonthlySeries: [],
      forecastCurrentPartialMonthTotal: 0,
      ...contextOverrides,
    })),
  }));

  jest.doMock(SPENDING_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasData: true, totalSpent: 100, transactionCount: 1, dailyAverage: 10 })),
  }));
  jest.doMock(BUDGET_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({
      hasData: true,
      hasBudget: true,
      budget: 5000,
      spent: 100,
      isOverspent: false,
      exceededBy: 0,
      utilization: 2,
      remainingBudget: 4900,
      budgetLeft: 4900,
      status: "OnTrack",
      projectionStatus: "OnTrack",
      projectionReliable: true,
      projectedSpent: 100,
      projectedOverspend: 0,
      projectedOverspendPercent: 0,
    })),
  }));
  jest.doMock(CATEGORY_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasData: true, topCategory: { category: "Test" } })),
  }));
  jest.doMock(TREND_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasData: true, monthlyTrend: { percentageChange: 5 } })),
  }));
  jest.doMock(HABIT_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasData: true })),
  }));
  jest.doMock(HEALTH_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({
      scores: {},
      overall: 80,
      dataCompleteness: { includedModules: [], excludedModules: [] },
      risk: { label: "Low", color: "green" },
      signals: [],
    })),
  }));
  jest.doMock(BUDGET_INSIGHT_SERVICE_PATH, () => ({
    generateBudgetInsights: jest.fn(() => ({})),
  }));
}

// Loads a harness with forecastAnalyzer/riskAnalyzer themselves mocked (as
// spies), to prove exactly what reportGenerator.js passes into each.
function loadHarnessWithMockedForecastAndRisk(contextOverrides = {}) {
  jest.resetModules();
  jest.dontMock(FORECAST_ANALYZER_PATH);
  jest.dontMock(RISK_ANALYZER_PATH);
  baseMocks(contextOverrides);

  const FORECAST_MARKER = { hasData: false, marker: "FORECAST_MARKER" };
  const RISK_MARKER = { hasData: false, marker: "RISK_MARKER" };
  const forecastAnalyzeMock = jest.fn(() => FORECAST_MARKER);
  const riskAnalyzeMock = jest.fn(() => RISK_MARKER);

  jest.doMock(FORECAST_ANALYZER_PATH, () => ({ analyze: forecastAnalyzeMock }));
  jest.doMock(RISK_ANALYZER_PATH, () => ({ analyze: riskAnalyzeMock }));

  const { generateReport } = require(REPORT_GENERATOR_PATH);
  const forecastAnalyzer = require(FORECAST_ANALYZER_PATH);
  const riskAnalyzer = require(RISK_ANALYZER_PATH);

  return { generateReport, forecastAnalyzer, riskAnalyzer, FORECAST_MARKER, RISK_MARKER };
}

// Loads a harness with the REAL, unmocked forecastAnalyzer/riskAnalyzer, so
// genuine end-to-end forecast/risk content can be proven through report
// generation.
function loadHarnessWithRealForecastAndRisk(contextOverrides = {}) {
  jest.resetModules();
  jest.dontMock(FORECAST_ANALYZER_PATH);
  jest.dontMock(RISK_ANALYZER_PATH);
  baseMocks(contextOverrides);

  const { generateReport } = require(REPORT_GENERATOR_PATH);
  return { generateReport };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

// Real, contiguous `${year}-${monthIndex}` calendar keys ending at the
// month immediately before CURRENT_MONTH_START -- forecastAnalyzer.js now
// fits its trend against real calendar-month ordinals (see the
// calendar-gap fix in analytics/analyzers/forecastAnalyzer.js), so a
// placeholder key like "series-0" would be silently dropped as
// unparseable rather than counted as history.
function stableSeries(monthsBack, amount) {
  return Array.from({ length: monthsBack }, (_, i) => {
    const monthsAgo = monthsBack - i;
    const d = new Date(CURRENT_MONTH_START.getFullYear(), CURRENT_MONTH_START.getMonth() - monthsAgo, 1);
    return { monthKey: `${d.getFullYear()}-${d.getMonth()}`, totalAmount: amount };
  });
}

describe("reportGenerator: forecastAnalyzer/riskAnalyzer wiring (A)", () => {
  it("calls forecastAnalyzer.analyze() exactly once with only the bounded aggregate inputs -- never recentExpensePool/currentMonthExpenses", async () => {
    const forecastMonthlySeries = stableSeries(6, 1000);
    const { generateReport, forecastAnalyzer } = loadHarnessWithMockedForecastAndRisk({
      forecastMonthlySeries,
      forecastCurrentPartialMonthTotal: 250,
      recentExpensePool: [{ _id: "should-never-reach-forecast", userId: "u1" }],
    });

    await generateReport("user-1");

    expect(forecastAnalyzer.analyze).toHaveBeenCalledTimes(1);
    const [callArgs] = forecastAnalyzer.analyze.mock.calls[0];
    // Prediction Layer V1 added three further inputs -- categorySeries,
    // activeDays and targetMonthBudget. This assertion stays EXACT (an
    // exhaustive key list, not a subset check) precisely so any future
    // argument added here has to be declared deliberately, which is what
    // makes it a real aggregate-only boundary guard rather than a formality.
    expect(Object.keys(callArgs).sort()).toEqual(
      [
        "monthlySeries",
        "currentPartialMonthTotal",
        "currentMonthStart",
        "categorySeries",
        "activeDays",
        "targetMonthBudget",
      ].sort()
    );
    expect(callArgs.monthlySeries).toBe(forecastMonthlySeries);
    expect(callArgs.currentPartialMonthTotal).toBe(250);
    expect(callArgs.currentMonthStart).toBe(CURRENT_MONTH_START);
    // The raw pool is never one of the arguments forecastAnalyzer.analyze()
    // was called with -- including via any of the newly-added inputs.
    expect(JSON.stringify(callArgs)).not.toContain("should-never-reach-forecast");
  });

  it("calls riskAnalyzer.analyze() exactly once with only already-computed report sections, including the forecast result", async () => {
    const { generateReport, riskAnalyzer, FORECAST_MARKER } = loadHarnessWithMockedForecastAndRisk();

    await generateReport("user-1");

    expect(riskAnalyzer.analyze).toHaveBeenCalledTimes(1);
    const [callArgs] = riskAnalyzer.analyze.mock.calls[0];
    expect(Object.keys(callArgs).sort()).toEqual(
      ["spending", "budgets", "trends", "financialHealth", "anomalies", "forecast"].sort()
    );
    expect(callArgs.forecast).toBe(FORECAST_MARKER);
  });

  it("passes each analyzer's own return value through to the assembled report unmodified", async () => {
    const { generateReport, FORECAST_MARKER, RISK_MARKER } = loadHarnessWithMockedForecastAndRisk();

    const report = await generateReport("user-1");

    expect(report.forecast).toBe(FORECAST_MARKER);
    expect(report.risk).toBe(RISK_MARKER);
  });
});

describe("reportGenerator + real forecast/risk analyzers: end-to-end report content (B)", () => {
  it("a report with sufficient history produces a real nextMonthForecast", async () => {
    const forecastMonthlySeries = stableSeries(6, 1000);
    const { generateReport } = loadHarnessWithRealForecastAndRisk({ forecastMonthlySeries });

    const report = await generateReport("user-1");

    expect(report.forecast.hasData).toBe(true);
    expect(report.forecast.nextMonthForecast.hasData).toBe(true);
    expect(report.forecast.nextMonthForecast.estimate).toBe(1000);
  });

  it("insufficient forecast history still produces a valid no-data forecast section without breaking the report", async () => {
    const { generateReport } = loadHarnessWithRealForecastAndRisk({ forecastMonthlySeries: [] });

    const report = await generateReport("user-1");

    expect(report.forecast.hasData).toBe(false);
    expect(report.metadata).toBeDefined();
    expect(report.summary).toBeDefined();
  });

  it("risk is computed from the real report sections and reflects an overspent budget", async () => {
    jest.resetModules();
    jest.dontMock(FORECAST_ANALYZER_PATH);
    jest.dontMock(RISK_ANALYZER_PATH);
    baseMocks({ forecastMonthlySeries: [] });
    // Override the budget analyzer mock for this one test to simulate an
    // overspent budget, proving riskAnalyzer.js's real evaluation runs
    // against reportGenerator.js's real budgetReport.
    jest.doMock(BUDGET_ANALYZER_PATH, () => ({
      analyze: jest.fn(() => ({
        hasData: true,
        hasBudget: true,
        budget: 1000,
        spent: 1200,
        isOverspent: true,
        exceededBy: 200,
        utilization: 120,
        remainingBudget: 0,
        budgetLeft: 0,
        status: "Overspent",
        projectionStatus: "Overspent",
        projectionReliable: true,
        projectedSpent: 1200,
        projectedOverspend: 200,
        projectedOverspendPercent: 20,
      })),
    }));

    const { generateReport } = require(REPORT_GENERATOR_PATH);
    const report = await generateReport("user-1");

    expect(report.risk.hasData).toBe(true);
    expect(report.risk.signals.some((s) => s.reasonCode === "BUDGET_ALREADY_OVERSPENT")).toBe(true);
  });

  it("repeated generation from identical inputs is deterministic for both forecast and risk", async () => {
    const forecastMonthlySeries = stableSeries(6, 1000);

    const harnessA = loadHarnessWithRealForecastAndRisk({ forecastMonthlySeries });
    const reportA = await harnessA.generateReport("user-1");

    const harnessB = loadHarnessWithRealForecastAndRisk({ forecastMonthlySeries });
    const reportB = await harnessB.generateReport("user-1");

    expect(reportB.forecast).toEqual(reportA.forecast);
    expect(reportB.risk).toEqual(reportA.risk);
  });

  it("never leaks userId or raw expense records into forecast or risk sections", async () => {
    const forecastMonthlySeries = stableSeries(6, 1000);
    const { generateReport } = loadHarnessWithRealForecastAndRisk({
      forecastMonthlySeries,
      recentExpensePool: [{ _id: "leak-id", userId: "leak-user", expenseName: "leak-name" }],
    });

    const report = await generateReport("user-1");
    const serialized = JSON.stringify({ forecast: report.forecast, risk: report.risk });

    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("recentExpensePool");
    expect(serialized).not.toContain("leak-id");
    expect(serialized).not.toContain("leak-user");
    expect(serialized).not.toContain("leak-name");
  });
});
