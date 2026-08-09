// Prediction Layer V1: SIA forecast-grounding regression suite.
//
// Proves that the forecast context SIA sends to the provider carries the
// new structured fields (categories, budget risk, data quality, target
// month) and that it still carries NOTHING transaction-shaped: no expense
// records, no merchant/expense names, no ids, no raw monthly history series.
//
// Mirrors tests/sia.contextBuilder.batch2.test.js's isolation harness
// exactly (jest.doMock on reportService, contextBuilder loaded fresh per
// test) -- no real MongoDB/Redis/report generation.
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

const FORECAST_INTENT = "SPENDING_FORECAST_EXPLANATION";

// Loads the builder against `report` and returns the forecast context.
async function forecastContextFor(report) {
  const { buildContext } = loadContextBuilderWithReport(report);
  const result = await buildContext("user-1", FORECAST_INTENT);
  return result.fields.forecast;
}

const baseReport = (overrides = {}) => ({
  metadata: { generatedAt: "2026-08-09T00:00:00.000Z", version: 4 },
  forecast: {
    hasData: true,
    method: "ROBUST_TREND_MEDIAN_V2",
    historyMonthsAvailable: 8,
    targetMonth: "2026-09",
    dataQuality: {
      status: "sufficient",
      completedMonths: 8,
      activeDays: 96,
      method: "ROBUST_TREND_MEDIAN_V2",
      warnings: [],
    },
    // LEGACY field carries a deliberately DIFFERENT value throughout this
    // suite, so any assertion below that reads 12500 proves the true
    // next-calendar field was used and the legacy one was not.
    nextMonthForecast: {
      hasData: true,
      reasonCode: null,
      method: "ROBUST_TREND_MEDIAN_V2",
      estimate: 999999,
      range: { lower: 900000, upper: 1100000 },
      historyMonthsUsed: 8,
      horizonMonths: 1,
    },
    nextCalendarMonthForecast: {
      hasData: true,
      reasonCode: null,
      targetMonth: "2026-09",
      estimate: 12500,
      range: { lower: 11000, upper: 14000 },
      historyMonthsUsed: 8,
      horizonMonths: 1,
      categories: [
        { category: "Food", predictedAmount: 6000, sharePercentage: 48, method: "CATEGORY_ROBUST_TREND" },
        { category: "Travel", predictedAmount: 4000, sharePercentage: 32, method: "CATEGORY_ROBUST_TREND" },
        { category: "Bills", predictedAmount: 2500, sharePercentage: 20, method: "CATEGORY_SMOOTHED_SHARE" },
      ],
      categoriesReasonCode: null,
    },
    nextQuarterForecast: {
      hasData: true,
      reasonCode: null,
      estimate: 38000,
      range: { lower: 33000, upper: 43000 },
      historyMonthsUsed: 8,
      horizonMonths: 3,
    },
    nextYearForecast: {
      hasData: false,
      reasonCode: "INSUFFICIENT_HISTORY_FOR_NEXT_YEAR",
      estimate: null,
      range: null,
      historyMonthsUsed: 8,
      horizonMonths: 12,
    },
    budgetRisk: {
      status: "watch",
      budgetAmount: 15000,
      predictedUtilizationPercentage: 83.33,
      predictedRemaining: 2500,
    },
    ...overrides,
  },
});

