// ANL-001-T03 -- CategoryPatternSignal coverage.
"use strict";

const {
  classifyDominantCategory,
  detectMicroTransactions,
  calculateYearlyStability,
  analyze,
} = require("../analytics/analyzers/categoryPatternAnalyzer");

describe("categoryPatternAnalyzer.analyze: no monthly data", () => {
  it("returns the NO_MONTHLY_CATEGORY_DATA empty signal when monthlyCategoryReport.hasData is falsy", () => {
    const result = analyze({
      monthlyCategoryReport: { hasData: false },
      yearlyCategoryReport: { hasData: false },
      currentMonthExpenses: [],
    });

    expect(result).toEqual({
      hasData: false,
      reasonCode: "NO_MONTHLY_CATEGORY_DATA",
      dominantCategory: null,
      classification: null,
      microTransactionCategories: [],
      yearlyStability: null,
      yearlyConcentration: null,
    });
  });

  it("treats a missing monthlyCategoryReport the same way (default {})", () => {
    const result = analyze({});
    expect(result.hasData).toBe(false);
    expect(result.reasonCode).toBe("NO_MONTHLY_CATEGORY_DATA");
  });
});

describe("categoryPatternAnalyzer: Spike classification", () => {
  it("classifies as Spike when biggestJump matches the dominant category with growthPercentage >= 50", () => {
    const monthlyCategoryReport = {
      hasData: true,
      topCategory: { category: "Shopping", total: 5000 },
      biggestJump: { category: "Shopping", growthPercentage: 75 },
    };

    expect(classifyDominantCategory(monthlyCategoryReport, "Shopping")).toBe("Spike");
  });

  it("classifies as Spike at the exact 50% boundary", () => {
    const monthlyCategoryReport = {
      hasData: true,
      topCategory: { category: "Shopping", total: 5000 },
      biggestJump: { category: "Shopping", growthPercentage: 50 },
    };

    expect(classifyDominantCategory(monthlyCategoryReport, "Shopping")).toBe("Spike");
  });

  it("end to end: analyze() returns Spike for a matching outsized jump on the dominant category", () => {
    const monthlyCategoryReport = {
      hasData: true,
      topCategory: { category: "Shopping", total: 5000 },
      biggestJump: { category: "Shopping", growthPercentage: 75 },
    };

    const result = analyze({
      monthlyCategoryReport,
      yearlyCategoryReport: { hasData: false },
      currentMonthExpenses: [],
    });

    expect(result.dominantCategory).toBe("Shopping");
    expect(result.classification).toBe("Spike");
  });
});

describe("categoryPatternAnalyzer: Habit classification", () => {
  it("classifies as Habit when biggestJump is null", () => {
    const monthlyCategoryReport = {
      hasData: true,
      topCategory: { category: "Rent", total: 12000 },
      biggestJump: null,
    };

    expect(classifyDominantCategory(monthlyCategoryReport, "Rent")).toBe("Habit");
  });

  it("classifies as Habit when biggestJump exists but for a different category", () => {
    const monthlyCategoryReport = {
      hasData: true,
      topCategory: { category: "Rent", total: 12000 },
      biggestJump: { category: "Entertainment", growthPercentage: 90 },
    };

    expect(classifyDominantCategory(monthlyCategoryReport, "Rent")).toBe("Habit");
  });

  it("classifies as Habit when biggestJump matches the category but growth is below 50%", () => {
    const monthlyCategoryReport = {
      hasData: true,
      topCategory: { category: "Rent", total: 12000 },
      biggestJump: { category: "Rent", growthPercentage: 20 },
    };

    expect(classifyDominantCategory(monthlyCategoryReport, "Rent")).toBe("Habit");
  });

  it("returns null classification when there is no dominant category", () => {
    expect(classifyDominantCategory({ hasData: true, biggestJump: null }, null)).toBeNull();
  });
});

