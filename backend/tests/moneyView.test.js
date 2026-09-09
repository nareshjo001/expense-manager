// DAT-001-T06 -- the API-side minor-unit serializer.
"use strict";

const { toMinorOrNull, withMinorFields, withMinorFieldsAll } = require("../utils/moneyView");

describe("toMinorOrNull", () => {
  test("converts rupees to integer paise", () => {
    expect(toMinorOrNull(40.3)).toBe(4030);
    expect(toMinorOrNull(0)).toBe(0);
  });

  test("rounds half away from zero, matching ADR-0003", () => {
    expect(toMinorOrNull(49.995)).toBe(5000);
    expect(toMinorOrNull(-49.995)).toBe(-5000);
  });

  test("returns null -- not 0 -- for a missing amount", () => {
    // Zero is a real balance. A serializer deciding that "absent" means
    // "zero" would make a client render ₹0.00 and state something false.
    expect(toMinorOrNull(undefined)).toBeNull();
    expect(toMinorOrNull(null)).toBeNull();
    expect(toMinorOrNull(NaN)).toBeNull();
    expect(toMinorOrNull("40.30")).toBeNull();
  });

  test("never throws on hostile input", () => {
    expect(() => toMinorOrNull(Infinity)).not.toThrow();
    expect(toMinorOrNull(Infinity)).toBeNull();
  });
});

describe("withMinorFields", () => {
  test("adds a derived <field>Minor sibling without altering the original field", () => {
    const doc = { _id: "x", expenseAmount: 40.3, expenseName: "Coffee" };
    const out = withMinorFields(doc, ["expenseAmount"]);

    // Additive: the legacy field keeps its name, type and value, so an
    // existing consumer is unaffected.
    expect(out.expenseAmount).toBe(40.3);
    expect(out.expenseAmountMinor).toBe(4030);
    expect(out.expenseName).toBe("Coffee");
  });

  test("does not mutate the source document", () => {
    // These are frequently lean() documents or cached report payloads that
    // other code still holds a reference to.
    const doc = { expenseAmount: 10 };
    withMinorFields(doc, ["expenseAmount"]);
    expect(doc.expenseAmountMinor).toBeUndefined();
  });

  test("emits null for a document missing the money field", () => {
    const out = withMinorFields({ _id: "x" }, ["expenseAmount"]);
    expect(out.expenseAmountMinor).toBeNull();
  });

  test("is derived from the legacy float, not from a stored shadow field", () => {
    // MONEY_MINOR_DUAL_WRITE_ENABLED defaults to false, so a stored
    // expenseAmountMinor may be absent or stale. The derived value must win,
    // or the API would serve a number that disagrees with the amount the
    // same response reports.
    const doc = { expenseAmount: 40.3, expenseAmountMinor: 999999 };
    expect(withMinorFields(doc, ["expenseAmount"]).expenseAmountMinor).toBe(4030);
  });

  test("passes a non-object through unchanged", () => {
    expect(withMinorFields(null, ["expenseAmount"])).toBeNull();
  });
});

describe("withMinorFieldsAll", () => {
  test("maps a list", () => {
    const out = withMinorFieldsAll(
      [{ incomeAmount: 1000 }, { incomeAmount: 0.5 }],
      ["incomeAmount"]
    );
    expect(out.map((o) => o.incomeAmountMinor)).toEqual([100000, 50]);
  });

  test("passes a non-array through unchanged", () => {
    expect(withMinorFieldsAll(undefined, ["incomeAmount"])).toBeUndefined();
  });
});