describe("SIA forecast grounding -- structured fields (Prediction Layer V1)", () => {
  it("includes the target month, data quality and budget risk", async () => {
    const forecast = await forecastContextFor(baseReport());

    expect(forecast.targetMonth).toBe("2026-09");
    expect(forecast.dataQuality).toEqual({
      status: "sufficient",
      completedMonths: 8,
      activeDays: 96,
      warnings: [],
    });
    expect(forecast.budgetRisk).toEqual({
      status: "watch",
      budgetAmount: 15000,
      predictedUtilizationPercentage: 83.33,
      predictedRemaining: 2500,
      isEstimate: true,
    });
  });

  it("includes the category breakdown, each entry explicitly marked as an estimate", async () => {
    const forecast = await forecastContextFor(baseReport());

    expect(forecast.nextCalendarMonthForecast.categories).toEqual([
      { category: "Food", predictedAmount: 6000, sharePercentage: 48, isEstimate: true },
      { category: "Travel", predictedAmount: 4000, sharePercentage: 32, isEstimate: true },
      { category: "Bills", predictedAmount: 2500, sharePercentage: 20, isEstimate: true },
    ]);
    // The internal per-category method label is deliberately NOT sent to
    // the provider -- it is an implementation detail, not an answer input.
    for (const entry of forecast.nextCalendarMonthForecast.categories) {
      expect(entry).not.toHaveProperty("method");
    }
  });

  it("bounds the number of categories so a many-category account cannot grow the prompt without limit", async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      category: `Category ${index}`,
      predictedAmount: 100 - index,
      sharePercentage: 2,
      method: "CATEGORY_ROBUST_TREND",
    }));
    const report = baseReport();
    report.forecast.nextCalendarMonthForecast.categories = many;

    const forecast = await forecastContextFor(report);

    expect(forecast.nextCalendarMonthForecast.categories.length).toBeLessThanOrEqual(5);
    // The largest contributors are the ones kept -- which is exactly what a
    // "which category will be highest" question needs.
    expect(forecast.nextCalendarMonthForecast.categories[0].category).toBe("Category 0");
  });

  it("never leaks transaction-shaped data into the forecast context", async () => {
    const report = baseReport();
    // Deliberately contaminate the source report with things that must not
    // survive the copy boundary.
    report.forecast.nextCalendarMonthForecast.categories[0].expenseId = "64f1a2b3c4d5e6f7a8b9c0d1";
    report.forecast.nextCalendarMonthForecast.categories[0].expenseName = "Corner Store Purchase";
    report.forecast.internalSeries = [{ monthKey: "2026-1", totalAmount: 900 }];
    report.forecast.userId = "64f1a2b3c4d5e6f7a8b9c0d2";

    const serialized = JSON.stringify(await forecastContextFor(report));

    expect(serialized).not.toContain("expenseId");
    expect(serialized).not.toContain("Corner Store Purchase");
    expect(serialized).not.toContain("internalSeries");
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("monthKey");
    expect(serialized).not.toMatch(/\b[a-f0-9]{24}\b/i);
  });

  it("passes through an unavailable forecast with its real reason, inventing no numbers", async () => {
    const report = baseReport();
    report.forecast.hasData = false;
    report.forecast.nextCalendarMonthForecast = {
      hasData: false,
      reasonCode: "INSUFFICIENT_HISTORY_FOR_NEXT_MONTH",
      estimate: null,
      range: null,
      historyMonthsUsed: 1,
      horizonMonths: 1,
      categories: [],
      categoriesReasonCode: "NO_CATEGORY_BREAKDOWN_AVAILABLE",
    };
    report.forecast.dataQuality = {
      status: "limited",
      completedMonths: 1,
      activeDays: 4,
      method: "ROBUST_TREND_MEDIAN_V2",
      warnings: ["LIMITED_HISTORY"],
    };
    report.forecast.budgetRisk = {
      status: "insufficient_data",
      budgetAmount: null,
      predictedUtilizationPercentage: null,
      predictedRemaining: null,
    };

    const forecast = await forecastContextFor(report);

    expect(forecast.hasData).toBe(false);
    expect(forecast.nextCalendarMonthForecast.estimate).toBeNull();
    expect(forecast.nextCalendarMonthForecast.reasonCode).toBe("INSUFFICIENT_HISTORY_FOR_NEXT_MONTH");
    expect(forecast.nextCalendarMonthForecast.categories).toEqual([]);
    expect(forecast.dataQuality.status).toBe("limited");
    expect(forecast.dataQuality.warnings).toEqual(["LIMITED_HISTORY"]);
    expect(forecast.budgetRisk.status).toBe("insufficient_data");
  });

  it("reports no_budget rather than a comparison when no target-month budget exists", async () => {
    const report = baseReport();
    report.forecast.budgetRisk = {
      status: "no_budget",
      budgetAmount: null,
      predictedUtilizationPercentage: null,
      predictedRemaining: null,
    };

    const forecast = await forecastContextFor(report);

    expect(forecast.budgetRisk.status).toBe("no_budget");
    expect(forecast.budgetRisk.budgetAmount).toBeNull();
    expect(forecast.budgetRisk.predictedUtilizationPercentage).toBeNull();
  });

  it("tolerates a legacy version-3 forecast section that has none of the new fields", async () => {
    const report = baseReport();
    delete report.forecast.targetMonth;
    delete report.forecast.dataQuality;
    delete report.forecast.budgetRisk;
    delete report.forecast.nextCalendarMonthForecast.categories;

    const forecast = await forecastContextFor(report);

    expect(forecast.targetMonth).toBeNull();
    expect(forecast.dataQuality).toBeNull();
    expect(forecast.budgetRisk).toBeNull();
    expect(forecast.nextCalendarMonthForecast.categories).toEqual([]);
    // The pre-existing horizon fields still work exactly as before.
    expect(forecast.nextCalendarMonthForecast.estimate).toBe(12500);
  });

  // Prediction Layer V1 remediation: the decisive conflicting-value proof.
  // The legacy `nextMonthForecast` field projects the CURRENT, in-progress
  // month despite its name, so grounding a "next month" answer on it would
  // silently answer a different question.
  it("grounds on the TRUE next-calendar forecast and never sends the conflicting legacy value", async () => {
    const forecast = await forecastContextFor(baseReport());

    expect(forecast.nextCalendarMonthForecast.estimate).toBe(12500);
    expect(forecast.nextCalendarMonthForecast.targetMonth).toBe("2026-09");

    // The legacy field is not forwarded at all, and its distinctive value
    // appears nowhere in what the provider receives.
    expect(forecast).not.toHaveProperty("nextMonthForecast");
    expect(JSON.stringify(forecast)).not.toContain("999999");
  });

  it("reports the next-calendar forecast as unavailable rather than substituting the legacy value", async () => {
    const report = baseReport();
    // Legacy stays perfectly healthy and available...
    expect(report.forecast.nextMonthForecast.hasData).toBe(true);
    // ...but the true field is missing entirely.
    delete report.forecast.nextCalendarMonthForecast;

    const forecast = await forecastContextFor(report);

    expect(forecast.nextCalendarMonthForecast).toBeNull();
    expect(JSON.stringify(forecast)).not.toContain("999999");
  });

  it("still marks every horizon as an estimate", async () => {
    const forecast = await forecastContextFor(baseReport());

    expect(forecast.nextCalendarMonthForecast.isEstimate).toBe(true);
    expect(forecast.nextQuarterForecast.isEstimate).toBe(true);
    expect(forecast.nextYearForecast.isEstimate).toBe(true);
  });
});
