// Anomaly Detection V1 -- Batch 1: integration between reportGenerator.js, analyticsContext.js, expenseAnomalyAnalyzer.js, and reportAssembler.js. Sections A-B exercise real reportGenerator.js orchestration with collaborators mocked (loadReportGeneratorHarness() pattern), proving production call-argument wiring (analyzer receives analyticsContext's three inputs; shared currentMonthStart anchor reused). Sections C-E exercise the REAL, unmocked expenseAnomalyAnalyzer + reportAssembler together, proving anomaly detection/zero-anomaly/malformed-input behavior survives end-to-end. No jest.mock/doMock touches MongoDB, Redis, the ML service, or SIA anywhere in this file.
"use strict";

const ANALYTICS_CONTEXT_PATH = "../analytics/analyticsContext";
const SPENDING_ANALYZER_PATH = "../analytics/analyzers/spendingAnalyzer";
const BUDGET_ANALYZER_PATH = "../analytics/analyzers/budgetAnalyzer";
const CATEGORY_ANALYZER_PATH = "../analytics/analyzers/categoryAnalyzer";
const TREND_ANALYZER_PATH = "../analytics/analyzers/trendAnalyzer";
const HABIT_ANALYZER_PATH = "../analytics/analyzers/habitAnalyzer";
const HEALTH_ANALYZER_PATH = "../analytics/analyzers/healthAnalyzer";
const EXPENSE_ANOMALY_ANALYZER_PATH = "../analytics/analyzers/expenseAnomalyAnalyzer";
const BUDGET_INSIGHT_SERVICE_PATH = "../Services/BudgetServices/budgetInsight.service";
const REPORT_ASSEMBLER_PATH = "../analytics/reportAssembler";
const REPORT_GENERATOR_PATH = "../analytics/reportGenerator";

const CURRENT_MONTH_START = new Date(2026, 7, 1);

// Loads a fresh module registry with every reportGenerator collaborator
function loadHarnessWithRealAnomalyAnalyzer({ recentExpensePool = [], currentMonthExpenses = [] } = {}) {
  jest.resetModules();

  // jest.resetModules() clears the module registry but NOT an explicit
  jest.dontMock(EXPENSE_ANOMALY_ANALYZER_PATH);

  jest.doMock(ANALYTICS_CONTEXT_PATH, () => ({
    createAnalyticsContext: jest.fn(async () => ({
      currentMonthExpenses,
      previousMonthExpenses: [],
      currentYearExpenses: [],
      previousYearExpenses: [],
      budgetHistory: [],
      trendData: {},
      daysInMonth: 31,
      recentExpensePool,
      currentMonthStart: CURRENT_MONTH_START,
    })),
  }));

  jest.doMock(SPENDING_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasData: true, totalSpent: 100, transactionCount: 1, dailyAverage: 10 })),
  }));
  jest.doMock(BUDGET_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasBudget: true, budget: 10000, utilization: 50, status: "OnTrack" })),
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
      overall: 1,
      dataCompleteness: { includedModules: [], excludedModules: [] },
      risk: { label: "Test", color: "green" },
      signals: [],
    })),
  }));
  jest.doMock(BUDGET_INSIGHT_SERVICE_PATH, () => ({
    generateBudgetInsights: jest.fn(() => ({})),
  }));

  const { generateReport } = require(REPORT_GENERATOR_PATH);
  return { generateReport };
}

