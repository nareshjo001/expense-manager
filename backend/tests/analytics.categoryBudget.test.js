// BUD-001-T04 -- categoryBudgetAnalyzer: deterministic threshold/risk facts
// and the `<summary>` shape from
// docs/budgets/BUD-001-T01-category-budget-invariants.md section 3.
//
// Every `now` is built with the LOCAL Date constructor, matching the
// contract's server-local month boundaries, so these tests pass in any TZ.

const mongoose = require("mongoose");
const {
  analyzeCategoryBudgets,
  calculateProjectedSpentMinor,
  daysInMonthOf,
} = require("../analytics/analyzers/categoryBudgetAnalyzer");

// 15 Sep 2026, noon local -- mid-month of a 30-day month.
const MID_SEPTEMBER = new Date(2026, 8, 15, 12, 0, 0);

const alloc = (category, amountMinor, id = `id-${category}`) => ({ _id: id, category, amountMinor });

const run = (overrides = {}) =>
  analyzeCategoryBudgets({
    month: "2026-09",
    allocations: [],
    spentByCategory: new Map(),
    totalSpentMinor: 0,
    totalBudgetMinor: null,
    now: MID_SEPTEMBER,
    writable: true,
    ...overrides,
  });

// Single-allocation helper: amount 10,000 paise, `spent` paise spent.
const single = (spentMinor, overrides = {}) => {
  const result = run({
    allocations: [alloc("Food", 10000)],
    spentByCategory: new Map([["Food", spentMinor]]),
    totalSpentMinor: spentMinor,
    ...overrides,
  });
  return result.categories[0];
};

describe("categoryBudgetAnalyzer -- summary shape", () => {
  it("returns exactly the documented top-level keys", () => {
    const result = run();
    expect(Object.keys(result).sort()).toEqual(
      ["asOfDate", "categories", "month", "rolloverPolicy", "totals", "unbudgetedCategories", "writable"].sort()
    );
    expect(Object.keys(result.totals).sort()).toEqual(
      [
        "allocatedMinor",
        "budgetedSpentMinor",
        "overAllocated",
        "overAllocatedByMinor",
        "totalBudgetMinor",
        "totalSpentMinor",
        "unallocatedMinor",
        "unbudgetedSpentMinor",
      ].sort()
    );
  });

  it("returns exactly the documented per-category keys", () => {
    expect(Object.keys(single(100)).sort()).toEqual(
      [
        "amountMinor",
        "atRisk",
        "category",
        "id",
        "projectedSpentMinor",
        "projectedStatus",
        "remainingMinor",
        "spentMinor",
        "status",
        "utilization",
      ].sort()
    );
  });

  it("echoes month and writable, states rolloverPolicy 'none' (I11) and asOfDate from the injected now", () => {
    const result = run({ writable: false });
    expect(result.month).toBe("2026-09");
    expect(result.writable).toBe(false);
    expect(result.rolloverPolicy).toBe("none");
    expect(result.asOfDate).toBe(MID_SEPTEMBER.toISOString());
    expect(run({ writable: true }).writable).toBe(true);
  });

  it("stringifies _id (including a real ObjectId) and falls back to id", () => {
    const oid = new mongoose.Types.ObjectId();
    const result = run({
      allocations: [
        { _id: oid, category: "Food", amountMinor: 100 },
        { id: "plain-id", category: "Rent", amountMinor: 100 },
      ],
    });
    const byCategory = Object.fromEntries(result.categories.map((c) => [c.category, c]));
    expect(byCategory.Food.id).toBe(oid.toHexString());
    expect(typeof byCategory.Food.id).toBe("string");
    expect(byCategory.Rent.id).toBe("plain-id");
  });

  it("is plain JSON-serializable (no Map, Date or ObjectId leaks through)", () => {
    const result = run({
      allocations: [{ _id: new mongoose.Types.ObjectId(), category: "Food", amountMinor: 10000 }],
      spentByCategory: new Map([["Food", 5000], ["Uncategorized", 300]]),
      totalSpentMinor: 5300,
      totalBudgetMinor: 20000,
    });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(Array.isArray(result.categories)).toBe(true);
    expect(Array.isArray(result.unbudgetedCategories)).toBe(true);
  });

  it("is pure: same inputs -> same output, inputs are not mutated, and system time is ignored", () => {
    const allocations = Object.freeze([Object.freeze(alloc("Food", 10000)), Object.freeze(alloc("Rent", 5000))]);
    const spent = new Map([["Food", 4000], ["Rent", 5000], ["Travel", 10]]);
    const input = { allocations, spentByCategory: spent, totalSpentMinor: 9010, totalBudgetMinor: 20000 };

    const first = run(input);
    jest.useFakeTimers().setSystemTime(new Date(2031, 0, 1));
    try {
      expect(run(input)).toEqual(first);
    } finally {
      jest.useRealTimers();
    }
    expect([...spent.entries()]).toEqual([["Food", 4000], ["Rent", 5000], ["Travel", 10]]);
  });
});

