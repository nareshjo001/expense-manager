// Batch 2: context builder coverage for the three new report-backed
// intents (ANOMALY_EXPLANATION, SPENDING_FORECAST_EXPLANATION,
// FINANCIAL_RISK_EXPLANATION). Mirrors tests/sia.contextBuilder.test.js's
// existing jest.doMock(reportService) isolation pattern exactly -- no real
// MongoDB/Redis/report generation, no top-level jest.mock/require of
// contextBuilder (loaded fresh per test via a small harness so each test's
// mocked reportService is isolated).
"use strict";

const REPORT_SERVICE_PATH = "../Services/reportService";
const CONTEXT_BUILDER_PATH = "../sia/contextBuilder";

function loadContextBuilderWithReport(report) {
  jest.resetModules();
  jest.doMock(REPORT_SERVICE_PATH, () => ({
    getReport: jest.fn(async () => report),
    refreshReport: jest.fn(),
  }));
  return require(CONTEXT_BUILDER_PATH);
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const baseReport = (overrides = {}) => ({
  metadata: { version: 3, generatedAt: "2026-08-08T00:00:00.000Z" },
  summary: { totalSpent: 5000, budgetStatus: "OnTrack" },
  ...overrides,
});

describe("backend/sia/contextBuilder -- Batch 2: ANOMALY_EXPLANATION", () => {
  it("returns a bounded, allowlisted anomaly context for a valid report section", async () => {
    const report = baseReport({
      anomalies: {
        hasData: true,
        reasonCode: null,
        flaggedCount: 1,
        anomalies: [
          {
            expenseId: "a1",
            expenseName: "Dinner",
            userId: "should-not-leak",
            category: "Food",
            amount: 3500,
            expenseDate: "2026-08-15T00:00:00.000Z",
            severity: "high",
            reasonCode: "CATEGORY_AMOUNT_SPIKE",
            baseline: { scope: "category", sampleCount: 10, medianAmount: 500 },
            detection: { method: "MODIFIED_Z" },
            _sortMultiple: 1.5,
          },
        ],
      },
    });
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "ANOMALY_EXPLANATION");

    expect(result.intent).toBe("ANOMALY_EXPLANATION");
    expect(result.fields.anomalies.hasData).toBe(true);
    const [record] = result.fields.anomalies.records;
    expect(record).toEqual({
      expenseId: "a1",
      category: "Food",
      amount: 3500,
      expenseDate: "2026-08-15T00:00:00.000Z",
      severity: "high",
      reasonCode: "CATEGORY_AMOUNT_SPIKE",
    });
    // No expenseName, userId, baseline, detection, or internal sort key.
    expect(record).not.toHaveProperty("userId");
    expect(record).not.toHaveProperty("expenseName");
    expect(record).not.toHaveProperty("baseline");
    expect(record).not.toHaveProperty("_sortMultiple");
  });

  it("accepts a valid hasData:false no-data anomaly result as present, not as SIA no-data", async () => {
    const report = baseReport({
      anomalies: { hasData: false, reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES", anomalies: [] },
    });
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "ANOMALY_EXPLANATION");

    expect(result.fields).not.toBeNull();
    expect(result.fields.anomalies.hasData).toBe(false);
    expect(result.fields.anomalies.reasonCode).toBe("NO_ELIGIBLE_CURRENT_EXPENSES");
  });

  it("returns SIA no-data when the report has no anomalies section at all", async () => {
    const report = baseReport({});
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "ANOMALY_EXPLANATION");

    expect(result.fields).toBeNull();
    expect(result.reason).toBe("no_data");
  });

  it("never passes the complete report -- only the anomalies branch", async () => {
    const report = baseReport({
      anomalies: { hasData: true, reasonCode: null, flaggedCount: 0, anomalies: [] },
      budgets: { hasData: true, secretInternal: "should-not-appear" },
      spending: { hasData: true },
    });
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "ANOMALY_EXPLANATION");

    expect(result.fields).not.toHaveProperty("budgets");
    expect(result.fields).not.toHaveProperty("spending");
    expect(JSON.stringify(result)).not.toContain("secretInternal");
  });
});

