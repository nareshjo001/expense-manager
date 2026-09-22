"use strict";

// ADR-0008-T05/T06 -- utils/aggregationHelpers.js's sumByField, the shared
// primitive extracted to remove the sum-an-array-of-records duplication
// across insightsCard.js, insightsHeader.js and chart.service.js.
const { sumByField } = require("../utils/aggregationHelpers");

describe("sumByField", () => {
  it("sums a numeric field across an array of records", () => {
    const records = [{ expenseAmount: 10 }, { expenseAmount: 25.5 }, { expenseAmount: 4.5 }];
    expect(sumByField(records, "expenseAmount")).toBe(40);
  });

  it("works for a different field name (incomeAmount), matching insightsCard/Header usage", () => {
    const records = [{ incomeAmount: 1000 }, { incomeAmount: 250 }];
    expect(sumByField(records, "incomeAmount")).toBe(1250);
  });

  it("returns 0 for an empty array", () => {
    expect(sumByField([], "expenseAmount")).toBe(0);
  });

  it("returns 0 when records is undefined or null, matching a safe default", () => {
    expect(sumByField(undefined, "expenseAmount")).toBe(0);
    expect(sumByField(null, "expenseAmount")).toBe(0);
  });

  it("degrades to NaN on a missing field, matching the pre-migration behavior of every call site", () => {
    // insightsCard.js/insightsHeader.js did `sum + record.incomeAmount`
    // un-coerced (undefined + number = NaN); chart.service.js did
    // `sum + Number(exp.expenseAmount)` (Number(undefined) = NaN too).
    // Both pre-existing behaviors are NaN-on-missing-field, so this helper
    // must be too -- silently treating a missing field as 0 would be a
    // silent behavior change for every migrated call site.
    const records = [{ expenseAmount: 10 }, {}];
    expect(sumByField(records, "expenseAmount")).toBeNaN();
  });

  it("coerces numeric-string field values the same way chart.service.js's Number() cast already did", () => {
    const records = [{ expenseAmount: "10" }, { expenseAmount: "5" }];
    expect(sumByField(records, "expenseAmount")).toBe(15);
  });

  it("tolerates a null entry in the array without throwing, treating it as contributing 0", () => {
    // The `record && record[fieldName]` guard exists specifically so a null
    // array entry doesn't throw on property access; it degrades that one
    // entry to 0 rather than NaN, which is stricter (never throws) than any
    // of the three original un-guarded call sites, none of which handled a
    // null array entry at all.
    const records = [{ expenseAmount: 10 }, null];
    expect(sumByField(records, "expenseAmount")).toBe(10);
  });
});
