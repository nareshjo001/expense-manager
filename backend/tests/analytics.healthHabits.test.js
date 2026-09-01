// M0-1 coupled health-score habits remediation.
"use strict";

const path = require("path");

const HABIT_ANALYZER_PATH = "../analytics/analyzers/habitAnalyzer";
const HEALTH_ANALYZER_PATH = "../analytics/analyzers/healthAnalyzer";
const REPORT_ASSEMBLER_PATH = "../analytics/reportAssembler";
const ANALYTICS_CONTEXT_PATH = "../analytics/analyticsContext";
const SPENDING_ANALYZER_PATH = "../analytics/analyzers/spendingAnalyzer";
const BUDGET_ANALYZER_PATH = "../analytics/analyzers/budgetAnalyzer";
const CATEGORY_ANALYZER_PATH = "../analytics/analyzers/categoryAnalyzer";
const TREND_ANALYZER_PATH = "../analytics/analyzers/trendAnalyzer";
const BUDGET_INSIGHT_SERVICE_PATH = "../Services/BudgetServices/budgetInsight.service";
const HABIT_RULES_PATH = "../analytics/analyzers/scores/habitRules";
const REPORT_GENERATOR_PATH = "../analytics/reportGenerator";

// Loads a brand-new module registry with reportGenerator's collaborators
function loadReportGeneratorHarness() {
  jest.resetModules();

  const MONTH_EXPENSES = [{ expenseCategory: "Shopping", expenseAmount: 111, expenseDate: "2026-08-01" }];
  const YEAR_EXPENSES = [{ expenseCategory: "Shopping", expenseAmount: 222, expenseDate: "2026-01-01" }];

  const MONTHLY_HABIT_REPORT = { hasData: true, marker: "MONTHLY_HABIT_REPORT" };
  const YEARLY_HABIT_REPORT = { hasData: true, marker: "YEARLY_HABIT_REPORT" };

  jest.doMock(ANALYTICS_CONTEXT_PATH, () => ({
    createAnalyticsContext: jest.fn(async () => ({
      currentMonthExpenses: MONTH_EXPENSES,
      previousMonthExpenses: [],
      currentYearExpenses: YEAR_EXPENSES,
      previousYearExpenses: [],
      budgetHistory: [],
      trendData: {},
      daysInMonth: 31,
    })),
  }));

  jest.doMock(SPENDING_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasData: true, totalSpent: 100, transactionCount: 1, dailyAverage: 10 })),
  }));

  jest.doMock(BUDGET_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasBudget: true, utilization: 50, status: "OnTrack" })),
  }));

  jest.doMock(CATEGORY_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasData: true, topCategory: { category: "Test" } })),
  }));

  jest.doMock(TREND_ANALYZER_PATH, () => ({
    analyze: jest.fn(() => ({ hasData: true, monthlyTrend: { percentageChange: 5 } })),
  }));

  jest.doMock(BUDGET_INSIGHT_SERVICE_PATH, () => ({
    generateBudgetInsights: jest.fn(() => ({})),
  }));

  jest.doMock(HABIT_ANALYZER_PATH, () => ({
    analyze: jest.fn((expenses) =>
      expenses === MONTH_EXPENSES ? MONTHLY_HABIT_REPORT : YEARLY_HABIT_REPORT
    ),
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

  jest.doMock(REPORT_ASSEMBLER_PATH, () => ({
    assembleReport: jest.fn((args) => args),
  }));

  const { generateReport } = require(REPORT_GENERATOR_PATH);
  const habitAnalyzer = require(HABIT_ANALYZER_PATH);
  const healthAnalyzer = require(HEALTH_ANALYZER_PATH);
  const reportAssembler = require(REPORT_ASSEMBLER_PATH);
  const habitRules = require(HABIT_RULES_PATH);

  return {
    generateReport,
    habitAnalyzer,
    healthAnalyzer,
    reportAssembler,
    habitRules,
    MONTH_EXPENSES,
    YEAR_EXPENSES,
    MONTHLY_HABIT_REPORT,
    YEARLY_HABIT_REPORT,
  };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("reportGenerator: canonical habit configuration wiring (A)", () => {
  it("passes habitRules.habits as the monthly habitAnalyzer.analyze config argument", async () => {
    const { generateReport, habitAnalyzer, habitRules, MONTH_EXPENSES } = loadReportGeneratorHarness();

    await generateReport("user-1");

    expect(habitAnalyzer.analyze).toHaveBeenCalled();
    const monthlyCall = habitAnalyzer.analyze.mock.calls.find((call) => call[0] === MONTH_EXPENSES);
    expect(monthlyCall).toBeDefined();
    expect(monthlyCall[1]).toBe(habitRules.habits);
  });

  it("passes habitRules.habits as the yearly habitAnalyzer.analyze config argument", async () => {
    const { generateReport, habitAnalyzer, habitRules, YEAR_EXPENSES } = loadReportGeneratorHarness();

    await generateReport("user-1");

    const yearlyCall = habitAnalyzer.analyze.mock.calls.find((call) => call[0] === YEAR_EXPENSES);
    expect(yearlyCall).toBeDefined();
    expect(yearlyCall[1]).toBe(habitRules.habits);
  });

  it("reuses the same canonical configuration object for both calls instead of reconstructing it", async () => {
    const { generateReport, habitAnalyzer } = loadReportGeneratorHarness();

    await generateReport("user-1");

    const [firstCall, secondCall] = habitAnalyzer.analyze.mock.calls;
    expect(firstCall[1]).toBe(secondCall[1]);
  });

  it("does not mutate habitRules.habits or the returned habit reports while generating a report", async () => {
    const { generateReport, habitRules, MONTHLY_HABIT_REPORT, YEARLY_HABIT_REPORT } =
      loadReportGeneratorHarness();

    // structuredClone, not JSON.parse(JSON.stringify(...)) -- habitRules.habits
    const habitRulesBefore = structuredClone(habitRules.habits);
    const monthlyBefore = structuredClone(MONTHLY_HABIT_REPORT);
    const yearlyBefore = structuredClone(YEARLY_HABIT_REPORT);

    await generateReport("user-1");

    expect(habitRules.habits).toEqual(habitRulesBefore);
    expect(MONTHLY_HABIT_REPORT).toEqual(monthlyBefore);
    expect(YEARLY_HABIT_REPORT).toEqual(yearlyBefore);
  });
});

describe("reportGenerator -> healthAnalyzer contract (B)", () => {
  it("passes the real monthly habit report under the key habits, not monthlyHabits", async () => {
    const { generateReport, healthAnalyzer, MONTHLY_HABIT_REPORT } = loadReportGeneratorHarness();

    await generateReport("user-1");

    expect(healthAnalyzer.analyze).toHaveBeenCalledTimes(1);
    const healthArg = healthAnalyzer.analyze.mock.calls[0][0];

    expect(healthArg.habits).toBe(MONTHLY_HABIT_REPORT);
    expect(Object.prototype.hasOwnProperty.call(healthArg, "monthlyHabits")).toBe(false);
  });
});

describe("reportGenerator -> reportAssembler contract regression (C)", () => {
  it("still assembles the report with monthlyHabits and yearlyHabits, unchanged from before M0-1", async () => {
    const { generateReport, reportAssembler, MONTHLY_HABIT_REPORT, YEARLY_HABIT_REPORT } =
      loadReportGeneratorHarness();

    await generateReport("user-1");

    expect(reportAssembler.assembleReport).toHaveBeenCalledTimes(1);
    const assembleArg = reportAssembler.assembleReport.mock.calls[0][0];

    expect(assembleArg.monthlyHabits).toBe(MONTHLY_HABIT_REPORT);
    expect(assembleArg.yearlyHabits).toBe(YEARLY_HABIT_REPORT);
    expect(Object.prototype.hasOwnProperty.call(assembleArg, "habits")).toBe(false);
  });
});

describe("habitScore: defensive impulse-share handling (D)", () => {
  // Real, unmocked module -- the actual production scoring function.
  const { calculateHabitScore } = require(path.join("..", "analytics", "analyzers", "scoreCal", "habitScore"));
  const habitRules = require(path.join("..", "analytics", "analyzers", "scores", "habitRules"));

  it("awards 0 impulse points with label InsufficientData when impulseSpending is absent entirely", () => {
    const result = calculateHabitScore({ hasData: true });
    expect(result.breakdown.impulse.points).toBe(0);
    expect(result.breakdown.impulse.tier).toBe("InsufficientData");
    expect(result.breakdown.impulse.value).toBeNull();
  });

  it("awards InsufficientData when impulseSpending has neither supported percentage field", () => {
    const result = calculateHabitScore({ hasData: true, impulseSpending: { topImpulseCategory: null } });
    expect(result.breakdown.impulse.points).toBe(0);
    expect(result.breakdown.impulse.tier).toBe("InsufficientData");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])("does not award LowImpulse points for a %s amountSharePercentage", (_label, value) => {
    const result = calculateHabitScore({ hasData: true, impulseSpending: { amountSharePercentage: value } });
    expect(result.breakdown.impulse.tier).not.toBe("LowImpulse");
    expect(result.breakdown.impulse.points).toBe(0);
    expect(result.breakdown.impulse.tier).toBe("InsufficientData");
  });

  it("preserves the existing LowImpulse result for a genuine, evaluated numeric 0", () => {
    const result = calculateHabitScore({ hasData: true, impulseSpending: { amountSharePercentage: 0 } });
    expect(result.breakdown.impulse.tier).toBe("LowImpulse");
    expect(result.breakdown.impulse.points).toBe(habitRules.habits.impulseTiers[0].score);
    expect(result.breakdown.impulse.value).toBe(0);
  });

  it("preserves the existing thresholds for valid non-zero percentages (ModerateImpulse, HighImpulse)", () => {
    const moderate = calculateHabitScore({ hasData: true, impulseSpending: { amountSharePercentage: 20 } });
    expect(moderate.breakdown.impulse.tier).toBe("ModerateImpulse");
    expect(moderate.breakdown.impulse.points).toBe(habitRules.habits.impulseTiers[1].score);

    const high = calculateHabitScore({ hasData: true, impulseSpending: { amountSharePercentage: 50 } });
    expect(high.breakdown.impulse.tier).toBe("HighImpulse");
    expect(high.breakdown.impulse.points).toBe(habitRules.habits.impulseTiers[2].score);
  });

  it("falls back to transactionSharePercentage when amountSharePercentage is absent", () => {
    const result = calculateHabitScore({ hasData: true, impulseSpending: { transactionSharePercentage: 5 } });
    expect(result.breakdown.impulse.tier).toBe("LowImpulse");
    expect(result.breakdown.impulse.value).toBe(5);
  });

  it("prefers amountSharePercentage over transactionSharePercentage when both are present", () => {
    const result = calculateHabitScore({
      hasData: true,
      impulseSpending: { amountSharePercentage: 50, transactionSharePercentage: 5 },
    });
    expect(result.breakdown.impulse.tier).toBe("HighImpulse");
    expect(result.breakdown.impulse.value).toBe(50);
  });

  it("a finite amountSharePercentage takes precedence over a finite transactionSharePercentage", () => {
    const result = calculateHabitScore({
      hasData: true,
      impulseSpending: { amountSharePercentage: 20, transactionSharePercentage: 5 },
    });
    expect(result.breakdown.impulse.tier).toBe("ModerateImpulse");
    expect(result.breakdown.impulse.value).toBe(20);
  });

  it("a genuine numeric amountSharePercentage of 0 takes precedence over a non-zero transactionSharePercentage and remains LowImpulse", () => {
    const result = calculateHabitScore({
      hasData: true,
      impulseSpending: { amountSharePercentage: 0, transactionSharePercentage: 50 },
    });
    expect(result.breakdown.impulse.tier).toBe("LowImpulse");
    expect(result.breakdown.impulse.value).toBe(0);
    expect(result.breakdown.impulse.points).toBe(habitRules.habits.impulseTiers[0].score);
  });

  it("falls through to a valid transactionSharePercentage when amountSharePercentage is NaN, rather than treating the whole field as InsufficientData", () => {
    const result = calculateHabitScore({
      hasData: true,
      impulseSpending: { amountSharePercentage: NaN, transactionSharePercentage: 5 },
    });
    expect(result.breakdown.impulse.tier).toBe("LowImpulse");
    expect(result.breakdown.impulse.value).toBe(5);
  });

  it("falls through to a valid transactionSharePercentage when amountSharePercentage is Infinity", () => {
    const result = calculateHabitScore({
      hasData: true,
      impulseSpending: { amountSharePercentage: Infinity, transactionSharePercentage: 20 },
    });
    expect(result.breakdown.impulse.tier).toBe("ModerateImpulse");
    expect(result.breakdown.impulse.value).toBe(20);
  });

  it.each([
    ["the string \"0\"", "0"],
    ["an empty string", ""],
    ["false", false],
  ])("treats a non-number amountSharePercentage (%s) as InsufficientData, not a valid numeric percentage", (_label, value) => {
    const result = calculateHabitScore({ hasData: true, impulseSpending: { amountSharePercentage: value } });
    expect(result.breakdown.impulse.value).toBeNull();
    expect(result.breakdown.impulse.points).toBe(0);
    expect(result.breakdown.impulse.tier).toBe("InsufficientData");
  });

  it("produces InsufficientData when neither amountSharePercentage nor transactionSharePercentage is finite", () => {
    const result = calculateHabitScore({
      hasData: true,
      impulseSpending: { amountSharePercentage: NaN, transactionSharePercentage: Infinity },
    });
    expect(result.breakdown.impulse.tier).toBe("InsufficientData");
    expect(result.breakdown.impulse.points).toBe(0);
    expect(result.breakdown.impulse.value).toBeNull();
  });

  it("still returns the NO_EXPENSE_DATA empty result when hasData is false, unaffected by the impulse guard", () => {
    const result = calculateHabitScore({ hasData: false });
    expect(result.score).toBeNull();
    expect(result.normalizedScore).toBeNull();
    expect(result.reason).toBe("NO_EXPENSE_DATA");
    expect(result.breakdown).toBeNull();
  });

  it("leaves micro-spending, weekend, subscription, and shopping-frequency behavior unchanged", () => {
    const result = calculateHabitScore({
      hasData: true,
      microSpending: { contributionPercentage: 25 },
      weekendVsWeekday: { weekendRatio: 1.5 },
      subscriptionPattern: { totalSubscriptions: 10 },
      shoppingFrequency: { shoppingTransactions: 20 },
    });
    expect(result.breakdown.microSpending.tier).toBe("HighMicroSpend");
    expect(result.breakdown.weekendRatio.tier).toBe("WeekendHeavy");
    expect(result.breakdown.subscriptionPenalty).toBeGreaterThan(0);
    expect(result.breakdown.shoppingPenalty).toBeGreaterThan(0);
  });
});

describe("habitAnalyzer -> healthAnalyzer: corrected health-score behavior (E)", () => {
  // Real, unmocked modules -- production functions, deterministic fixture.
  const habitAnalyzer = require(path.join("..", "analytics", "analyzers", "habitAnalyzer"));
  const healthAnalyzer = require(path.join("..", "analytics", "analyzers", "healthAnalyzer"));
  const { calculateHabitScore } = require(path.join("..", "analytics", "analyzers", "scoreCal", "habitScore"));
  const habitRules = require(path.join("..", "analytics", "analyzers", "scores", "habitRules"));

  // 24 expenses: 10 Shopping@900, 8 Entertainment@600, 6 Rent@200. Shopping
  function buildImpulseHeavyExpenses() {
    const expenses = [];
    for (let i = 0; i < 10; i++) {
      expenses.push({ expenseCategory: "Shopping", expenseAmount: 900, expenseDate: `2026-08-0${(i % 9) + 1}` });
    }
    for (let i = 0; i < 8; i++) {
      expenses.push({ expenseCategory: "Entertainment", expenseAmount: 600, expenseDate: `2026-08-${String(10 + i).padStart(2, "0")}` });
    }
    for (let i = 0; i < 6; i++) {
      expenses.push({ expenseCategory: "Rent", expenseAmount: 200, expenseDate: `2026-08-${String(18 + i).padStart(2, "0")}` });
    }
    return expenses;
  }

  it("produces a non-zero impulse share when configured impulse-category expenses exist", () => {
    const report = habitAnalyzer.analyze(buildImpulseHeavyExpenses(), habitRules.habits);
    expect(report.hasData).toBe(true);
    expect(report.impulseSpending.amountSharePercentage).toBe(92);
    expect(report.impulseSpending.transactionSharePercentage).toBe(75);
  });

  it("scores the corrected habit report differently from the former empty-object behavior", () => {
    const report = habitAnalyzer.analyze(buildImpulseHeavyExpenses(), habitRules.habits);
    const correctedScore = calculateHabitScore(report);

    // The former production behavior: healthAnalyzer always received {}
    const FORMER_PRODUCTION_NORMALIZED_SCORE = 75;
    expect(correctedScore.normalizedScore).not.toBe(FORMER_PRODUCTION_NORMALIZED_SCORE);
    expect(correctedScore.normalizedScore).toBe(45);
    expect(correctedScore.breakdown.impulse.tier).toBe("HighImpulse");
  });

  it("produces a numeric scores.habit and includes habit in dataCompleteness.includedModules when valid habit data exists", () => {
    const report = habitAnalyzer.analyze(buildImpulseHeavyExpenses(), habitRules.habits);
    const health = healthAnalyzer.analyze({
      budget: { hasBudget: false },
      category: { hasData: false },
      spending: { hasData: false },
      trend: { hasData: false },
      habits: report,
    });

    expect(typeof health.scores.habit.normalizedScore).toBe("number");
    expect(health.scores.habit.normalizedScore).toBe(45);
    expect(health.dataCompleteness.includedModules).toContain("habit");
    expect(health.dataCompleteness.excludedModules).not.toContain("habit");
  });

  it("continues excluding the habit module from health when hasData is false", () => {
    const health = healthAnalyzer.analyze({
      budget: { hasBudget: false },
      category: { hasData: false },
      spending: { hasData: false },
      trend: { hasData: false },
      habits: { hasData: false },
    });

    expect(health.scores.habit.score).toBeNull();
    expect(health.scores.habit.normalizedScore).toBeNull();
    expect(health.dataCompleteness.includedModules).not.toContain("habit");
    expect(health.dataCompleteness.excludedModules).toContain("habit");
  });

  it("derives overall health and risk from the corrected habit contribution", () => {
    const report = habitAnalyzer.analyze(buildImpulseHeavyExpenses(), habitRules.habits);
    const health = healthAnalyzer.analyze({
      budget: { hasBudget: false },
      category: { hasData: false },
      spending: { hasData: false },
      trend: { hasData: false },
      habits: report,
    });

    // Every other module has no data (hasData:false/hasBudget:false), so
    expect(health.overall).toBe(30);
    expect(health.risk.label).toBe("Critical");
    expect(typeof health.risk.color).toBe("string");
  });
});

describe("healthAnalyzer boundary: raw-transaction isolation (F)", () => {
  const habitAnalyzer = require(path.join("..", "analytics", "analyzers", "habitAnalyzer"));
  const healthAnalyzer = require(path.join("..", "analytics", "analyzers", "healthAnalyzer"));
  const habitRules = require(path.join("..", "analytics", "analyzers", "scores", "habitRules"));

  const MARKER = "M0-1-UNIQUE-MARKER-9f21a";

  function buildExpensesWithMarker() {
    const expenses = [
      { expenseCategory: "Shopping", expenseAmount: 900, expenseDate: "2026-08-01", expenseName: MARKER, isRecurring: true },
    ];
    for (let i = 1; i < 10; i++) {
      expenses.push({ expenseCategory: "Shopping", expenseAmount: 900, expenseDate: `2026-08-0${(i % 9) + 1}` });
    }
    for (let i = 0; i < 8; i++) {
      expenses.push({ expenseCategory: "Entertainment", expenseAmount: 600, expenseDate: `2026-08-${String(10 + i).padStart(2, "0")}` });
    }
    for (let i = 0; i < 6; i++) {
      expenses.push({ expenseCategory: "Rent", expenseAmount: 200, expenseDate: `2026-08-${String(18 + i).padStart(2, "0")}` });
    }
    return expenses;
  }

  it("the source habit report legitimately contains the marker (proving the fixture actually flowed through)", () => {
    const report = habitAnalyzer.analyze(buildExpensesWithMarker(), habitRules.habits);
    // subscriptionPattern.highestSubscription is a raw expense record --
    // this is the exact field the marker is designed to surface.
    expect(JSON.stringify(report)).toContain(MARKER);
    expect(report.subscriptionPattern.highestSubscription.expenseName).toBe(MARKER);
  });

  it("financialHealth does not contain the source expense objects or the unique marker", () => {
    const report = habitAnalyzer.analyze(buildExpensesWithMarker(), habitRules.habits);
    const health = healthAnalyzer.analyze({
      budget: { hasBudget: false },
      category: { hasData: false },
      spending: { hasData: false },
      trend: { hasData: false },
      habits: report,
    });

    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain(MARKER);
    expect(serialized).not.toContain("highestSubscription");
    expect(serialized).not.toContain("subscriptionsBreakdown");
    expect(serialized).not.toContain("expenseDate");
    expect(serialized).not.toContain("expenseCategory");
  });
});

// Category Normalization -- single implementation pass, required scenario
describe("Category Normalization: shopping/impulse analytics recognize historical casing and spacing variants (G)", () => {
  const habitAnalyzer = require(path.join("..", "analytics", "analyzers", "habitAnalyzer"));
  const habitRules = require(path.join("..", "analytics", "analyzers", "scores", "habitRules"));

  it("calculateShoppingFrequency counts a lower-cased, whitespace-padded historical 'shopping' the same as canonical 'Shopping'", () => {
    const canonical = [
      { expenseCategory: "Shopping", expenseAmount: 100, expenseDate: "2026-08-01" },
      { expenseCategory: "Shopping", expenseAmount: 100, expenseDate: "2026-08-05" },
    ];
    const variant = [
      { expenseCategory: "  shopping ", expenseAmount: 100, expenseDate: "2026-08-01" },
      { expenseCategory: "SHOPPING", expenseAmount: 100, expenseDate: "2026-08-05" },
    ];

    const canonicalResult = habitAnalyzer.calculateShoppingFrequency(canonical);
    const variantResult = habitAnalyzer.calculateShoppingFrequency(variant);

    expect(variantResult).toEqual(canonicalResult);
    expect(variantResult.shoppingTransactions).toBe(2);
  });

  it("calculateShoppingFrequency never throws and reports zero shopping activity for missing/invalid categories", () => {
    const expenses = [
      { expenseCategory: null, expenseAmount: 50, expenseDate: "2026-08-01" },
      { expenseAmount: 50, expenseDate: "2026-08-02" },
      { expenseCategory: "   ", expenseAmount: 50, expenseDate: "2026-08-03" },
    ];

    expect(() => habitAnalyzer.calculateShoppingFrequency(expenses)).not.toThrow();
    const result = habitAnalyzer.calculateShoppingFrequency(expenses);
    expect(result.shoppingTransactions).toBe(0);
  });

  it("calculateImpulseSpending recognizes alias/casing/whitespace variants of the configured impulse categories", () => {
    // habitRules.habits.impulseSpending.categories includes "Shopping",
    const canonical = [
      { expenseCategory: "Shopping", expenseAmount: 200, expenseDate: "2026-08-01" },
      { expenseCategory: "Personal Care", expenseAmount: 150, expenseDate: "2026-08-02" },
      { expenseCategory: "Rent", expenseAmount: 500, expenseDate: "2026-08-03" },
    ];
    const variant = [
      { expenseCategory: "shopping", expenseAmount: 200, expenseDate: "2026-08-01" },
      { expenseCategory: "personal   care", expenseAmount: 150, expenseDate: "2026-08-02" },
      { expenseCategory: "Rent", expenseAmount: 500, expenseDate: "2026-08-03" },
    ];

    const canonicalResult = habitAnalyzer.calculateImpulseSpending(canonical, habitRules.habits.impulseSpending);
    const variantResult = habitAnalyzer.calculateImpulseSpending(variant, habitRules.habits.impulseSpending);

    expect(variantResult.transactionCount).toBe(canonicalResult.transactionCount);
    expect(variantResult.totalSpent).toBe(canonicalResult.totalSpent);
    expect(variantResult.transactionCount).toBe(2);
    expect(variantResult.topImpulseCategory).toBe("Shopping");
  });

  it("calculateImpulseSpending recognizes an approved alias ('Medical') as the canonical configured category ('Health') when the rule itself is extended to include it", () => {
    // Uses a LOCAL config (not habitRules.habits, which does not configure
    const config = { categories: ["Health"] };
    const expenses = [
      { expenseCategory: "Medical", expenseAmount: 80, expenseDate: "2026-08-01" },
      { expenseCategory: "healthcare", expenseAmount: 40, expenseDate: "2026-08-02" },
      { expenseCategory: "Rent", expenseAmount: 500, expenseDate: "2026-08-03" },
    ];

    const result = habitAnalyzer.calculateImpulseSpending(expenses, config);

    expect(result.transactionCount).toBe(2);
    expect(result.totalSpent).toBe(120);
    expect(result.topImpulseCategory).toBe("Health");
  });

  it("calculateImpulseSpending never throws and excludes expenses with missing/invalid categories from matching", () => {
    const expenses = [
      { expenseCategory: null, expenseAmount: 999, expenseDate: "2026-08-01" },
      { expenseAmount: 999, expenseDate: "2026-08-02" },
      { expenseCategory: "Shopping", expenseAmount: 50, expenseDate: "2026-08-03" },
    ];

    expect(() => habitAnalyzer.calculateImpulseSpending(expenses, habitRules.habits.impulseSpending)).not.toThrow();
    const result = habitAnalyzer.calculateImpulseSpending(expenses, habitRules.habits.impulseSpending);
    expect(result.transactionCount).toBe(1);
    expect(result.totalSpent).toBe(50);
  });
});