describe("categoryBudgetAnalyzer -- per-category facts", () => {
  it("derives spent from the map, remaining = amount - spent, and 0 spent when the category is absent", () => {
    const result = run({
      allocations: [alloc("Food", 10000), alloc("Rent", 5000)],
      spentByCategory: new Map([["Food", 2500]]),
      totalSpentMinor: 2500,
    });
    const byCategory = Object.fromEntries(result.categories.map((c) => [c.category, c]));
    expect(byCategory.Food).toMatchObject({ amountMinor: 10000, spentMinor: 2500, remainingMinor: 7500, utilization: 25 });
    expect(byCategory.Rent).toMatchObject({ amountMinor: 5000, spentMinor: 0, remainingMinor: 5000, utilization: 0, status: "Safe" });
  });

  it("allows a negative remainingMinor when overspent", () => {
    expect(single(12345)).toMatchObject({ remainingMinor: -2345, utilization: 123.45, status: "Overspent" });
  });

  it("rounds utilization to 2 dp", () => {
    const result = run({
      allocations: [alloc("Food", 3)],
      spentByCategory: new Map([["Food", 1]]),
      totalSpentMinor: 1,
    });
    expect(result.categories[0].utilization).toBe(33.33);
  });

  // I10 tier boundaries: Safe <= 70 < Warning <= 90 < Critical <= 100 < Overspent.
  it.each([
    [0, 0, "Safe"],
    [7000, 70, "Safe"],
    [7001, 70.01, "Warning"],
    [9000, 90, "Warning"],
    [9001, 90.01, "Critical"],
    [10000, 100, "Critical"],
    [10001, 100.01, "Overspent"],
  ])("spent %i of 10000 -> utilization %d -> %s", (spentMinor, utilization, status) => {
    const category = single(spentMinor);
    expect(category.utilization).toBe(utilization);
    expect(category.status).toBe(status);
  });
});

