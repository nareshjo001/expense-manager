// Unit tests for backend/sia/factSet.js -- typed, bounded FactSet
// construction and validation.
"use strict";

const { createFactSetBuilder, validateFactSet, findFactById, MAX_FACTS_PER_SET } = require("../sia/factSet");

describe("backend/sia/factSet", () => {
  it("builds a valid fact with a stable, sequential factId", () => {
    const builder = createFactSetBuilder();
    const result = builder.add({
      metric: "EXPENSE_TOTAL",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      periodLabel: "this month",
      value: 4250,
      unit: "INR",
      source: "EXPENSE",
    });
    expect(result.ok).toBe(true);
    expect(result.fact.factId).toBe("fact-1");
    const built = builder.build();
    expect(built.facts).toHaveLength(1);
  });

  it("assigns unique sequential IDs across multiple facts", () => {
    const builder = createFactSetBuilder();
    builder.add({
      metric: "EXPENSE_TOTAL",
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 1000),
      periodLabel: "x",
      value: 1,
      unit: "INR",
      source: "EXPENSE",
    });
    const second = builder.add({
      metric: "INCOME_TOTAL",
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 1000),
      periodLabel: "x",
      value: 2,
      unit: "INR",
      source: "INCOME",
    });
    expect(second.fact.factId).toBe("fact-2");
  });

  it("rejects an invalid metric not in the QueryPlan metric allowlist", () => {
    const builder = createFactSetBuilder();
    const result = builder.add({
      metric: "NOT_A_REAL_METRIC",
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 1000),
      periodLabel: "x",
      value: 1,
      unit: "INR",
      source: "EXPENSE",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("INVALID_METRIC");
  });

  it("accepts a null value only (never NaN/undefined/string) for a genuinely absent metric", () => {
    const builder = createFactSetBuilder();
    const okNull = builder.add({
      metric: "BUDGET_AMOUNT",
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 1000),
      periodLabel: "x",
      value: null,
      unit: "INR",
      source: "BUDGET",
      reasonCode: "NO_BUDGET_CONFIGURED",
    });
    expect(okNull.ok).toBe(true);

    const badNaN = builder.add({
      metric: "BUDGET_AMOUNT",
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 1000),
      periodLabel: "x",
      value: NaN,
      unit: "INR",
      source: "BUDGET",
    });
    expect(badNaN.ok).toBe(false);
  });

  it("enforces the bounded max-facts-per-set cap", () => {
    const builder = createFactSetBuilder();
    for (let i = 0; i < MAX_FACTS_PER_SET; i++) {
      const result = builder.add({
        metric: "EXPENSE_TOTAL",
        periodStart: new Date(),
        periodEnd: new Date(Date.now() + 1000),
        periodLabel: "x",
        value: i,
        unit: "INR",
        source: "EXPENSE",
      });
      expect(result.ok).toBe(true);
    }
    const overflow = builder.add({
      metric: "EXPENSE_TOTAL",
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 1000),
      periodLabel: "x",
      value: 1,
      unit: "INR",
      source: "EXPENSE",
    });
    expect(overflow.ok).toBe(false);
    expect(overflow.reason).toBe("FACT_SET_FULL");
  });

  it("validateFactSet accepts a well-formed set and rejects a malformed one", () => {
    const builder = createFactSetBuilder();
    builder.add({
      metric: "EXPENSE_TOTAL",
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 1000),
      periodLabel: "x",
      value: 1,
      unit: "INR",
      source: "EXPENSE",
    });
    const built = builder.build();
    expect(validateFactSet(built).valid).toBe(true);
    expect(validateFactSet({ facts: [{ factId: "a" }] }).valid).toBe(false);
    expect(validateFactSet(null).valid).toBe(false);
  });

  it("findFactById returns the matching fact or null", () => {
    const builder = createFactSetBuilder();
    builder.add({
      metric: "EXPENSE_TOTAL",
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 1000),
      periodLabel: "x",
      value: 1,
      unit: "INR",
      source: "EXPENSE",
    });
    const built = builder.build();
    expect(findFactById(built, "fact-1")).not.toBeNull();
    expect(findFactById(built, "fact-999")).toBeNull();
  });
});
