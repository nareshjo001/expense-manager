// BUD-001-T07 -- boundary and normalization tests for
// Services/BudgetServices/categoryBudgetContract.js (invariants I2-I4, I6,
// I10, I14 in docs/budgets/BUD-001-T01-category-budget-invariants.md).
//
// Tests marked "Regression" pin two contract bugs these tests originally
// found (float-tolerance decimal check; status from rounded utilization),
// both fixed in categoryBudgetContract.js.

const contract = require("../Services/BudgetServices/categoryBudgetContract");
const { STATUS_THRESHOLDS, calculateBudgetStatus } = require("../analytics/analyzers/budgetAnalyzer");

const {
  ERROR_CODES,
  ALERT_LEVELS,
  MAX_CATEGORY_LENGTH,
  MAX_AMOUNT_RUPEES,
  WRITABLE_MONTHS_AHEAD,
  ROLLOVER_POLICY,
  CONTRACT_VERSION,
  formatMonth,
  currentMonth,
  parseMonth,
  monthToRange,
  monthDiff,
  isWritableMonth,
  normalizeBudgetCategory,
  parseBudgetAmount,
  utilizationPercent,
  statusFor,
  alertLevelFor,
  statusForMinor,
  alertLevelForMinor,
} = contract;

describe("contract constants", () => {
  it("match the documented invariants", () => {
    expect(CONTRACT_VERSION).toBe(1); // I16
    expect(ROLLOVER_POLICY).toBe("none"); // I11
    expect(MAX_CATEGORY_LENGTH).toBe(50); // I3
    expect(MAX_AMOUNT_RUPEES).toBe(1000000000); // I4
    expect(WRITABLE_MONTHS_AHEAD).toBe(11); // I6
    expect(contract.MAX_CATEGORY_BUDGETS_PER_MONTH).toBe(25); // I5
    expect(ALERT_LEVELS).toEqual({ NONE: 0, CRITICAL: 1, OVERSPENT: 2 }); // I14
  });
});

describe("month helpers", () => {
  it("formatMonth/currentMonth use server-local, zero-padded YYYY-MM", () => {
    expect(formatMonth(new Date(2026, 0, 1))).toBe("2026-01");
    expect(currentMonth(new Date(2026, 8, 30, 23, 59, 59))).toBe("2026-09");
    expect(currentMonth(new Date(2026, 11, 31, 23, 59, 59, 999))).toBe("2026-12");
    expect(currentMonth(new Date(2027, 0, 1, 0, 0, 0))).toBe("2027-01");
  });

  it("monthDiff is b - a in whole months, across years", () => {
    expect(monthDiff("2026-09", "2026-09")).toBe(0);
    expect(monthDiff("2026-09", "2027-08")).toBe(11);
    expect(monthDiff("2026-12", "2027-01")).toBe(1);
    expect(monthDiff("2027-01", "2026-12")).toBe(-1);
  });

  it("monthToRange is [first instant, first instant of next month), rolling over December", () => {
    expect(monthToRange("2026-09")).toEqual({ monthStart: new Date(2026, 8, 1), monthEnd: new Date(2026, 9, 1) });
    expect(monthToRange("2026-12")).toEqual({ monthStart: new Date(2026, 11, 1), monthEnd: new Date(2027, 0, 1) });
  });
});

describe("parseMonth (I2, I6 read range)", () => {
  it.each(["2026-09", "2026-01", "2026-12", "2000-01", "2099-12"])("accepts %s", (raw) => {
    expect(parseMonth(raw)).toEqual({ ok: true, month: raw });
  });

  it("trims surrounding whitespace", () => {
    expect(parseMonth("  2026-09 \n")).toEqual({ ok: true, month: "2026-09" });
  });

  it.each([
    ["2026-13"],
    ["2026-00"],
    ["2026-1"],
    ["2026-9"],
    ["26-09"],
    ["2026/09"],
    ["2026-09-01"],
    ["Sep 2026"],
    ["2026 -09"],
    [""],
    ["   "],
    ["1999-12"],
    ["2100-01"],
  ])("rejects %j", (raw) => {
    expect(parseMonth(raw)).toEqual({ ok: false, reason: ERROR_CODES.INVALID_MONTH });
  });

  it.each([[null], [undefined], [202609], [new Date(2026, 8, 1)], [["2026-09"]], [{ month: "2026-09" }]])(
    "rejects non-string %p",
    (raw) => {
      expect(parseMonth(raw)).toEqual({ ok: false, reason: ERROR_CODES.INVALID_MONTH });
    }
  );
});

