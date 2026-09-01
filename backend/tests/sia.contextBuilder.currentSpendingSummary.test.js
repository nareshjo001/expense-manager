// Unit tests for backend/sia/contextBuilder.js's CURRENT_SPENDING_SUMMARY
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

describe("backend/sia/contextBuilder -- CURRENT_SPENDING_SUMMARY", () => {
  it("returns a context bounded to exactly summary.totalSpent -- no other field", async () => {
    const report = baseReport({
      summary: {
        totalSpent: 4321.55,
        transactionCount: 12,
        dailyAverage: 140,
        comparePastMonth: 332.1,
        topCategory: "Groceries",
        budgetUtilization: 43.21,
        budgetStatus: "OnTrack",
      },
    });
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "CURRENT_SPENDING_SUMMARY");

    expect(result.intent).toBe("CURRENT_SPENDING_SUMMARY");
    expect(result.fields).toEqual({ summary: { totalSpent: 4321.55 } });
    // Exact key set -- no transactionCount/comparePastMonth/topCategory/
    // budgetUtilization/budgetStatus leaked alongside it.
    expect(Object.keys(result.fields)).toEqual(["summary"]);
    expect(Object.keys(result.fields.summary)).toEqual(["totalSpent"]);
  });

  it("accepts a genuine zero total as present data, not as no-data (0 is not falsy-missing)", async () => {
    const report = baseReport({ summary: { totalSpent: 0 } });
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "CURRENT_SPENDING_SUMMARY");

    expect(result.fields).not.toBeNull();
    expect(result.fields.summary.totalSpent).toBe(0);
  });

  it("returns the shared no-data contract when summary.totalSpent is absent", async () => {
    const report = baseReport({ summary: { budgetStatus: "OnTrack" } });
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "CURRENT_SPENDING_SUMMARY");

    expect(result.fields).toBeNull();
    expect(result.reason).toBe("no_data");
    expect(result.intent).toBe("CURRENT_SPENDING_SUMMARY");
  });

  it("returns the shared no-data contract when there is no report at all", async () => {
    const { buildContext, reportService } = (() => {
      jest.resetModules();
      jest.doMock(REPORT_SERVICE_PATH, () => ({
        getReport: jest.fn(async () => null),
        refreshReport: jest.fn(),
      }));
      return { buildContext: require(CONTEXT_BUILDER_PATH).buildContext, reportService: require(REPORT_SERVICE_PATH) };
    })();

    const result = await buildContext("user-1", "CURRENT_SPENDING_SUMMARY");

    expect(result.fields).toBeNull();
    expect(result.reason).toBe("no_data");
    expect(reportService.getReport).toHaveBeenCalledWith("user-1");
  });

  it("returns the shared no-data contract when reportService.getReport rejects", async () => {
    jest.resetModules();
    jest.doMock(REPORT_SERVICE_PATH, () => ({
      getReport: jest.fn(async () => {
        throw new Error("boom");
      }),
      refreshReport: jest.fn(),
    }));
    const { buildContext } = require(CONTEXT_BUILDER_PATH);

    const result = await buildContext("user-1", "CURRENT_SPENDING_SUMMARY");

    expect(result.fields).toBeNull();
    expect(result.reason).toBe("no_data");
  });

  it("never passes the complete report -- only summary.totalSpent, never trends/budgets/categories/etc.", async () => {
    const report = baseReport({
      summary: { totalSpent: 900 },
      trends: { monthlyTrend: [{ month: "2026-07", total: 800 }] },
      budgets: { hasData: true, secretInternal: "should-not-appear" },
      categories: { monthly: { hasData: true } },
      forecast: { hasData: true },
      risk: { hasData: true },
      anomalies: { hasData: true },
    });
    const { buildContext } = loadContextBuilderWithReport(report);

    const result = await buildContext("user-1", "CURRENT_SPENDING_SUMMARY");

    expect(result.fields).not.toHaveProperty("trends");
    expect(result.fields).not.toHaveProperty("budgets");
    expect(result.fields).not.toHaveProperty("categories");
    expect(result.fields).not.toHaveProperty("forecast");
    expect(result.fields).not.toHaveProperty("risk");
    expect(result.fields).not.toHaveProperty("anomalies");
    expect(JSON.stringify(result)).not.toContain("secretInternal");
  });
});
