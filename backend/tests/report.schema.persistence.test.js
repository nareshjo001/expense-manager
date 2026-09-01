// Anomaly Detection V1 -- Batch 1 closure: real Mongoose schema
"use strict";

const mongoose = require("mongoose");

const FinancialReport = require("../models/Report");
const { analyze } = require("../analytics/analyzers/expenseAnomalyAnalyzer");
const { isCurrentReport, CURRENT_REPORT_VERSION } = require("../analytics/reportContractVersion");

const CURRENT_MONTH_START = new Date(2026, 7, 1);

const makeExpense = (overrides = {}) => ({
  _id: "64f1a2b3c4d5e6f7a8b9c0d1",
  expenseCategory: "Food",
  expenseAmount: 3500,
  expenseDate: new Date(2026, 7, 15),
  expenseName: "Dinner",
  ...overrides,
});

const makeBaselineRecords = (category, amounts, date = new Date(2025, 9, 15)) =>
  amounts.map((amount, index) => ({
    _id: `${category}-baseline-${index}`,
    expenseCategory: category,
    expenseAmount: amount,
    expenseDate: date,
    expenseName: `${category} baseline ${index}`,
  }));

const TEN_BASELINE_AMOUNTS = [50, 150, 250, 350, 450, 550, 650, 750, 850, 950];

const baseMetadata = () => ({
  version: CURRENT_REPORT_VERSION,
  generatedAt: "2026-08-08T00:00:00.000Z",
  reportPeriod: { month: 8, year: 2026 },
  lastExpenseUpdate: null,
  lastBudgetUpdate: null,
});

// Round-trips a document the same way the real read path does: construct
function roundTripThroughSchemaAndCache(attrs) {
  const doc = new FinancialReport(attrs);
  // `{ minimize: false }` matters here: Mongoose's default toObject()
  const asLean = doc.toObject({ minimize: false });
  return JSON.parse(JSON.stringify(asLean));
}

describe("models/Report.js: anomalies section schema round-trip", () => {
  it("a detected anomaly with populated baseline and detection data survives serialization/hydration exactly", () => {
    const recentExpensePool = makeBaselineRecords("Food", TEN_BASELINE_AMOUNTS);
    const currentMonthExpenses = [makeExpense({ expenseAmount: 3500 })];

    const anomalyReport = analyze({
      currentMonthExpenses,
      recentExpensePool,
      currentMonthStart: CURRENT_MONTH_START,
    });
    expect(anomalyReport.hasData).toBe(true);
    expect(anomalyReport.flaggedCount).toBe(1);

    const rehydrated = roundTripThroughSchemaAndCache({
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
      anomalies: anomalyReport,
    });

    expect(rehydrated.anomalies).toEqual(anomalyReport);
    expect(rehydrated.anomalies.anomalies[0].baseline).toEqual(anomalyReport.anomalies[0].baseline);
    expect(rehydrated.anomalies.anomalies[0].detection).toEqual(anomalyReport.anomalies[0].detection);
  });

  it("both no-data reason shapes (NO_ELIGIBLE_CURRENT_EXPENSES, NO_BASELINE_YET) survive the schema round-trip", () => {
    const noEligible = analyze({
      currentMonthExpenses: [],
      recentExpensePool: [],
      currentMonthStart: CURRENT_MONTH_START,
    });
    const noBaseline = analyze({
      currentMonthExpenses: [makeExpense()],
      recentExpensePool: makeBaselineRecords("Food", [500, 500, 500]),
      currentMonthStart: CURRENT_MONTH_START,
    });

    const rehydratedNoEligible = roundTripThroughSchemaAndCache({
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
      anomalies: noEligible,
    });
    const rehydratedNoBaseline = roundTripThroughSchemaAndCache({
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
      anomalies: noBaseline,
    });

    expect(rehydratedNoEligible.anomalies).toEqual(noEligible);
    expect(rehydratedNoEligible.anomalies.hasData).toBe(false);
    expect(rehydratedNoEligible.anomalies.reasonCode).toBe("NO_ELIGIBLE_CURRENT_EXPENSES");

    expect(rehydratedNoBaseline.anomalies).toEqual(noBaseline);
    expect(rehydratedNoBaseline.anomalies.hasData).toBe(false);
    expect(rehydratedNoBaseline.anomalies.reasonCode).toBe("NO_BASELINE_YET");
  });

  it("a zero-anomaly, hasData:true result survives the schema round-trip", () => {
    const recentExpensePool = makeBaselineRecords("Food", TEN_BASELINE_AMOUNTS);
    const zeroAnomaly = analyze({
      currentMonthExpenses: [makeExpense({ expenseAmount: 600 })],
      recentExpensePool,
      currentMonthStart: CURRENT_MONTH_START,
    });
    expect(zeroAnomaly.hasData).toBe(true);
    expect(zeroAnomaly.flaggedCount).toBe(0);

    const rehydrated = roundTripThroughSchemaAndCache({
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
      anomalies: zeroAnomaly,
    });

    expect(rehydrated.anomalies).toEqual(zeroAnomaly);
    expect(rehydrated.anomalies.hasData).toBe(true);
    expect(rehydrated.anomalies.anomalies).toEqual([]);
  });

  it("never exposes raw expense history, userId, description, client id, or internal sort fields after round-trip", () => {
    const recentExpensePool = makeBaselineRecords("Food", TEN_BASELINE_AMOUNTS);
    const currentMonthExpenses = [makeExpense({ expenseAmount: 3500 })];

    const anomalyReport = analyze({
      currentMonthExpenses,
      recentExpensePool,
      currentMonthStart: CURRENT_MONTH_START,
    });

    const rehydrated = roundTripThroughSchemaAndCache({
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
      anomalies: anomalyReport,
    });

    const serialized = JSON.stringify(rehydrated.anomalies);
    expect(serialized).not.toContain("_sortMultiple");
    expect(serialized).not.toContain("_sortAmount");
    expect(serialized).not.toContain("_sortDate");
    expect(serialized).not.toContain("recentExpensePool");
    expect(serialized).not.toContain("currentMonthExpenses");

    const [anomaly] = rehydrated.anomalies.anomalies;
    expect(anomaly).not.toHaveProperty("userId");
    expect(anomaly).not.toHaveProperty("id");
    expect(anomaly).not.toHaveProperty("description");
    expect(anomaly.baseline).not.toHaveProperty("expenses");
    // The stored `user` field is the report owner's id, deliberately
    expect(anomaly).not.toHaveProperty("user");
  });
});