describe("isWritableMonth (I6)", () => {
  const now = new Date(2026, 8, 26, 12);

  it.each([
    ["2026-09", true], // current
    ["2026-10", true], // +1
    ["2027-08", true], // +11
    ["2027-09", false], // +12
    ["2026-08", false], // -1
    ["2025-09", false], // -12
  ])("%s -> %s (now = Sep 2026)", (month, expected) => {
    expect(isWritableMonth(month, now)).toBe(expected);
  });

  it("rolls the window over the year boundary (now = last instant of Dec 2026)", () => {
    const decEnd = new Date(2026, 11, 31, 23, 59, 59, 999);
    expect(isWritableMonth("2026-12", decEnd)).toBe(true);
    expect(isWritableMonth("2027-01", decEnd)).toBe(true);
    expect(isWritableMonth("2027-11", decEnd)).toBe(true); // +11
    expect(isWritableMonth("2027-12", decEnd)).toBe(false); // +12
    expect(isWritableMonth("2026-11", decEnd)).toBe(false);
  });

  it("December becomes read-only at the first instant of January", () => {
    const janStart = new Date(2027, 0, 1, 0, 0, 0);
    expect(isWritableMonth("2026-12", janStart)).toBe(false);
    expect(isWritableMonth("2027-01", janStart)).toBe(true);
    expect(isWritableMonth("2027-12", janStart)).toBe(true); // +11
    expect(isWritableMonth("2028-01", janStart)).toBe(false); // +12
  });
});

describe("normalizeBudgetCategory (I2, I3)", () => {
  it.each(["food", "FOOD", "Food", "  food  ", "fOoD", "\tfood\n"])("%j -> Food (same key expenses use)", (raw) => {
    expect(normalizeBudgetCategory(raw)).toEqual({ ok: true, category: "Food" });
  });

  it.each([
    ["medical", "Health"],
    ["Healthcare", "Health"],
    ["utilities", "Bills"],
    ["EMI", "Bills"],
    ["misc", "Others"],
    ["personal   care", "Personal Care"],
    ["PERSONAL CARE", "Personal Care"],
  ])("resolves alias %j -> %s", (raw, expected) => {
    expect(normalizeBudgetCategory(raw)).toEqual({ ok: true, category: expected });
  });

  it.each([
    ["pet supplies", "Pet Supplies"],
    ["  PET   SUPPLIES ", "Pet Supplies"],
    ["side-hustle costs", "Side-Hustle Costs"],
    ["gym", "Gym"],
  ])("title-cases unknown category %j -> %j instead of rejecting it", (raw, expected) => {
    expect(normalizeBudgetCategory(raw)).toEqual({ ok: true, category: expected });
  });

  it.each(["Uncategorized", "uncategorized", "  UNCATEGORIZED  ", "unCATegorized"])(
    "reserves %j (the read-side bucket for invalid legacy data)",
    (raw) => {
      expect(normalizeBudgetCategory(raw)).toEqual({ ok: false, reason: ERROR_CODES.RESERVED_CATEGORY });
    }
  );

  it.each([[""], ["   "], ["\t\n"], [null], [undefined], [42], [{}], [["Food"]], [true]])(
    "rejects %p as INVALID_CATEGORY",
    (raw) => {
      expect(normalizeBudgetCategory(raw)).toEqual({ ok: false, reason: ERROR_CODES.INVALID_CATEGORY });
    }
  );

  it("accepts exactly 50 characters after normalization", () => {
    const result = normalizeBudgetCategory("a".repeat(50));
    expect(result.ok).toBe(true);
    expect(result.category).toHaveLength(50);
  });

  it("rejects 51 characters", () => {
    expect(normalizeBudgetCategory("a".repeat(51))).toEqual({ ok: false, reason: ERROR_CODES.INVALID_CATEGORY });
  });

  it("measures length AFTER normalization (trim + whitespace collapse)", () => {
    expect(normalizeBudgetCategory(`   ${"a".repeat(50)}   `).ok).toBe(true);
    // 25 + 1 + 24 = 50 once the run of spaces collapses to one.
    expect(normalizeBudgetCategory(`${"a".repeat(25)}          ${"b".repeat(24)}`).ok).toBe(true);
    expect(normalizeBudgetCategory(`${"a".repeat(25)}          ${"b".repeat(25)}`).ok).toBe(false);
  });
});

