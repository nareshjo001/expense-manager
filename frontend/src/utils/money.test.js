// DAT-001-T06 -- the frontend money formatter.
//
// Every case below was previously reachable in the UI, because amounts were
// interpolated raw from floating-point fields with no formatter at all.
import { formatMoney, formatMoneyApprox, formatMinor, formatAmount } from "./money";

describe("formatMoney", () => {
  test("prefers the exact minor-unit value over the legacy float", () => {
    // The float has already drifted; the integer has not. This preference is
    // the whole point of the switch. 4030 paise is ₹40.30.
    expect(formatMoney(40.300000000000004, 4030)).toBe("₹40.30");
  });

  test("formats a minor-unit amount with grouping and exactly two decimals", () => {
    expect(formatMinor(123456)).toBe("₹1,234.56");
    expect(formatMinor(4030)).toBe("₹40.30");
  });

  test("renders a legacy float with two decimals, not its raw form", () => {
    // Previously rendered "₹1234.5".
    expect(formatMoney(1234.5)).toBe("₹1,234.50");
  });

  test("does not leak floating-point error into the display", () => {
    // Previously rendered "₹40.300000000000004".
    expect(formatMoney(40.1 + 0.2 + 0.000000000000004)).toBe("₹40.30");
  });

  test("rounds half away from zero, matching ADR-0003", () => {
    // Math.round alone rounds -0.5 toward +Infinity, giving ₹-49.99.
    expect(formatMoney(49.995)).toBe("₹50.00");
    expect(formatMoney(-49.995)).toBe("-₹50.00");
  });

  test("a missing amount renders a placeholder, never ₹NaN or ₹undefined", () => {
    // All three were previously displayable, and each looks like a real
    // balance of nothing rather than like missing data.
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(NaN)).toBe("—");
  });

  test("zero is a real amount and is not treated as missing", () => {
    expect(formatMoney(0)).toBe("₹0.00");
    expect(formatMoney(undefined, 0)).toBe("₹0.00");
  });

  test("falls back to the float when no minor value is supplied", () => {
    // Keeps every not-yet-migrated API response rendering correctly, which
    // is what lets the backend and frontend switch land together.
    expect(formatMoney(99.9, undefined)).toBe("₹99.90");
  });
});

describe("formatMoneyApprox", () => {
  test("whole rupees with grouping, for prose and chart axes", () => {
    expect(formatMoneyApprox(1234.56)).toBe("₹1,235");
    expect(formatMoneyApprox(undefined, 123456)).toBe("₹1,235");
  });

  test("a missing amount is zero here, since it renders inside a sentence", () => {
    expect(formatMoneyApprox(undefined)).toBe("₹0");
  });

  test("rounds through the same path as formatMoney", () => {
    // The two formatters must never disagree about the same input; that
    // disagreement is what having per-component copies used to allow.
    expect(formatMoneyApprox(49.995)).toBe("₹50");
    expect(formatMoney(49.995)).toBe("₹50.00");
  });
});

describe("formatAmount", () => {
  test("returns the number without the currency symbol", () => {
    expect(formatAmount(1234.5)).toBe("1,234.50");
  });

  test("still guards a missing value", () => {
    expect(formatAmount(null)).toBe("—");
  });
});