describe("models/Report.js + reportContractVersion.js: legacy-document staleness detection", () => {
  it("a legacy document with no anomalies field at all reads back with the schema default, but is still correctly flagged stale by metadata.version", () => {
    // Simulates a document persisted before the `anomalies` field existed
    // on the schema at all -- no `anomalies` key is passed in.
    const legacyDoc = new FinancialReport({
      user: new mongoose.Types.ObjectId(),
      metadata: {
        version: 1, // the pre-Batch-1 contract version
        generatedAt: "2026-01-01T00:00:00.000Z",
        reportPeriod: { month: 1, year: 2026 },
        lastExpenseUpdate: null,
        lastBudgetUpdate: null,
      },
    });
    const rehydrated = JSON.parse(JSON.stringify(legacyDoc.toObject({ minimize: false })));

    // Proves the exact masking behavior the task described: Mongoose's own
    expect(rehydrated.anomalies).toEqual({});

    // Despite that, isCurrentReport() is not fooled, because it checks
    // metadata.version, not `anomalies` at all.
    expect(isCurrentReport(rehydrated)).toBe(false);
  });

  it("a document with the current metadata.version is recognized as current, independent of its anomalies content", () => {
    const currentDoc = new FinancialReport({
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
      anomalies: { hasData: false, reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES", anomalies: [] },
    });
    const rehydrated = JSON.parse(JSON.stringify(currentDoc.toObject()));

    expect(isCurrentReport(rehydrated)).toBe(true);
  });

  it("a document with an older numeric metadata.version is recognized as stale", () => {
    const olderDoc = new FinancialReport({
      user: new mongoose.Types.ObjectId(),
      metadata: {
        version: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        reportPeriod: { month: 1, year: 2026 },
        lastExpenseUpdate: null,
        lastBudgetUpdate: null,
      },
      anomalies: {},
    });
    const rehydrated = JSON.parse(JSON.stringify(olderDoc.toObject()));

    expect(isCurrentReport(rehydrated)).toBe(false);
  });

  it("every other existing report section is preserved verbatim through the same schema round-trip", () => {
    const attrs = {
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
      summary: { totalSpent: 100, transactionCount: 1 },
      spending: { hasData: true, totalSpent: 100 },
      budgets: { hasBudget: true, utilization: 50 },
      categories: { monthly: { hasData: true }, yearly: { hasData: true } },
      trends: { hasData: true },
      habits: { monthly: { hasData: true }, yearly: { hasData: true } },
      financialHealth: { overall: 80 },
      forecast: {},
      anomalies: { hasData: false, reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES", anomalies: [] },
    };

    const rehydrated = roundTripThroughSchemaAndCache(attrs);

    expect(rehydrated.summary).toEqual(attrs.summary);
    expect(rehydrated.spending).toEqual(attrs.spending);
    expect(rehydrated.budgets).toEqual(attrs.budgets);
    expect(rehydrated.categories).toEqual(attrs.categories);
    expect(rehydrated.trends).toEqual(attrs.trends);
    expect(rehydrated.habits).toEqual(attrs.habits);
    expect(rehydrated.financialHealth).toEqual(attrs.financialHealth);
    expect(rehydrated.forecast).toEqual(attrs.forecast);
  });
});

describe("models/Report.js: forecast section schema round-trip (Batch 2)", () => {
  const { analyze: analyzeForecast } = require("../analytics/analyzers/forecastAnalyzer");

  // Architecture-closure correction: forecastAnalyzer.js's input contract
  const buildStableSeries = (monthsBack, amount) =>
    Array.from({ length: monthsBack }, (_, i) => {
      const monthsAgo = monthsBack - i;
      const d = new Date(CURRENT_MONTH_START.getFullYear(), CURRENT_MONTH_START.getMonth() - monthsAgo, 1);
      return { monthKey: `${d.getFullYear()}-${d.getMonth()}`, totalAmount: amount };
    });

  it("a real forecast result with populated estimate/range survives the schema round-trip", () => {
    const forecastReport = analyzeForecast({
      monthlySeries: buildStableSeries(6, 1000),
      currentMonthStart: CURRENT_MONTH_START,
    });
    expect(forecastReport.hasData).toBe(true);

    const rehydrated = roundTripThroughSchemaAndCache({
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
      forecast: forecastReport,
    });

    expect(rehydrated.forecast).toEqual(forecastReport);
  });

  it("an insufficient-history forecast (no-data) survives the schema round-trip", () => {
    const forecastReport = analyzeForecast({ monthlySeries: [], currentMonthStart: CURRENT_MONTH_START });
    expect(forecastReport.hasData).toBe(false);

    const rehydrated = roundTripThroughSchemaAndCache({
      user: new mongoose.Types.ObjectId(),
      metadata: baseMetadata(),
      forecast: forecastReport,
    });

    expect(rehydrated.forecast).toEqual(forecastReport);
  });

  it("a legacy document (version below 3, e.g. the Batch-1 version 2) is recognized as stale under the Batch 2 contract", () => {
    const batch1Doc = new FinancialReport({
      user: new mongoose.Types.ObjectId(),
      metadata: {
        version: 2,
        generatedAt: "2026-06-01T00:00:00.000Z",
        reportPeriod: { month: 6, year: 2026 },
        lastExpenseUpdate: null,
        lastBudgetUpdate: null,
      },
      anomalies: { hasData: false, reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES", anomalies: [] },
    });
    const rehydrated = JSON.parse(JSON.stringify(batch1Doc.toObject({ minimize: false })));

    // A Batch-1 (version 2) document has no forecast section at all,
    expect(rehydrated.forecast).toEqual({});
    expect(isCurrentReport(rehydrated)).toBe(false);
    // Prediction Layer V1 bumped the contract from 3 to 4 (the forecast
    expect(isCurrentReport({ metadata: { version: 3 } })).toBe(false);
  });

  it("removing Financial Risk Signals bumped the contract to 9 -- version 8 is stale", () => {
    expect(CURRENT_REPORT_VERSION).toBe(9);
    expect(isCurrentReport({ metadata: { version: 4 } })).toBe(false);
    expect(isCurrentReport({ metadata: { version: 5 } })).toBe(false);
    expect(isCurrentReport({ metadata: { version: 6 } })).toBe(false);
    expect(isCurrentReport({ metadata: { version: 7 } })).toBe(false);
    expect(isCurrentReport({ metadata: { version: 8 } })).toBe(false);
    expect(isCurrentReport({ metadata: { version: 9 } })).toBe(true);
  });
});