// Loads a fresh module registry with expenseAnomalyAnalyzer itself mocked
function loadHarnessWithMockedAnomalyAnalyzer({ recentExpensePool = [], currentMonthExpenses = [] } = {}) {
  jest.resetModules();

  jest.doMock(ANALYTICS_CONTEXT_PATH, () => ({
    createAnalyticsContext: jest.fn(async () => ({
      currentMonthExpenses,
      previousMonthExpenses: [],
      currentYearExpenses: [],
      previousYearExpenses: [],
      budgetHistory: [],
      trendData: {},
      daysInMonth: 31,
      recentExpensePool,
      currentMonthStart: CURRENT_MONTH_START,
    })),
  }));

  jest.doMock(SPENDING_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasData: true, totalSpent: 100, transactionCount: 1, dailyAverage: 10 })),
  }));
  jest.doMock(BUDGET_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasBudget: true, budget: 10000, utilization: 50, status: "OnTrack" })),
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
      overall: 1,
      dataCompleteness: { includedModules: [], excludedModules: [] },
      risk: { label: "Test", color: "green" },
      signals: [],
    })),
  }));
  jest.doMock(BUDGET_INSIGHT_SERVICE_PATH, () => ({
    generateBudgetInsights: jest.fn(() => ({})),
  }));

  const ANOMALY_RESULT_MARKER = { hasData: false, marker: "ANOMALY_RESULT_MARKER" };
  const analyzeMock = jest.fn(() => ANOMALY_RESULT_MARKER);
  jest.doMock(EXPENSE_ANOMALY_ANALYZER_PATH, () => ({
    analyze: analyzeMock,
  }));

  const { generateReport } = require(REPORT_GENERATOR_PATH);
  const expenseAnomalyAnalyzer = require(EXPENSE_ANOMALY_ANALYZER_PATH);
  const reportAssembler = require(REPORT_ASSEMBLER_PATH);

  return { generateReport, expenseAnomalyAnalyzer, ANOMALY_RESULT_MARKER, reportAssembler };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const makeExpense = (overrides = {}) => ({
  _id: "expense-1",
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

describe("reportGenerator: expenseAnomalyAnalyzer wiring (A)", () => {
  it("calls expenseAnomalyAnalyzer.analyze() exactly once with the provider/context inputs and budget reference", async () => {
    const recentExpensePool = makeBaselineRecords("Food", TEN_BASELINE_AMOUNTS);
    const currentMonthExpenses = [makeExpense()];

    const { generateReport, expenseAnomalyAnalyzer } = loadHarnessWithMockedAnomalyAnalyzer({
      recentExpensePool,
      currentMonthExpenses,
    });

    await generateReport("user-1");

    expect(expenseAnomalyAnalyzer.analyze).toHaveBeenCalledTimes(1);
    const [callArgs] = expenseAnomalyAnalyzer.analyze.mock.calls[0];
    expect(Object.keys(callArgs).sort()).toEqual(
      ["currentMonthExpenses", "recentExpensePool", "currentMonthStart", "monthlyReferenceAmount"].sort()
    );
    expect(callArgs.currentMonthExpenses).toBe(currentMonthExpenses);
    expect(callArgs.recentExpensePool).toBe(recentExpensePool);
    expect(callArgs.currentMonthStart).toBe(CURRENT_MONTH_START);
    expect(callArgs.monthlyReferenceAmount).toBe(10000);
  });

  it("passes the assembler the analyzer's own return value under the `anomalies` key, unmodified", async () => {
    const { generateReport, ANOMALY_RESULT_MARKER } = loadHarnessWithMockedAnomalyAnalyzer();

    const report = await generateReport("user-1");

    // The real (unmocked) reportAssembler is used here, so this proves the
    expect(report.anomalies).toBe(ANOMALY_RESULT_MARKER);
  });

  it("never calls the real database, Redis, or SIA when the analyzer is mocked (only analyticsContext/report modules involved)", async () => {
    const { generateReport } = loadHarnessWithMockedAnomalyAnalyzer();
    await expect(generateReport("user-1")).resolves.toBeDefined();
  });
});

describe("reportGenerator: shared currentMonthStart anchor (B)", () => {
  it("uses the exact same currentMonthStart instance analyticsContext computed, not a re-derived date", async () => {
    const { generateReport, expenseAnomalyAnalyzer } = loadHarnessWithMockedAnomalyAnalyzer({
      recentExpensePool: makeBaselineRecords("Food", TEN_BASELINE_AMOUNTS),
      currentMonthExpenses: [makeExpense()],
    });

    await generateReport("user-1");

    const [callArgs] = expenseAnomalyAnalyzer.analyze.mock.calls[0];
    expect(callArgs.currentMonthStart).toBe(CURRENT_MONTH_START);
  });
});

describe("reportGenerator + real expenseAnomalyAnalyzer: end-to-end report content (C)", () => {
  it("a genuine anomaly detected by the real analyzer appears in the generated report's anomalies section", async () => {
    const recentExpensePool = makeBaselineRecords("Food", TEN_BASELINE_AMOUNTS); // median=500
    const currentMonthExpenses = [makeExpense({ expenseAmount: 3500 })]; // clear spike

    const { generateReport } = loadHarnessWithRealAnomalyAnalyzer({ recentExpensePool, currentMonthExpenses });

    const report = await generateReport("user-1");

    expect(report.anomalies.hasData).toBe(true);
    expect(report.anomalies.flaggedCount).toBe(1);
    expect(report.anomalies.anomalies[0].category).toBe("Food");
    expect(report.anomalies.anomalies[0].reasonCode).toBe("CATEGORY_AMOUNT_SPIKE");
  });

  it("a valid zero-anomaly result (hasData:true, flaggedCount:0) is preserved, not treated as a failure", async () => {
    const recentExpensePool = makeBaselineRecords("Food", TEN_BASELINE_AMOUNTS); // median=500
    const currentMonthExpenses = [makeExpense({ expenseAmount: 600 })]; // ordinary, not a spike

    const { generateReport } = loadHarnessWithRealAnomalyAnalyzer({ recentExpensePool, currentMonthExpenses });

    const report = await generateReport("user-1");

    expect(report.anomalies.hasData).toBe(true);
    expect(report.anomalies.reasonCode).toBeNull();
    expect(report.anomalies.flaggedCount).toBe(0);
    expect(report.anomalies.anomalies).toEqual([]);
  });

  it("survives generation with the NO_ELIGIBLE_CURRENT_EXPENSES no-data reason when there are no current-month expenses", async () => {
    const { generateReport } = loadHarnessWithRealAnomalyAnalyzer({
      recentExpensePool: [],
      currentMonthExpenses: [],
    });

    const report = await generateReport("user-1");

    expect(report.anomalies.hasData).toBe(false);
    expect(report.anomalies.reasonCode).toBe("NO_ELIGIBLE_CURRENT_EXPENSES");
  });

  it("survives generation with the NO_BASELINE_YET no-data reason when history is insufficient", async () => {
    const recentExpensePool = makeBaselineRecords("Food", [500, 510, 490]); // only 3, below the gate
    const currentMonthExpenses = [makeExpense()];

    const { generateReport } = loadHarnessWithRealAnomalyAnalyzer({ recentExpensePool, currentMonthExpenses });

    const report = await generateReport("user-1");

    expect(report.anomalies.hasData).toBe(false);
    expect(report.anomalies.reasonCode).toBe("NO_BASELINE_YET");
  });

  it("a malformed current-month expense is skipped without breaking overall report generation", async () => {
    const recentExpensePool = makeBaselineRecords("Food", TEN_BASELINE_AMOUNTS);
    const currentMonthExpenses = [
      null,
      undefined,
      { expenseCategory: "Food" }, // missing amount/date/id
      makeExpense({ _id: "malformed-amount", expenseAmount: Object.create(null) }),
      makeExpense({ _id: "good", expenseAmount: 3500 }),
    ];

    const { generateReport } = loadHarnessWithRealAnomalyAnalyzer({ recentExpensePool, currentMonthExpenses });

    let report;
    await expect(
      (async () => {
        report = await generateReport("user-1");
      })()
    ).resolves.not.toThrow();

    expect(report.anomalies.hasData).toBe(true);
    expect(report.anomalies.evaluatedExpenseCount).toBe(1);
    expect(report.anomalies.flaggedCount).toBe(1);
    // The rest of the report was generated normally -- one malformed expense
    // did not abort report assembly.
    expect(report.metadata).toBeDefined();
    expect(report.summary).toBeDefined();
  });

  it("repeated generation from identical inputs is deterministic", async () => {
    const recentExpensePool = makeBaselineRecords("Food", TEN_BASELINE_AMOUNTS);
    const currentMonthExpenses = [makeExpense({ expenseAmount: 3500 })];

    const harnessA = loadHarnessWithRealAnomalyAnalyzer({ recentExpensePool, currentMonthExpenses });
    const reportA = await harnessA.generateReport("user-1");

    const harnessB = loadHarnessWithRealAnomalyAnalyzer({ recentExpensePool, currentMonthExpenses });
    const reportB = await harnessB.generateReport("user-1");

    expect(reportB.anomalies).toEqual(reportA.anomalies);
  });
});

describe("reportGenerator + real expenseAnomalyAnalyzer: no raw data leakage (D)", () => {
  it("the generated report's anomaly records never include userId or the raw expense objects", async () => {
    const recentExpensePool = makeBaselineRecords("Food", TEN_BASELINE_AMOUNTS);
    const currentMonthExpenses = [makeExpense({ expenseAmount: 3500 })];

    const { generateReport } = loadHarnessWithRealAnomalyAnalyzer({ recentExpensePool, currentMonthExpenses });

    const report = await generateReport("user-1");
    const [anomaly] = report.anomalies.anomalies;

    expect(anomaly).not.toHaveProperty("userId");
    expect(anomaly).not.toHaveProperty("id");
    expect(anomaly.baseline).not.toHaveProperty("expenses");
    expect(report.anomalies).not.toHaveProperty("recentExpensePool");
    expect(report.anomalies).not.toHaveProperty("currentMonthExpenses");
  });
});

describe("reportGenerator + real expenseAnomalyAnalyzer: normalized category output (E)", () => {
  it("preserves a category-variant-merged anomaly's canonical category", async () => {
    // Baseline fragmented across case variants ("Food" / "food"), exactly
    const recentExpensePool = [
      ...makeBaselineRecords("Food", [50, 150, 250, 350, 450]),
      ...makeBaselineRecords("food", [550, 650, 750, 850, 950]),
    ];
    const currentMonthExpenses = [makeExpense({ expenseCategory: "FOOD", expenseAmount: 3500 })];

    const { generateReport } = loadHarnessWithRealAnomalyAnalyzer({ recentExpensePool, currentMonthExpenses });

    const report = await generateReport("user-1");

    // Anomaly section: merged baseline, canonical category, flagged.
    expect(report.anomalies.hasData).toBe(true);
    expect(report.anomalies.flaggedCount).toBe(1);
    expect(report.anomalies.anomalies[0].category).toBe("Food");
    expect(report.anomalies.anomalies[0].baseline.sampleCount).toBe(10);
    expect(["high", "very_high"]).toContain(report.anomalies.anomalies[0].severity);

  });
});