describe("categoryPatternAnalyzer.detectMicroTransactions", () => {
  it("flags a category with 3+ transactions under 10% of its own average", () => {
    // Shopping: nine 100s + one 1 => average = (900+1)/10 = 90.1, 10% = 9.01
    const expenses = [
      ...Array.from({ length: 9 }, () => ({ expenseCategory: "Shopping", expenseAmount: 100 })),
      { expenseCategory: "Shopping", expenseAmount: 1 },
      { expenseCategory: "Shopping", expenseAmount: 2 },
      { expenseCategory: "Shopping", expenseAmount: 3 },
    ];

    const result = detectMicroTransactions(expenses);
    const shopping = result.find((r) => r.category === "Shopping");

    expect(shopping).toBeDefined();
    expect(shopping.count).toBe(3);
    expect(shopping.totalAmount).toBe(6);
  });

  it("does not flag a category with fewer than 3 micro transactions", () => {
    const expenses = [
      ...Array.from({ length: 9 }, () => ({ expenseCategory: "Groceries", expenseAmount: 100 })),
      { expenseCategory: "Groceries", expenseAmount: 1 },
      { expenseCategory: "Groceries", expenseAmount: 2 },
    ];

    const result = detectMicroTransactions(expenses);
    expect(result.find((r) => r.category === "Groceries")).toBeUndefined();
  });

  it("skips categories with fewer than 2 total transactions entirely", () => {
    const expenses = [{ expenseCategory: "Rent", expenseAmount: 0.0001 }];
    const result = detectMicroTransactions(expenses);
    expect(result.find((r) => r.category === "Rent")).toBeUndefined();
  });

  it("coerces non-numeric expenseAmount to 0 rather than throwing", () => {
    // amounts -> [100,100,0,100,0,0], average = 300/6 = 50, threshold = 5
    // three 0-amount entries (non-numeric/undefined/null coerced to 0) qualify as micro
    const expenses = [
      { expenseCategory: "Misc", expenseAmount: 100 },
      { expenseCategory: "Misc", expenseAmount: 100 },
      { expenseCategory: "Misc", expenseAmount: "not-a-number" },
      { expenseCategory: "Misc", expenseAmount: 100 },
      { expenseCategory: "Misc", expenseAmount: undefined },
      { expenseCategory: "Misc", expenseAmount: null },
    ];

    expect(() => detectMicroTransactions(expenses)).not.toThrow();
    const result = detectMicroTransactions(expenses);
    // "Misc" is a configured alias of the canonical "Others" category
    const misc = result.find((r) => r.category === "Others");
    expect(misc).toBeDefined();
    expect(misc.count).toBe(3); // the three 0-amount entries
    expect(misc.totalAmount).toBe(0);
  });

  it("returns an empty array for no expenses", () => {
    expect(detectMicroTransactions([])).toEqual([]);
    expect(detectMicroTransactions()).toEqual([]);
  });
});

describe("categoryPatternAnalyzer.calculateYearlyStability", () => {
  it("returns a high stability score for a mix of small growth percentages", () => {
    const yearlyCategoryReport = {
      hasData: true,
      categoryGrowth: [
        { category: "Rent", isNewCategory: false, growthPercentage: 2 },
        { category: "Groceries", isNewCategory: false, growthPercentage: -5 },
        { category: "Utilities", isNewCategory: false, growthPercentage: 3 },
      ],
    };

    // mean abs = (2+5+3)/3 = 10/3 = 3.3333 -> stability = 1 - 0.033333 = 0.9667
    expect(calculateYearlyStability(yearlyCategoryReport)).toBe(0.9667);
  });

  it("returns a low stability score for volatile large growth percentages", () => {
    const yearlyCategoryReport = {
      hasData: true,
      categoryGrowth: [
        { category: "Travel", isNewCategory: false, growthPercentage: 300 },
        { category: "Shopping", isNewCategory: false, growthPercentage: -250 },
      ],
    };

    // mean abs = (300+250)/2 = 275 -> 1 - 2.75 clamped to 0
    expect(calculateYearlyStability(yearlyCategoryReport)).toBe(0);
  });

  it("returns null when categoryGrowth is empty", () => {
    expect(calculateYearlyStability({ hasData: true, categoryGrowth: [] })).toBeNull();
  });

  it("returns null when yearlyCategoryReport.hasData is falsy", () => {
    expect(calculateYearlyStability({ hasData: false, categoryGrowth: [{ growthPercentage: 5, isNewCategory: false }] })).toBeNull();
  });

  it("returns null when every entry is a new category or has a null growthPercentage", () => {
    const yearlyCategoryReport = {
      hasData: true,
      categoryGrowth: [
        { category: "NewOne", isNewCategory: true, growthPercentage: null },
        { category: "NewTwo", isNewCategory: false, growthPercentage: null },
      ],
    };

    expect(calculateYearlyStability(yearlyCategoryReport)).toBeNull();
  });

  it("excludes new categories and null-growth entries from the mean but keeps comparable ones", () => {
    const yearlyCategoryReport = {
      hasData: true,
      categoryGrowth: [
        { category: "Brand New", isNewCategory: true, growthPercentage: null },
        { category: "Stable", isNewCategory: false, growthPercentage: 10 },
      ],
    };

    // Only "Stable" counts: mean abs = 10 -> stability = 0.9
    expect(calculateYearlyStability(yearlyCategoryReport)).toBe(0.9);
  });
});

describe("categoryPatternAnalyzer: yearlyConcentration scaling", () => {
  it("scales a top3Concentration of 75 down to 0.75", () => {
    const result = analyze({
      monthlyCategoryReport: { hasData: true, topCategory: { category: "Rent" }, biggestJump: null },
      yearlyCategoryReport: { hasData: true, top3Concentration: 75, categoryGrowth: [] },
      currentMonthExpenses: [],
    });

    expect(result.yearlyConcentration).toBe(0.75);
  });

  it("returns null when yearlyCategoryReport.hasData is falsy", () => {
    const result = analyze({
      monthlyCategoryReport: { hasData: true, topCategory: { category: "Rent" }, biggestJump: null },
      yearlyCategoryReport: { hasData: false },
      currentMonthExpenses: [],
    });

    expect(result.yearlyConcentration).toBeNull();
  });

  it("rounds a non-clean top3Concentration to 4 decimal places", () => {
    const result = analyze({
      monthlyCategoryReport: { hasData: true, topCategory: { category: "Rent" }, biggestJump: null },
      yearlyCategoryReport: { hasData: true, top3Concentration: 83.333, categoryGrowth: [] },
      currentMonthExpenses: [],
    });

    expect(result.yearlyConcentration).toBe(0.8333);
  });
});