describe("parseBudgetAmount (I4)", () => {
  it.each([
    [0.01, 0.01, 1],
    ["0.01", 0.01, 1],
    [1, 1, 100],
    ["250", 250, 25000],
    ["  250  ", 250, 25000],
    ["1,500.50", 1500.5, 150050],
    ["1,500.500", 1500.5, 150050], // trailing zero: still 2 dp in value
    ["1,00,000", 100000, 10000000], // Indian digit grouping
    [19.99, 19.99, 1999],
    [0.29, 0.29, 29],
    [1.15, 1.15, 115],
    [1e3, 1000, 100000],
    [1e9, 1e9, 1e11],
    ["1000000000", 1e9, 1e11],
    ["1,000,000,000.00", 1e9, 1e11],
    [999999999.99, 999999999.99, 99999999999],
  ])("accepts %p -> %d rupees / %d paise", (raw, amount, amountMinor) => {
    expect(parseBudgetAmount(raw)).toEqual({ ok: true, amount, amountMinor });
  });

  it("treats binary float noise as 2 dp, not a third decimal (0.1 + 0.2)", () => {
    expect(parseBudgetAmount(0.1 + 0.2)).toEqual({ ok: true, amount: 0.3, amountMinor: 30 });
  });

  it.each([[0], ["0"], ["0.00"], ["0,000"]])("rejects zero %p as AMOUNT_OUT_OF_RANGE", (raw) => {
    expect(parseBudgetAmount(raw)).toEqual({ ok: false, reason: ERROR_CODES.AMOUNT_OUT_OF_RANGE });
  });

  it.each([[1e9 + 0.01], ["1000000000.01"], ["1,000,000,000.01"], [1e9 + 1], [1e12]])(
    "rejects %p above 1,000,000,000 as AMOUNT_OUT_OF_RANGE",
    (raw) => {
      expect(parseBudgetAmount(raw)).toEqual({ ok: false, reason: ERROR_CODES.AMOUNT_OUT_OF_RANGE });
    }
  );

  it.each([[1.005], ["1.005"], ["0.001"], [0.001], ["1500.505"], ["1,500.505"]])(
    "rejects 3 decimals %p instead of silently rounding",
    (raw) => {
      expect(parseBudgetAmount(raw)).toEqual({ ok: false, reason: ERROR_CODES.INVALID_AMOUNT });
    }
  );

  it.each([
    [-5],
    ["-5"],
    [-0.01],
    [NaN],
    [Infinity],
    [-Infinity],
    ["Infinity"],
    ["NaN"],
    ["1e3"],
    ["abc"],
    ["12abc"],
    [""],
    ["   "],
    ["₹500"],
    [null],
    [undefined],
    [{}],
    [[500]],
    [true],
  ])("rejects %p as INVALID_AMOUNT", (raw) => {
    expect(parseBudgetAmount(raw)).toEqual({ ok: false, reason: ERROR_CODES.INVALID_AMOUNT });
  });

  // Regression (found by these boundary tests): the "more than 2 decimal
  // places" check used an absolute float tolerance on value * 100, which
  // rejected ~8% of valid 2-dp amounts above ~2^27 rupees. It now counts
  // decimals on the text.
  it.each([["140000001.11"], ["279733020.84"], ["683447490.07"], [279733020.84], ["999999999.99"]])(
    "accepts in-range 2-dp amount %p",
    (raw) => {
      expect(parseBudgetAmount(raw).ok).toBe(true);
    }
  );

  it.each([["279733020.841"], [279733020.841], [1.005], ["0.001"]])("rejects %p (a real third decimal) as INVALID_AMOUNT", (raw) => {
    expect(parseBudgetAmount(raw)).toEqual({ ok: false, reason: ERROR_CODES.INVALID_AMOUNT });
  });
});

