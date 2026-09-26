// DAT-002-T04 -- covers models/Report.js's new schemaVersion field, the
// user.ref fix ("User" -> "users"), the new typed metadata/summary
// sub-schemas (and the round-trip fidelity fix that followed from
// discovering, via this same suite, that a nested-object riskLevel /
// reportPeriod path auto-materializes to `{}` on read even when absent
// from the source document -- both are Mixed for that reason), and
// analytics/reportGenerator.js's schemaVersion spread onto the object
// reportAssembler.js's assembleReport() returns.
"use strict";

const mongoose = require("mongoose");

describe("models/Report.js: schemaVersion field and ref fix (DAT-002-T04)", () => {
  let FinancialReport;
  let CURRENT_REPORT_VERSION;

  beforeAll(() => {
    FinancialReport = require("../models/Report");
    ({ CURRENT_REPORT_VERSION } = require("../analytics/reportContractVersion"));
  });

  const baseMetadata = () => ({
    version: CURRENT_REPORT_VERSION,
    generatedAt: "2026-09-21T00:00:00.000Z",
    reportPeriod: { month: 9, year: 2026 },
    lastExpenseUpdate: null,
    lastBudgetUpdate: null,
  });

  it("defaults schemaVersion to CURRENT_REPORT_VERSION when not explicitly set", () => {
    const doc = new FinancialReport({
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
    });
    expect(doc.schemaVersion).toBe(CURRENT_REPORT_VERSION);
  });

  it("accepts an explicit schemaVersion override rather than forcing the default", () => {
    const doc = new FinancialReport({
      user: new mongoose.Types.ObjectId(),
      schemaVersion: 3,
      metadata: baseMetadata(),
    });
    expect(doc.schemaVersion).toBe(3);
  });

  it("persists the schemaVersion field through a schema round-trip alongside metadata.version", () => {
    const doc = new FinancialReport({
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
    });
    const rehydrated = JSON.parse(JSON.stringify(doc.toObject({ minimize: false })));
    expect(rehydrated.schemaVersion).toBe(CURRENT_REPORT_VERSION);
    expect(rehydrated.metadata.version).toBe(CURRENT_REPORT_VERSION);
  });

  it("registers the user path's model reference as 'users' (config/Schemas.js's actual registered model name), not 'User'", () => {
    const ref = FinancialReport.schema.path("user").options.ref;
    expect(ref).toBe("users");
  });

  it("still requires metadata and rejects a document missing it", () => {
    const doc = new FinancialReport({ user: new mongoose.Types.ObjectId() });
    const err = doc.validateSync();
    expect(err).toBeTruthy();
    expect(err.errors.metadata).toBeTruthy();
  });
});

describe("models/Report.js: typed metadata/summary sub-schemas (DAT-002-T04)", () => {
  let FinancialReport;
  let CURRENT_REPORT_VERSION;

  beforeAll(() => {
    FinancialReport = require("../models/Report");
    ({ CURRENT_REPORT_VERSION } = require("../analytics/reportContractVersion"));
  });

  function roundTrip(attrs) {
    const doc = new FinancialReport(attrs);
    return JSON.parse(JSON.stringify(doc.toObject({ minimize: false })));
  }

  it("casts metadata.version/reportPeriod through their typed paths and round-trips them exactly", () => {
    const attrs = {
      user: new mongoose.Types.ObjectId(),
      metadata: {
        version: CURRENT_REPORT_VERSION,
        generatedAt: "2026-09-21T00:00:00.000Z",
        reportPeriod: { month: 9, year: 2026 },
        lastExpenseUpdate: null,
        lastBudgetUpdate: null,
      },
    };
    const rehydrated = roundTrip(attrs);
    expect(rehydrated.metadata).toEqual(attrs.metadata);
  });

  it("casts a numeric-string metadata.version to a real Number (typed path protection)", () => {
    const doc = new FinancialReport({
      user: new mongoose.Types.ObjectId(),
      metadata: { version: "9", generatedAt: "x", reportPeriod: {}, lastExpenseUpdate: null, lastBudgetUpdate: null },
    });
    expect(doc.metadata.version).toBe(9);
    expect(typeof doc.metadata.version).toBe("number");
  });

  it("round-trips a summary object with no riskLevel key without materializing an empty riskLevel object", () => {
    const attrs = {
      user: new mongoose.Types.ObjectId(),
      metadata: {
        version: CURRENT_REPORT_VERSION,
        generatedAt: "x",
        reportPeriod: { month: 1, year: 2026 },
        lastExpenseUpdate: null,
        lastBudgetUpdate: null,
      },
      summary: { totalSpent: 100, transactionCount: 1 },
    };
    const rehydrated = roundTrip(attrs);
    expect(rehydrated.summary).toEqual(attrs.summary);
    expect(rehydrated.summary.riskLevel).toBeUndefined();
  });

  it("casts a numeric-string summary.totalSpent to a real Number (typed path protection)", () => {
    const doc = new FinancialReport({
      user: new mongoose.Types.ObjectId(),
      metadata: {
        version: CURRENT_REPORT_VERSION,
        generatedAt: "x",
        reportPeriod: {},
        lastExpenseUpdate: null,
        lastBudgetUpdate: null,
      },
      summary: { totalSpent: "250.5" },
    });
    expect(doc.summary.totalSpent).toBe(250.5);
    expect(typeof doc.summary.totalSpent).toBe("number");
  });

  it("round-trips a populated summary.riskLevel object exactly, unchanged (Mixed, no forced shape)", () => {
    const attrs = {
      user: new mongoose.Types.ObjectId(),
      metadata: {
        version: CURRENT_REPORT_VERSION,
        generatedAt: "x",
        reportPeriod: { month: 9, year: 2026 },
        lastExpenseUpdate: null,
        lastBudgetUpdate: null,
      },
      summary: {
        totalSpent: 500,
        riskLevel: { label: "Elevated", color: "amber", reason: "trending up" },
      },
    };
    const rehydrated = roundTrip(attrs);
    expect(rehydrated.summary.riskLevel).toEqual(attrs.summary.riskLevel);
  });

  it("still tolerates an unrecognized key on metadata/summary via strict:false, unchanged from before", () => {
    const attrs = {
      user: new mongoose.Types.ObjectId(),
      metadata: {
        version: CURRENT_REPORT_VERSION,
        generatedAt: "x",
        reportPeriod: {},
        lastExpenseUpdate: null,
        lastBudgetUpdate: null,
        futureField: "unknown-to-this-schema",
      },
      summary: { totalSpent: 1, futureSummaryField: "also-unknown" },
    };
    const rehydrated = roundTrip(attrs);
    expect(rehydrated.metadata.futureField).toBe("unknown-to-this-schema");
    expect(rehydrated.summary.futureSummaryField).toBe("also-unknown");
  });
});

