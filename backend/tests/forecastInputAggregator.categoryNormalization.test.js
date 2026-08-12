// Category Normalization -- final bounded correction.
//
// Confirmed production gap (completion-verification review):
// analytics/forecastInputAggregator.js's buildCompletedMonthCategorySeries()
// built its grouping key with trim-only handling
// (`record.expenseCategory.trim()`), so historical variants of the SAME
// category ("Food"/"food"/"FOOD", or the approved alias pair
// "Medical"/"healthcare"/"Health") each became a SEPARATE forecast
// category. Because every emitted category then gets its own trend fit and
// its own share of the reconciled published total, that fragmentation
// distorted the per-category forecast breakdown rather than merely
// mislabelling it.
//
// These tests exercise the REAL production module (no mocks, no stubbed
// analyzer) against a fixed anchor date, and prove the grouping key now
// comes from the shared backend normalizer while every other property of
// this aggregation boundary -- window, ordering, output shape, skip rules
// for invalid dates/amounts -- is unchanged.
"use strict";

const {
  buildCompletedMonthSeries,
  buildCompletedMonthCategorySeries,
} = require("../analytics/forecastInputAggregator");
const { UNCATEGORIZED } = require("../utils/categoryNormalization");

// Anchor: 1 Aug 2026 -- completed history is Jul 2026 backwards, matching
// tests/analytics.categoryForecast.test.js's existing convention.
const MONTH_START = new Date(2026, 7, 1);

const expense = (monthsAgo, amount, category, day = 15) => ({
  expenseDate: new Date(2026, 7 - monthsAgo, day),
  expenseAmount: amount,
  expenseCategory: category,
});

const categoryTotal = (entry) =>
  Number(entry.monthlySeries.reduce((sum, p) => sum + p.totalAmount, 0).toFixed(2));

const grandTotal = (series) =>
  Number(series.reduce((sum, entry) => sum + categoryTotal(entry), 0).toFixed(2));

describe("forecastInputAggregator -- category normalization (1) case/whitespace variants merge", () => {
  it("merges Food / food / FOOD / '  Food  ' into ONE canonical 'Food' category", () => {
    const pool = [
      expense(1, 100, "Food"),
      expense(1, 50, "food"),
      expense(2, 25, "FOOD"),
      expense(2, 10, "  Food  "),
    ];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    expect(series.map((e) => e.category)).toEqual(["Food"]);
    expect(categoryTotal(series[0])).toBe(185);
  });

  it("merges repeated-internal-whitespace variants ('Personal   Care') with the canonical name", () => {
    const pool = [
      expense(1, 40, "Personal Care"),
      expense(1, 60, "personal   care"),
      expense(2, 10, "PERSONAL CARE"),
    ];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    expect(series.map((e) => e.category)).toEqual(["Personal Care"]);
    expect(categoryTotal(series[0])).toBe(110);
  });
});

describe("forecastInputAggregator -- category normalization (2) alias-equivalent categories merge", () => {
  it("merges Medical / healthcare / Health into ONE canonical 'Health' category", () => {
    const pool = [
      expense(1, 200, "Health"),
      expense(1, 100, "Medical"),
      expense(2, 50, "healthcare"),
    ];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    expect(series.map((e) => e.category)).toEqual(["Health"]);
    expect(categoryTotal(series[0])).toBe(350);
  });

  it("merges utility / utilities / emi into ONE canonical 'Bills' category", () => {
    const pool = [
      expense(1, 10, "Bills"),
      expense(1, 20, "utility"),
      expense(2, 30, "UTILITIES"),
      expense(2, 40, "emi"),
    ];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    expect(series.map((e) => e.category)).toEqual(["Bills"]);
    expect(categoryTotal(series[0])).toBe(100);
  });
});