describe("categoryBudgetAnalyzer -- projection", () => {
  describe("daysInMonthOf", () => {
    it.each([
      ["2026-01", 31],
      ["2026-02", 28],
      ["2028-02", 29], // leap year
      ["2000-02", 29], // divisible by 400
      ["2026-03", 31], // contains a DST start in many zones
      ["2026-04", 30],
      ["2026-10", 31], // contains a DST end in many zones
      ["2026-11", 30], // contains a DST end in North America
      ["2026-09", 30],
      ["2026-12", 31],
    ])("%s has %i days", (month, days) => {
      expect(daysInMonthOf(month)).toBe(days);
    });
  });

  describe("current month: spent / daysElapsed * daysInMonth", () => {
    it("mid-month doubles the pace in a 30-day month (day 15)", () => {
      expect(single(1500)).toMatchObject({ projectedSpentMinor: 3000, projectedStatus: "Safe" });
    });

    it("day 1 extrapolates one day's spend across the whole month", () => {
      const now = new Date(2026, 8, 1, 0, 0, 0);
      expect(single(100, { now })).toMatchObject({ projectedSpentMinor: 3000 });
    });

    it("the last day of the month projects exactly the spent amount", () => {
      const now = new Date(2026, 8, 30, 23, 59, 59);
      expect(single(9000, { now })).toMatchObject({ spentMinor: 9000, projectedSpentMinor: 9000, projectedStatus: "Warning" });
    });

    it("the last day of a 31-day month projects exactly the spent amount", () => {
      const now = new Date(2026, 0, 31, 12);
      expect(single(4321, { month: "2026-01", now }).projectedSpentMinor).toBe(4321);
    });

    it("February of a common year uses 28 days", () => {
      const now = new Date(2026, 1, 14, 12);
      expect(single(1400, { month: "2026-02", now }).projectedSpentMinor).toBe(2800);
    });

    it("February of a leap year uses 29 days", () => {
      const now = new Date(2028, 1, 10, 12);
      expect(single(1000, { month: "2028-02", now }).projectedSpentMinor).toBe(2900);
    });

    it("rounds the projection to a whole paise", () => {
      // 1000 / 3 * 31 = 10333.33...
      const now = new Date(2026, 0, 3, 12);
      expect(single(1000, { month: "2026-01", now }).projectedSpentMinor).toBe(10333);
    });

    it("zero spend projects zero", () => {
      expect(single(0)).toMatchObject({ projectedSpentMinor: 0, projectedStatus: "Safe", atRisk: false });
    });
  });

  describe("past month: final, projected = spent", () => {
    it("the previous month", () => {
      expect(single(9500, { month: "2026-08" })).toMatchObject({
        spentMinor: 9500,
        projectedSpentMinor: 9500,
        projectedStatus: "Critical",
      });
    });

    it("across a year boundary (Dec viewed from Jan)", () => {
      const now = new Date(2027, 0, 1, 0, 0, 0);
      expect(single(1234, { month: "2026-12", now })).toMatchObject({ projectedSpentMinor: 1234, projectedStatus: "Safe" });
    });
  });

  describe("future month: nothing to extrapolate", () => {
    it("projectedSpentMinor and projectedStatus are null, atRisk false", () => {
      expect(single(0, { month: "2026-10" })).toMatchObject({ projectedSpentMinor: null, projectedStatus: null, atRisk: false });
    });

    it("post-dated spend still gets a status but no projection", () => {
      expect(single(9500, { month: "2027-01" })).toMatchObject({
        status: "Critical",
        projectedSpentMinor: null,
        projectedStatus: null,
        atRisk: false,
      });
    });

    it("the next month viewed from the last instant of December", () => {
      const now = new Date(2026, 11, 31, 23, 59, 59);
      expect(single(10, { month: "2027-01", now }).projectedSpentMinor).toBeNull();
    });
  });

  it("calculateProjectedSpentMinor is exported for reuse and agrees with the summary", () => {
    expect(calculateProjectedSpentMinor({ spentMinor: 1500, month: "2026-09", now: MID_SEPTEMBER })).toBe(3000);
    expect(calculateProjectedSpentMinor({ spentMinor: 1500, month: "2026-08", now: MID_SEPTEMBER })).toBe(1500);
    expect(calculateProjectedSpentMinor({ spentMinor: 1500, month: "2026-10", now: MID_SEPTEMBER })).toBeNull();
  });
});

describe("categoryBudgetAnalyzer -- atRisk truth table", () => {
  // Mid-September (day 15 of 30): projected = 2 x spent. Amount 10000.
  it.each([
    [3000, "Safe", "Safe", false],
    [4000, "Safe", "Warning", false],
    [4500, "Safe", "Warning", false], // projected exactly 90% -> still Warning
    [4501, "Safe", "Critical", true], // projected 90.02%
    [5000, "Safe", "Critical", true], // projected exactly 100%
    [5001, "Safe", "Overspent", true],
    [8000, "Warning", "Overspent", true],
    [9500, "Critical", "Overspent", true],
    [10000, "Critical", "Overspent", true],
    [10001, "Overspent", "Overspent", false], // already Overspent: a fact, not a risk
  ])("spent %i: status %s, projected %s -> atRisk %s", (spentMinor, status, projectedStatus, atRisk) => {
    expect(single(spentMinor)).toMatchObject({ status, projectedStatus, atRisk });
  });

  it("a closed (past) month is never atRisk, even at Critical -- it can no longer be acted on", () => {
    expect(single(9500, { month: "2026-08" })).toMatchObject({ status: "Critical", projectedStatus: "Critical", atRisk: false });
  });

  it("status uses the exact ratio: 1 paisa over a large allocation is Overspent, not Critical", () => {
    expect(single(10000001, { allocations: [alloc("Food", 10000000)] })).toMatchObject({ status: "Overspent", utilization: 100 });
  });

  it("a past month in Warning is not atRisk", () => {
    expect(single(8000, { month: "2026-08" })).toMatchObject({ status: "Warning", projectedStatus: "Warning", atRisk: false });
  });

  it("a future month is never atRisk", () => {
    expect(single(9999, { month: "2026-11" }).atRisk).toBe(false);
  });
});