describe("utilizationPercent (I10)", () => {
  it.each([
    [0, 10000, 0],
    [7000, 10000, 70],
    [7001, 10000, 70.01],
    [9000, 10000, 90],
    [9001, 10000, 90.01],
    [10000, 10000, 100],
    [10001, 10000, 100.01],
    [1, 3, 33.33],
    [2, 3, 66.67],
    [25000, 10000, 250],
    [1, 1, 100],
  ])("%i / %i -> %d", (spent, amount, expected) => {
    expect(utilizationPercent(spent, amount)).toBe(expected);
  });

  it.each([[0], [-1], [NaN], [Infinity], [null], [undefined]])("returns null for unusable amount %p", (amount) => {
    expect(utilizationPercent(100, amount)).toBeNull();
  });
});

describe("statusFor (I10 -- reuses budgetAnalyzer.STATUS_THRESHOLDS)", () => {
  it.each([
    [-1, "Safe"],
    [0, "Safe"],
    [70, "Safe"],
    [70.01, "Warning"],
    [90, "Warning"],
    [90.01, "Critical"],
    [100, "Critical"],
    [100.01, "Overspent"],
    [1e6, "Overspent"],
  ])("%d -> %s", (utilization, status) => {
    expect(statusFor(utilization)).toBe(status);
  });

  it.each([[null], [undefined], [NaN], [Infinity], ["80"]])("returns null for %p", (utilization) => {
    expect(statusFor(utilization)).toBeNull();
  });

  it("agrees with budgetAnalyzer.calculateBudgetStatus at every tier boundary", () => {
    for (const { max } of STATUS_THRESHOLDS.filter((t) => Number.isFinite(t.max))) {
      for (const utilization of [max, max + 0.01]) {
        expect(statusFor(utilization)).toBe(calculateBudgetStatus({ budget: 100, spent: utilization }).status);
      }
    }
  });

  // Regression (found by these boundary tests): classifying the 2-dp
  // ROUNDED utilization reported spend 1 paisa over a large allocation as
  // "Critical" (it rounds to exactly 100.00%). statusForMinor/
  // alertLevelForMinor classify the exact integer ratio instead and are what
  // the analyzer and alert service use.
  it("statusForMinor: 1 paisa over a large allocation is Overspent", () => {
    expect(statusForMinor(10000001, 10000000)).toBe("Overspent");
    expect(alertLevelForMinor(10000001, 10000000)).toBe(ALERT_LEVELS.OVERSPENT);
    // the display value still rounds -- which is exactly why it must not drive status
    expect(utilizationPercent(10000001, 10000000)).toBe(100);
  });

  it.each([
    [0, 10000, "Safe"],
    [7000, 10000, "Safe"],
    [7001, 10000, "Warning"],
    [9000, 10000, "Warning"],
    [9001, 10000, "Critical"],
    [10000, 10000, "Critical"],
    [10001, 10000, "Overspent"],
    [2, 3, "Safe"],
    [1, 1, "Critical"],
  ])("statusForMinor(%i, %i) -> %s (exact integer boundaries)", (spent, amount, status) => {
    expect(statusForMinor(spent, amount)).toBe(status);
  });

  it.each([[0], [-1], [NaN], [null]])("statusForMinor returns null for unusable amount %p", (amount) => {
    expect(statusForMinor(100, amount)).toBeNull();
  });

  it("statusForMinor agrees with budgetAnalyzer.calculateBudgetStatus (unrounded) near 100%", () => {
    expect(statusForMinor(10000001, 10000000)).toBe(
      calculateBudgetStatus({ budget: 100000, spent: 100000.01 }).status
    );
  });
});

describe("alertLevelFor (I14)", () => {
  it.each([
    [0, ALERT_LEVELS.NONE],
    [70, ALERT_LEVELS.NONE],
    [70.01, ALERT_LEVELS.NONE],
    [90, ALERT_LEVELS.NONE],
    [90.01, ALERT_LEVELS.CRITICAL],
    [100, ALERT_LEVELS.CRITICAL],
    [100.01, ALERT_LEVELS.OVERSPENT],
    [500, ALERT_LEVELS.OVERSPENT],
  ])("%d -> %i", (utilization, level) => {
    expect(alertLevelFor(utilization)).toBe(level);
  });

  it.each([[null], [NaN], [undefined]])("unusable utilization %p -> NONE", (utilization) => {
    expect(alertLevelFor(utilization)).toBe(ALERT_LEVELS.NONE);
  });
});
