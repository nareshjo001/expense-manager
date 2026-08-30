// Unit tests for backend/sia/queryPlan.js -- the closed QueryPlan schema
// and its pure, fail-closed validator.
"use strict";

const { validateQueryPlan, QUERY_PLAN_VERSION } = require("../sia/queryPlan");

const validLookupPlan = () => ({
  version: QUERY_PLAN_VERSION,
  outcome: "supported",
  metrics: ["EXPENSE_TOTAL"],
  operation: "LOOKUP",
  period: { type: "CURRENT_MONTH" },
  grouping: "NONE",
  responseMode: "DETERMINISTIC",
});

describe("backend/sia/queryPlan -- validateQueryPlan", () => {
  it("accepts a minimal valid LOOKUP plan", () => {
    const result = validateQueryPlan(validLookupPlan());
    expect(result.valid).toBe(true);
    expect(result.plan.metrics).toEqual(["EXPENSE_TOTAL"]);
  });

  it("accepts a valid CATEGORY_BREAKDOWN plan with a category filter", () => {
    const plan = {
      ...validLookupPlan(),
      metrics: ["CATEGORY_BREAKDOWN"],
      operation: "BREAKDOWN",
      grouping: "CATEGORY",
      categoryFilter: "Groceries & Food",
    };
    const result = validateQueryPlan(plan);
    expect(result.valid).toBe(true);
    expect(result.plan.categoryFilter).toBe("Groceries & Food");
  });

  it("accepts a valid COMPARE plan with a comparisonPeriod", () => {
    const plan = {
      ...validLookupPlan(),
      metrics: ["PERIOD_COMPARISON"],
      operation: "COMPARE",
      comparisonPeriod: { type: "PREVIOUS_MONTH" },
    };
    const result = validateQueryPlan(plan);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid clarification plan", () => {
    const plan = {
      version: QUERY_PLAN_VERSION,
      outcome: "clarification",
      clarification: {
        reason: "AMBIGUOUS_MONTH",
        prompt: "Which year did you mean for March?",
        options: [
          { id: "2025-03", label: "March 2025" },
          { id: "2026-03", label: "March 2026" },
        ],
      },
    };
    const result = validateQueryPlan(plan);
    expect(result.valid).toBe(true);
  });

  it("accepts a valid unsupported plan", () => {
    const result = validateQueryPlan({ version: QUERY_PLAN_VERSION, outcome: "unsupported" });
    expect(result.valid).toBe(true);
  });

  it("rejects an unknown top-level key", () => {
    const plan = { ...validLookupPlan(), evil: "$where" };
    const result = validateQueryPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/^UNKNOWN_KEY/);
  });

  it("rejects an invalid metric enum value", () => {
    const plan = { ...validLookupPlan(), metrics: ["DELETE_ALL_EXPENSES"] };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("rejects an invalid operation enum value", () => {
    const plan = { ...validLookupPlan(), operation: "MUTATE" };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("rejects an invalid period type", () => {
    const plan = { ...validLookupPlan(), period: { type: "NEXT_DECADE" } };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("rejects an oversized metrics array", () => {
    const plan = {
      ...validLookupPlan(),
      metrics: ["EXPENSE_TOTAL", "EXPENSE_COUNT", "INCOME_TOTAL", "INCOME_COUNT"],
    };
    const result = validateQueryPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("TOO_MANY_METRICS");
  });

  it("rejects a wrong version number", () => {
    const plan = { ...validLookupPlan(), version: 2 };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("rejects a category filter that looks like a Mongo field path or operator", () => {
    for (const evil of ["$where", "userId.$ne", "{ $gt: 0 }", "a.b.c", "..secret"]) {
      const plan = { ...validLookupPlan(), metrics: ["CATEGORY_TOTAL"], categoryFilter: evil };
      const result = validateQueryPlan(plan);
      expect(result.valid).toBe(false);
    }
  });

  it("rejects a category filter longer than the bound", () => {
    const plan = { ...validLookupPlan(), categoryFilter: "x".repeat(200) };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("rejects LAST_N_MONTHS above the 12-month cap", () => {
    const plan = { ...validLookupPlan(), period: { type: "LAST_N_MONTHS", monthsCount: 13 } };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("rejects EXPLICIT_MONTH missing a year", () => {
    const plan = { ...validLookupPlan(), period: { type: "EXPLICIT_MONTH", month: 3 } };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("rejects a clarification plan with more than 5 options", () => {
    const options = Array.from({ length: 6 }, (_, i) => ({ id: `opt-${i}`, label: `Option ${i}` }));
    const plan = {
      version: QUERY_PLAN_VERSION,
      outcome: "clarification",
      clarification: { reason: "TOO_MANY", prompt: "Pick one", options },
    };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("rejects a clarification plan carrying execution fields", () => {
    const plan = {
      version: QUERY_PLAN_VERSION,
      outcome: "clarification",
      clarification: { reason: "X", prompt: "?", options: [{ id: "a", label: "A" }] },
      metrics: ["EXPENSE_TOTAL"],
    };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("rejects a COMPARE plan missing comparisonPeriod", () => {
    const plan = { ...validLookupPlan(), operation: "COMPARE" };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("rejects a plan with an unknown nested period key", () => {
    const plan = { ...validLookupPlan(), period: { type: "CURRENT_MONTH", extra: 1 } };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  it("fails closed for non-object input without throwing", () => {
    for (const bad of [null, undefined, "hello", 42, [], () => {}]) {
      expect(() => validateQueryPlan(bad)).not.toThrow();
      expect(validateQueryPlan(bad).valid).toBe(false);
    }
  });

  it("fails closed for a circular object without throwing", () => {
    const circular = { ...validLookupPlan() };
    circular.self = circular;
    expect(() => validateQueryPlan(circular)).not.toThrow();
    expect(validateQueryPlan(circular).valid).toBe(false);
  });

  it("never lets duplicate metrics through", () => {
    const plan = { ...validLookupPlan(), metrics: ["EXPENSE_TOTAL", "EXPENSE_TOTAL"] };
    expect(validateQueryPlan(plan).valid).toBe(false);
  });

  // Found while diagnosing the semantic-router controller-test failures:
  // FORECAST is only a real capability for SPENDING_FORECAST_EXPLANATION
  // (forecastAnalyzer.js) -- nothing else has a forecasting model. Without
  // this rule a router-proposed plan like "predict my top category next
  // month" (TOP_CATEGORY + FORECAST) would validate and let an LLM author
  // an unsupported category-level prediction.
  describe("FORECAST metric x operation capability contract", () => {
    it("rejects FORECAST paired with a deterministic (non-forecast) metric", () => {
      const plan = {
        ...validLookupPlan(),
        metrics: ["TOP_CATEGORY"],
        operation: "FORECAST",
        responseMode: "PROSE",
      };
      const result = validateQueryPlan(plan);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("UNSUPPORTED_FORECAST_METRIC_COMBINATION");
    });

    it("rejects FORECAST paired with EXPENSE_TOTAL", () => {
      const plan = { ...validLookupPlan(), operation: "FORECAST", responseMode: "PROSE" };
      expect(validateQueryPlan(plan).valid).toBe(false);
    });

    it("accepts FORECAST paired ONLY with SPENDING_FORECAST_EXPLANATION", () => {
      const plan = {
        ...validLookupPlan(),
        metrics: ["SPENDING_FORECAST_EXPLANATION"],
        operation: "FORECAST",
        responseMode: "PROSE",
      };
      const result = validateQueryPlan(plan);
      expect(result.valid).toBe(true);
    });

    it("still accepts non-FORECAST operations for every deterministic metric", () => {
      const plan = { ...validLookupPlan(), metrics: ["TOP_CATEGORY"], operation: "LOOKUP" };
      expect(validateQueryPlan(plan).valid).toBe(true);
    });
  });
});
