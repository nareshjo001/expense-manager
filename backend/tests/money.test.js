// DAT-001-T03 -- backend/utils/money.js: the single source of truth for
// rupees<->paise conversion and rounding (ADR-0003).
"use strict";

const {
  MINOR_UNITS_PER_RUPEE,
  toMinorUnits,
  toRupees,
  roundMoney,
  sumMinor,
  formatMoneyMinor,
  parseAmountInput,
} = require("../utils/money");

describe("toMinorUnits", () => {
  test("converts a plain rupee amount to integer paise", () => {
    expect(toMinorUnits(10)).toBe(1000);
    expect(toMinorUnits(0)).toBe(0);
    expect(toMinorUnits(123.45)).toBe(12345);
  });

  test("rounds half away from zero, per ADR-0003's binding examples", () => {
    expect(toMinorUnits(49.995)).toBe(5000);
    expect(toMinorUnits(-49.995)).toBe(-5000);
  });

  test("is symmetric for positive and negative amounts (not native Math.round's toward-+Infinity tie-break)", () => {
    expect(toMinorUnits(10.005)).toBe(1001);
    expect(toMinorUnits(-10.005)).toBe(-1001);
  });

  test("corrects classic floating-point representation error at the rounding boundary", () => {
    // 2.675 * 100 is 267.49999999999997 in IEEE-754, not 267.5 --
    // Math.round alone would wrongly give 267.
    expect(toMinorUnits(2.675)).toBe(268);
  });

  test("throws on a non-finite input", () => {
    expect(() => toMinorUnits(NaN)).toThrow(TypeError);
    expect(() => toMinorUnits(Infinity)).toThrow(TypeError);
    expect(() => toMinorUnits("10")).toThrow(TypeError);
    expect(() => toMinorUnits(null)).toThrow(TypeError);
  });
});

describe("toRupees", () => {
  test("converts integer paise back to a rupee Number", () => {
    expect(toRupees(1000)).toBe(10);
    expect(toRupees(12345)).toBe(123.45);
    expect(toRupees(0)).toBe(0);
    expect(toRupees(-5000)).toBe(-50);
  });

  test("throws on a non-finite input", () => {
    expect(() => toRupees(NaN)).toThrow(TypeError);
  });
});

describe("roundMoney", () => {
  test("matches the 13 duplicated round-to-2dp helpers' contract: rupee Number in, rounded rupee Number out", () => {
    expect(roundMoney(19.995)).toBe(20);
    expect(roundMoney(19.994)).toBe(19.99);
    expect(roundMoney(-19.995)).toBe(-20);
    expect(roundMoney(0)).toBe(0);
  });

  test("agrees with the existing Number(value.toFixed(2)) helper on ordinary values", () => {
    const legacyRound2 = (value) => Number(Number(value).toFixed(2));
    const samples = [12.3456, 0.005, 99.999, 1000000.005, 3.14159];
    for (const sample of samples) {
      expect(roundMoney(sample)).toBeCloseTo(legacyRound2(sample), 2);
    }
  });
});

describe("sumMinor", () => {
  test("sums integer paise exactly, avoiding float drift a rupee-float sum would risk", () => {
    const values = Array(10).fill(toMinorUnits(0.1));
    expect(sumMinor(values)).toBe(100); // 10 x 0.1 = 1.00 rupee = 100 paise
  });

  test("returns 0 for an empty array", () => {
    expect(sumMinor([])).toBe(0);
  });

  test("throws for a non-array input", () => {
    expect(() => sumMinor(123)).toThrow(TypeError);
  });

  test("throws if any element is not a finite number", () => {
    expect(() => sumMinor([100, "200", 300])).toThrow(TypeError);
    expect(() => sumMinor([100, NaN])).toThrow(TypeError);
  });
});

describe("formatMoneyMinor", () => {
  test("formats integer paise as an INR currency string", () => {
    expect(formatMoneyMinor(123450)).toBe("₹1,234.50");
    expect(formatMoneyMinor(0)).toBe("₹0.00");
  });

  test("formats a negative amount", () => {
    expect(formatMoneyMinor(-50000)).toBe("-₹500.00");
  });
});

describe("parseAmountInput", () => {
  test("accepts a plain numeric string, stripping thousands separators", () => {
    expect(parseAmountInput("1,234.50")).toBe(1234.5);
    expect(parseAmountInput("500")).toBe(500);
    expect(parseAmountInput("0.99")).toBe(0.99);
  });

  test("accepts a finite non-negative number directly", () => {
    expect(parseAmountInput(42)).toBe(42);
    expect(parseAmountInput(0)).toBe(0);
  });

  test("fails closed (returns null) for a malformed OCR match instead of a silent NaN", () => {
    expect(parseAmountInput("12.34.56")).toBeNull();
    expect(parseAmountInput("not a number")).toBeNull();
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput("12-34")).toBeNull();
  });

  test("rejects a negative amount", () => {
    expect(parseAmountInput("-5")).toBeNull();
    expect(parseAmountInput(-5)).toBeNull();
  });

  test("rejects non-finite numbers and non-string/number types", () => {
    expect(parseAmountInput(NaN)).toBeNull();
    expect(parseAmountInput(Infinity)).toBeNull();
    expect(parseAmountInput(null)).toBeNull();
    expect(parseAmountInput(undefined)).toBeNull();
    expect(parseAmountInput({})).toBeNull();
  });
});

describe("MINOR_UNITS_PER_RUPEE", () => {
  test("is 100, matching INR's 2-decimal-digit minor unit", () => {
    expect(MINOR_UNITS_PER_RUPEE).toBe(100);
  });
});