describe("categoryBudgetAnalyzer -- totals and reconciliation (I7, I9)", () => {
  const allocations = [alloc("Food", 10000), alloc("Rent", 20000)];
  const spentByCategory = new Map([["Food", 4000], ["Rent", 20000], ["Travel", 1500], ["Uncategorized", 500]]);
  const base = { allocations, spentByCategory, totalSpentMinor: 26000 };

  it("no total budget: totalBudgetMinor and unallocatedMinor are null, never over-allocated", () => {
    expect(run({ ...base, totalBudgetMinor: null }).totals).toEqual({
      totalBudgetMinor: null,
      allocatedMinor: 30000,
      unallocatedMinor: null,
      overAllocated: false,
      overAllocatedByMinor: 0,
      budgetedSpentMinor: 24000,
      unbudgetedSpentMinor: 2000,
      totalSpentMinor: 26000,
    });
  });

  it("an undefined total budget is treated as no total", () => {
    const totals = run({ ...base, totalBudgetMinor: undefined }).totals;
    expect(totals.totalBudgetMinor).toBeNull();
    expect(totals.unallocatedMinor).toBeNull();
  });

  it("allocations under the total report the unallocated remainder", () => {
    expect(run({ ...base, totalBudgetMinor: 50000 }).totals).toMatchObject({
      totalBudgetMinor: 50000,
      allocatedMinor: 30000,
      unallocatedMinor: 20000,
      overAllocated: false,
      overAllocatedByMinor: 0,
    });
  });

  it("allocations exactly equal to the total are not over-allocated", () => {
    expect(run({ ...base, totalBudgetMinor: 30000 }).totals).toMatchObject({
      unallocatedMinor: 0,
      overAllocated: false,
      overAllocatedByMinor: 0,
    });
  });

  it("a total lowered below the allocations reports overAllocated and by how much", () => {
    expect(run({ ...base, totalBudgetMinor: 29999 }).totals).toMatchObject({
      unallocatedMinor: 0,
      overAllocated: true,
      overAllocatedByMinor: 1,
    });
    expect(run({ ...base, totalBudgetMinor: 20000 }).totals).toMatchObject({
      unallocatedMinor: 0,
      overAllocated: true,
      overAllocatedByMinor: 10000,
    });
  });

  it("a total budget of 0 with allocations is over-allocated by the full allocation", () => {
    expect(run({ ...base, totalBudgetMinor: 0 }).totals).toMatchObject({
      totalBudgetMinor: 0,
      unallocatedMinor: 0,
      overAllocated: true,
      overAllocatedByMinor: 30000,
    });
  });

  it("budgeted + unbudgeted spend reconciles to totalSpentMinor", () => {
    const { totals } = run(base);
    expect(totals.budgetedSpentMinor + totals.unbudgetedSpentMinor).toBe(totals.totalSpentMinor);
  });

  it("clamps unbudgetedSpentMinor at 0 when the total is below the budgeted spend (inconsistent snapshots)", () => {
    const { totals } = run({ ...base, totalSpentMinor: 1000 });
    expect(totals.budgetedSpentMinor).toBe(24000);
    expect(totals.unbudgetedSpentMinor).toBe(0);
    expect(totals.totalSpentMinor).toBe(1000);
  });

  it("does not double count spend if the same category is allocated twice", () => {
    const { totals, categories } = run({
      allocations: [alloc("Food", 10000, "a"), alloc("Food", 5000, "b")],
      spentByCategory: new Map([["Food", 4000], ["Travel", 1000]]),
      totalSpentMinor: 5000,
    });
    expect(categories).toHaveLength(2);
    expect(totals.allocatedMinor).toBe(15000);
    expect(totals.budgetedSpentMinor).toBe(4000);
    expect(totals.unbudgetedSpentMinor).toBe(1000);
  });
});