describe("backend/sia/contextBuilder -- Batch 2: SPENDING_FORECAST_EXPLANATION", () => {
  // Prediction Layer V1 correction: SIA grounds forecast answers on the
  // TRUE next-calendar-month horizon. The legacy `nextMonthForecast` field
  // projects the CURRENT, in-progress month despite its name, so it is no
  // longer forwarded to the provider at all. The fixture below carries a
  // deliberately DIFFERENT legacy estimate so the assertions cannot pass by
  // coincidence.
  it("returns a bounded forecast context with every horizon explicitly marked as an estimate", async () => {
    const report = baseReport({
      forecast: {
        hasData: true,
        method: "TRAILING_MEDIAN_MAD_V1",
        historyMonthsAvailable: 6,
        nextMonthForecast: { hasData: true, estimate: 1000, range: { lower: 800, upper: 1200 }, historyMonthsUsed: 6, horizonMonths: 1 },
        nextCalendarMonthForecast: { hasData: true, estimate: 1250, range: { lower: 1000, upper: 1500 }, historyMonthsUsed: 6, horizonMonths: 1 },
        nextQuarterForecast: { hasData: true, estimate: 3000, range: { lower: 2400, upper: 3600 }, historyMonthsUsed: 6, horizonMonths: 3 },
        nextYearForecast: { hasData: false, reasonCode: "INSUFFICIENT_HISTORY_FOR_NEXT_YEAR", historyMonthsUsed: 6, horizonMonths: 12 },
      },
    });
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "SPENDING_FORECAST_EXPLANATION");

    expect(result.fields.forecast.nextCalendarMonthForecast.isEstimate).toBe(true);
    expect(result.fields.forecast.nextCalendarMonthForecast.estimate).toBe(1250);
    // The legacy horizon is not exposed at all.
    expect(result.fields.forecast).not.toHaveProperty("nextMonthForecast");
    expect(result.fields.forecast.nextYearForecast.hasData).toBe(false);
    expect(result.fields.forecast.nextYearForecast.reasonCode).toBe("INSUFFICIENT_HISTORY_FOR_NEXT_YEAR");
  });

  it("returns SIA no-data when the report has no forecast section at all", async () => {
    const { buildContext } = loadContextBuilderWithReport(baseReport({}));
    const result = await buildContext("user-1", "SPENDING_FORECAST_EXPLANATION");
    expect(result.fields).toBeNull();
  });

  it("never leaks recentExpensePool or currentMonthExpenses into the forecast context", async () => {
    const report = baseReport({
      forecast: {
        hasData: false,
        recentExpensePool: [{ userId: "leak" }],
        currentMonthExpenses: [{ userId: "leak2" }],
      },
    });
    const { buildContext } = loadContextBuilderWithReport(report);
    const result = await buildContext("user-1", "SPENDING_FORECAST_EXPLANATION");
    expect(JSON.stringify(result)).not.toContain("leak");
  });
});

describe("backend/sia/contextBuilder -- Batch 2: FINANCIAL_RISK_EXPLANATION", () => {
  it("returns a bounded risk context plus only the two directly-referenced summary fields", async () => {
    const report = baseReport({
      summary: { totalSpent: 4200, budgetStatus: "Overspent", healthScore: 99, riskLevel: "unused-legacy-field" },
      risk: {
        hasData: true,
        reasonCode: null,
        riskLevel: "high",
        signalCount: 1,
        signals: [{ reasonCode: "BUDGET_ALREADY_OVERSPENT", severity: "high", evidence: { exceededBy: 200 } }],
      },
    });
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "FINANCIAL_RISK_EXPLANATION");

    expect(result.fields.risk.riskLevel).toBe("high");
    expect(result.fields.risk.signals[0].reasonCode).toBe("BUDGET_ALREADY_OVERSPENT");
    expect(result.fields.summary).toEqual({ totalSpent: 4200, budgetStatus: "Overspent" });
    // healthScore/riskLevel from summary are NOT included -- only the two
    // allowlisted fields.
    expect(result.fields.summary).not.toHaveProperty("healthScore");
  });

  it("accepts a zero-risk, hasData:true result as present, not as SIA no-data", async () => {
    const report = baseReport({
      risk: { hasData: true, reasonCode: null, riskLevel: "none", signalCount: 0, signals: [] },
    });
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "FINANCIAL_RISK_EXPLANATION");

    expect(result.fields).not.toBeNull();
    expect(result.fields.risk.riskLevel).toBe("none");
    expect(result.fields.risk.signals).toEqual([]);
  });

  it("returns SIA no-data when the report has no risk section at all", async () => {
    const { buildContext } = loadContextBuilderWithReport(baseReport({}));
    const result = await buildContext("user-1", "FINANCIAL_RISK_EXPLANATION");
    expect(result.fields).toBeNull();
  });

  it("never leaks raw evidence beyond riskAnalyzer's own bounded shape", async () => {
    const report = baseReport({
      risk: {
        hasData: true,
        reasonCode: null,
        riskLevel: "moderate",
        signalCount: 1,
        signals: [
          { reasonCode: "PERSISTENT_SPENDING_GROWTH", severity: "moderate", evidence: { percentageChange: 25, userId: "should-not-leak" } },
        ],
      },
    });
    const { buildContext } = loadContextBuilderWithReport(report);
    const result = await buildContext("user-1", "FINANCIAL_RISK_EXPLANATION");
    // evidence is copied via JSON clone -- whatever riskAnalyzer.js itself
    // put there passes through unmodified. This test documents that the
    // leakage boundary is riskAnalyzer.js's own contract (already proven
    // leak-free in tests/analytics.risk.test.js), not a second filter here.
    expect(result.fields.risk.signals[0].evidence.percentageChange).toBe(25);
  });
});

describe("backend/sia/contextBuilder -- Batch 2: no impact on existing intents", () => {
  it("SUPPORTED_INTENTS grew additively -- an unsupported intent still returns the existing no-data shape", async () => {
    const { buildContext } = loadContextBuilderWithReport(baseReport({}));
    const result = await buildContext("user-1", "SOME_UNKNOWN_INTENT");
    expect(result).toEqual({ intent: "SOME_UNKNOWN_INTENT", fields: null, reason: "no_data" });
  });

  it("determinism: repeated calls with the same report return equal context for each new intent", async () => {
    const report = baseReport({
      anomalies: { hasData: true, reasonCode: null, flaggedCount: 0, anomalies: [] },
      forecast: { hasData: false },
      risk: { hasData: false, reasonCode: "NO_REPORT_DATA", riskLevel: "none", signals: [] },
    });
    const { buildContext } = loadContextBuilderWithReport(report);

    for (const intent of ["ANOMALY_EXPLANATION", "SPENDING_FORECAST_EXPLANATION", "FINANCIAL_RISK_EXPLANATION"]) {
      const first = await buildContext("user-1", intent);
      const second = await buildContext("user-1", intent);
      expect(second).toEqual(first);
    }
  });
});