describe("analytics/reportGenerator.js: schemaVersion is added to the assembled report (DAT-002-T04)", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("spreads schemaVersion === CURRENT_REPORT_VERSION onto the object assembleReport() returns, without altering any assembled key", async () => {
    const { CURRENT_REPORT_VERSION } = require("../analytics/reportContractVersion");

    jest.doMock("../analytics/analyticsContext", () => ({
      createAnalyticsContext: jest.fn().mockResolvedValue({
        currentMonthExpenses: [],
        previousMonthExpenses: [],
        currentYearExpenses: [],
        previousYearExpenses: [],
        budgetHistory: [],
        daysInMonth: 30,
        trendData: {},
        recentExpensePool: [],
        currentMonthStart: new Date(2026, 8, 1),
        forecastMonthlySeries: [],
        forecastCurrentPartialMonthTotal: 0,
        forecastCategorySeries: {},
        forecastActiveDays: 0,
        forecastTargetMonthBudget: null,
        currentMonthForecastInput: {},
        forecastCurrentMonthBudget: null,
        lastExpenseUpdate: null,
        lastBudgetUpdate: null,
      }),
    }));
    jest.doMock("../analytics/analyzers/spendingAnalyzer", () => ({ analyze: jest.fn(() => ({ hasData: false })) }));
    jest.doMock("../analytics/analyzers/budgetAnalyzer", () => ({ analyze: jest.fn(() => ({ hasData: false, hasBudget: false })) }));
    jest.doMock("../analytics/analyzers/categoryAnalyzer", () => ({ analyze: jest.fn(() => ({ hasData: false })) }));
    jest.doMock("../analytics/analyzers/trendAnalyzer", () => ({
      analyze: jest.fn(() => ({ hasData: false, monthlyTrend: { percentageChange: 0 } })),
    }));
    jest.doMock("../analytics/analyzers/habitAnalyzer", () => ({ analyze: jest.fn(() => ({ hasData: false })) }));
    jest.doMock("../analytics/analyzers/healthAnalyzer", () => ({
      analyze: jest.fn(() => ({ healthScore: 0, riskLevel: { label: "Low", color: "green" } })),
    }));
    jest.doMock("../analytics/analyzers/expenseAnomalyAnalyzer", () => ({ analyze: jest.fn(() => ({ hasData: false })) }));
    jest.doMock("../analytics/analyzers/forecastAnalyzer", () => ({ analyze: jest.fn(() => ({ hasData: false })) }));
    jest.doMock("../analytics/analyzers/currentMonthForecastAnalyzer", () => ({
      analyze: jest.fn().mockResolvedValue({ hasData: false }),
    }));
    jest.doMock("../analytics/analyzers/scores/habitRules", () => ({ habits: [] }));
    jest.doMock("../Services/BudgetServices/budgetInsight.service", () => ({ generateBudgetInsights: jest.fn(() => ({})) }));

    const { generateReport } = require("../analytics/reportGenerator");

    const result = await generateReport("64f1a2b3c4d5e6f7a8b9c0d1");

    expect(result.schemaVersion).toBe(CURRENT_REPORT_VERSION);
    expect(result.metadata.version).toBe(CURRENT_REPORT_VERSION);

    // schemaVersion is additive: every key the real (un-mocked)
    // assembleReport() actually returns is still present, untouched.
    expect(result).toEqual(
      expect.objectContaining({
        metadata: expect.any(Object),
        summary: expect.any(Object),
        spending: expect.any(Object),
        budgets: expect.any(Object),
        categories: expect.any(Object),
        trends: expect.any(Object),
        habits: expect.any(Object),
        financialHealth: expect.any(Object),
        forecast: expect.any(Object),
        anomalies: expect.any(Object),
      })
    );
  });
});