describe("categoryBudgetAnalyzer -- unbudgeted categories", () => {
  it("lists every spent category without an allocation, including Uncategorized, by spent desc then name", () => {
    const result = run({
      allocations: [alloc("Food", 10000)],
      spentByCategory: new Map([
        ["Food", 9000],
        ["Uncategorized", 700],
        ["Travel", 1500],
        ["Bills", 700],
        ["Zoo", 700],
        ["Gifts", 0],
      ]),
      totalSpentMinor: 12600,
    });
    expect(result.unbudgetedCategories).toEqual([
      { category: "Travel", spentMinor: 1500 },
      { category: "Bills", spentMinor: 700 },
      { category: "Uncategorized", spentMinor: 700 },
      { category: "Zoo", spentMinor: 700 },
    ]);
    expect(result.totals.unbudgetedSpentMinor).toBe(3600);
  });

  it("excludes zero-spend entries and budgeted categories", () => {
    const result = run({
      allocations: [alloc("Food", 10000)],
      spentByCategory: new Map([["Food", 100], ["Gifts", 0]]),
      totalSpentMinor: 100,
    });
    expect(result.unbudgetedCategories).toEqual([]);
  });

  it("output order does not depend on Map insertion order", () => {
    const entries = [["B", 5], ["A", 5], ["C", 9]];
    const forward = run({ spentByCategory: new Map(entries), totalSpentMinor: 19 });
    const reversed = run({ spentByCategory: new Map([...entries].reverse()), totalSpentMinor: 19 });
    expect(forward.unbudgetedCategories).toEqual(reversed.unbudgetedCategories);
    expect(forward.unbudgetedCategories.map((c) => c.category)).toEqual(["C", "A", "B"]);
  });
});

describe("categoryBudgetAnalyzer -- deterministic sort", () => {
  it("sorts categories by utilization desc, then category asc on ties", () => {
    const allocations = [alloc("Rent", 10000), alloc("Bills", 10000), alloc("Food", 10000), alloc("Travel", 10000)];
    const spentByCategory = new Map([["Rent", 5000], ["Bills", 5000], ["Food", 12000], ["Travel", 100]]);
    const result = run({ allocations, spentByCategory, totalSpentMinor: 22100 });
    expect(result.categories.map((c) => [c.category, c.utilization])).toEqual([
      ["Food", 120],
      ["Bills", 50],
      ["Rent", 50],
      ["Travel", 1],
    ]);
  });

  it("gives the same order regardless of input order", () => {
    const allocations = [alloc("Rent", 10000), alloc("Bills", 10000), alloc("Food", 20000), alloc("Travel", 5000)];
    const spentByCategory = new Map([["Rent", 5000], ["Bills", 5000], ["Food", 10000], ["Travel", 2500]]);
    const forward = run({ allocations, spentByCategory });
    const reversed = run({ allocations: [...allocations].reverse(), spentByCategory });
    expect(forward.categories).toEqual(reversed.categories);
    expect(forward.categories.map((c) => c.category)).toEqual(["Bills", "Food", "Rent", "Travel"]);
  });

  it("uses code-point order, not locale order, for category ties", () => {
    const allocations = [alloc("apple", 100), alloc("Zebra", 100)];
    const result = run({ allocations });
    expect(result.categories.map((c) => c.category)).toEqual(["Zebra", "apple"]);
  });
});

describe("categoryBudgetAnalyzer -- empty inputs", () => {
  it("handles no allocations, an empty Map and zero spend", () => {
    expect(run()).toEqual({
      month: "2026-09",
      writable: true,
      rolloverPolicy: "none",
      asOfDate: MID_SEPTEMBER.toISOString(),
      totals: {
        totalBudgetMinor: null,
        allocatedMinor: 0,
        unallocatedMinor: null,
        overAllocated: false,
        overAllocatedByMinor: 0,
        budgetedSpentMinor: 0,
        unbudgetedSpentMinor: 0,
        totalSpentMinor: 0,
      },
      categories: [],
      unbudgetedCategories: [],
    });
  });

  it("handles omitted optional inputs", () => {
    const result = analyzeCategoryBudgets({ month: "2026-09", now: MID_SEPTEMBER });
    expect(result.categories).toEqual([]);
    expect(result.unbudgetedCategories).toEqual([]);
    expect(result.totals.totalSpentMinor).toBe(0);
    expect(result.writable).toBe(false);
  });

  it("no allocations but a total budget: everything unallocated, all spend unbudgeted", () => {
    const result = run({
      spentByCategory: new Map([["Food", 400]]),
      totalSpentMinor: 400,
      totalBudgetMinor: 10000,
    });
    expect(result.totals).toMatchObject({
      allocatedMinor: 0,
      unallocatedMinor: 10000,
      overAllocated: false,
      budgetedSpentMinor: 0,
      unbudgetedSpentMinor: 400,
    });
    expect(result.unbudgetedCategories).toEqual([{ category: "Food", spentMinor: 400 }]);
  });
});