describe("forecastInputAggregator -- category normalization (3) unknown categories stay separate and deterministic", () => {
  it("preserves an unknown/custom category as its own distinct, cleaned entry", () => {
    const pool = [
      expense(1, 70, "Pet Care"),
      expense(1, 30, "pet care"),
      expense(2, 25, "Crypto Trading"),
      expense(2, 100, "Food"),
    ];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    // "Pet Care" merges with its own casing variant but is NEVER folded
    // into "Others" or any existing canonical bucket, and stays separate
    // from the other unknown category.
    expect(series.map((e) => e.category)).toEqual(["Crypto Trading", "Food", "Pet Care"]);
    expect(categoryTotal(series.find((e) => e.category === "Pet Care"))).toBe(100);
    expect(categoryTotal(series.find((e) => e.category === "Crypto Trading"))).toBe(25);
    expect(series.map((e) => e.category)).not.toContain("Others");
  });

  it("is deterministic and input-order independent for unknown categories", () => {
    const poolA = [expense(1, 70, "Pet Care"), expense(2, 25, "Crypto Trading")];
    const poolB = [expense(2, 25, "  CRYPTO   trading  "), expense(1, 70, "  PET care  ")];

    const a = buildCompletedMonthCategorySeries(poolA, MONTH_START);
    const b = buildCompletedMonthCategorySeries(poolB, MONTH_START);

    expect(b.map((e) => e.category)).toEqual(a.map((e) => e.category));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  // Casing-correction fix -- formerly a KNOWN LIMITATION here: an
  // all-caps unknown category ("PET CARE") did not merge with its
  // mixed-case twin ("Pet Care"), because the shared normalizer's
  // unknown-category pass-through Title-Cased only each word's leading
  // letter and left the rest of the string's case untouched. That is now
  // fixed in utils/categoryNormalization.js's toTitleCase() (lowercases the
  // cleaned value before Title-Casing, exactly matching AddExpense.js's own
  // normalizeCategory), so this boundary now merges as required. KNOWN
  // categories and approved aliases were never affected -- they resolve
  // through the case-insensitive alias table (see the Food/FOOD and
  // Medical/Health cases above).
  it("merges 'Pet Care', 'PET CARE', and 'pet care' into ONE canonical 'Pet Care' series (formerly a known limitation)", () => {
    const pool = [
      expense(1, 70, "Pet Care"),
      expense(1, 30, "PET CARE"),
      expense(2, 45, "pet care"),
    ];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    expect(series.map((e) => e.category)).toEqual(["Pet Care"]);
    expect(categoryTotal(series[0])).toBe(145);
    // Counts conserved: all three records land in the same single entry.
    expect(grandTotal(series)).toBe(145);
  });
});

describe("forecastInputAggregator -- category normalization (4) invalid historical values use Uncategorized", () => {
  it("groups missing, empty, whitespace-only and non-string categories under Uncategorized", () => {
    const pool = [
      expense(1, 100, "Food"),
      expense(1, 5, ""),
      expense(1, 6, "   "),
      expense(1, 7, null),
      expense(1, 8, 42),
      { expenseDate: new Date(2026, 6, 15), expenseAmount: 9 }, // expenseCategory entirely absent
    ];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    expect(series.map((e) => e.category)).toEqual(["Food", UNCATEGORIZED]);
    expect(categoryTotal(series.find((e) => e.category === UNCATEGORIZED))).toBe(35);
  });

  it("never routes invalid data into 'Others' (a real, user-choosable category)", () => {
    const pool = [expense(1, 50, "Others"), expense(1, 11, "")];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    expect(series.map((e) => e.category).sort()).toEqual(["Others", UNCATEGORIZED].sort());
    expect(categoryTotal(series.find((e) => e.category === "Others"))).toBe(50);
    expect(categoryTotal(series.find((e) => e.category === UNCATEGORIZED))).toBe(11);
  });

  it("still skips records with an invalid date or uncoercible amount (unchanged skip rules)", () => {
    const pool = [
      expense(1, 100, "Food"),
      { expenseDate: "not-a-date", expenseAmount: 10, expenseCategory: "" },
      { expenseDate: new Date(2026, 6, 5), expenseAmount: "abc", expenseCategory: "" },
      null,
      "not-an-object",
    ];

    expect(() => buildCompletedMonthCategorySeries(pool, MONTH_START)).not.toThrow();
    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    // No Uncategorized entry at all -- both unusable-category records were
    // already dropped by the date/amount guards, which are untouched.
    expect(series.map((e) => e.category)).toEqual(["Food"]);
  });
});

describe("forecastInputAggregator -- category normalization (5) counts and monetary totals are conserved", () => {
  it("the sum of all category totals equals the overall completed-month total", () => {
    const pool = [
      expense(1, 100, "Food"),
      expense(1, 50.5, "food"),
      expense(1, 20, "Medical"),
      expense(2, 30.25, "Health"),
      expense(2, 40, "Pet Care"),
      expense(3, 60, ""), // invalid -> Uncategorized, but its money still counts
      expense(3, 15, null), // invalid -> Uncategorized
    ];

    const overall = buildCompletedMonthSeries(pool, MONTH_START);
    const categories = buildCompletedMonthCategorySeries(pool, MONTH_START);

    const overallTotal = Number(
      overall.reduce((sum, p) => sum + p.totalAmount, 0).toFixed(2)
    );

    // This is the conservation property the previous trim-only skip broke:
    // an unusable-category record's amount counted toward the overall total
    // but belonged to no category, so the breakdown could not reconcile.
    expect(grandTotal(categories)).toBe(overallTotal);
    expect(overallTotal).toBe(315.75);
  });

  it("normalization never creates or destroys expense value -- merged variants total the same as canonical input", () => {
    const variantPool = [
      expense(1, 100, "  fOOd "),
      expense(1, 50, "FOOD"),
      expense(2, 25, "medical"),
      expense(2, 75, "Health"),
    ];
    const canonicalPool = [
      expense(1, 100, "Food"),
      expense(1, 50, "Food"),
      expense(2, 25, "Health"),
      expense(2, 75, "Health"),
    ];

    const variant = buildCompletedMonthCategorySeries(variantPool, MONTH_START);
    const canonical = buildCompletedMonthCategorySeries(canonicalPool, MONTH_START);

    expect(JSON.stringify(variant)).toBe(JSON.stringify(canonical));
    expect(grandTotal(variant)).toBe(250);
  });
});

describe("forecastInputAggregator -- category normalization (6) output structure is unchanged", () => {
  it("still emits { category, monthlySeries:[{ monthKey, totalAmount }] }, sorted by category, each series oldest-first", () => {
    const pool = [
      expense(1, 10, "travel"),
      expense(3, 30, "TRAVEL"),
      expense(2, 20, "Travel"),
      expense(2, 5, "food"),
    ];

    const series = buildCompletedMonthCategorySeries(pool, MONTH_START);

    // Exact top-level shape and key set.
    expect(Array.isArray(series)).toBe(true);
    series.forEach((entry) => {
      expect(Object.keys(entry).sort()).toEqual(["category", "monthlySeries"]);
      expect(typeof entry.category).toBe("string");
      expect(Array.isArray(entry.monthlySeries)).toBe(true);
      entry.monthlySeries.forEach((point) => {
        expect(Object.keys(point).sort()).toEqual(["monthKey", "totalAmount"]);
        expect(typeof point.monthKey).toBe("string");
        expect(typeof point.totalAmount).toBe("number");
      });
    });

    // Deterministic ordering: categories ascending by name.
    expect(series.map((e) => e.category)).toEqual(["Food", "Travel"]);

    // Canonical-timeline alignment preserved: every category is emitted
    // against the SAME completed-month keys, oldest-first, with explicit
    // zeros for months it recorded nothing in.
    const canonicalKeys = buildCompletedMonthSeries(pool, MONTH_START).map((p) => p.monthKey);
    expect(canonicalKeys).toEqual(["2026-4", "2026-5", "2026-6"]);
    series.forEach((entry) => {
      expect(entry.monthlySeries.map((p) => p.monthKey)).toEqual(canonicalKeys);
    });

    const travel = series.find((e) => e.category === "Travel");
    expect(travel.monthlySeries.map((p) => p.totalAmount)).toEqual([30, 20, 10]);

    const food = series.find((e) => e.category === "Food");
    expect(food.monthlySeries.map((p) => p.totalAmount)).toEqual([0, 5, 0]);
  });

  it("returns [] for an invalid anchor date, exactly as before", () => {
    expect(buildCompletedMonthCategorySeries([expense(1, 10, "Food")], new Date("nope"))).toEqual([]);
    expect(buildCompletedMonthCategorySeries([expense(1, 10, "Food")], null)).toEqual([]);
  });

  it("does not mutate the input pool", () => {
    const pool = [expense(1, 10, "  food "), expense(2, 20, "Medical")];
    const snapshot = JSON.stringify(pool);

    buildCompletedMonthCategorySeries(pool, MONTH_START);

    expect(JSON.stringify(pool)).toBe(snapshot);
    expect(pool[0].expenseCategory).toBe("  food ");
    expect(pool[1].expenseCategory).toBe("Medical");
  });
});
