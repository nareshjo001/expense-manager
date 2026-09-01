// Unit tests for backend/sia/responseValidator.js's additive
"use strict";

const { validateCitedAnswer, MAX_ANSWER_LENGTH } = require("../sia/responseValidator");

function factSet(facts) {
  return { facts };
}

const expenseTotalFact = {
  factId: "fact-1",
  metric: "EXPENSE_TOTAL",
  periodStart: "2026-08-01T00:00:00.000Z",
  periodEnd: "2026-09-01T00:00:00.000Z",
  periodLabel: "this month",
  value: 4250,
  unit: "INR",
  source: "EXPENSE",
  isEstimate: false,
};

const forecastFact = {
  factId: "fact-1",
  metric: "SPENDING_FORECAST_EXPLANATION",
  periodStart: "2026-09-01T00:00:00.000Z",
  periodEnd: "2026-10-01T00:00:00.000Z",
  periodLabel: "next month",
  value: 5000,
  unit: "INR",
  source: "DERIVED",
  isEstimate: true,
};

describe("backend/sia/responseValidator -- validateCitedAnswer", () => {
  it("rejects an oversized cited answer before claim parsing", () => {
    const result = validateCitedAnswer({
      answer: "x".repeat(MAX_ANSWER_LENGTH + 1),
      citedFactIds: [],
      factSet: factSet([expenseTotalFact]),
      plan: { operation: "LOOKUP", metrics: ["EXPENSE_TOTAL"] },
    });

    expect(result).toEqual({ valid: false, reasonCode: "ANSWER_TOO_LONG" });
  });

  it("accepts a valid citation whose claimed amount matches the cited fact's value", () => {
    const result = validateCitedAnswer({
      answer: "You spent ₹4250 this month.",
      citedFactIds: ["fact-1"],
      factSet: factSet([expenseTotalFact]),
      plan: { operation: "LOOKUP", metrics: ["EXPENSE_TOTAL"] },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an invented amount not present in any cited fact", () => {
    const result = validateCitedAnswer({
      answer: "You spent ₹99999 this month.",
      citedFactIds: ["fact-1"],
      factSet: factSet([expenseTotalFact]),
      plan: { operation: "LOOKUP", metrics: ["EXPENSE_TOTAL"] },
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("UNSUPPORTED_MONETARY_FIGURE");
  });

  it("rejects a comparison claim injected into a plain EXPENSE_TOTAL lookup answer", () => {
    const result = validateCitedAnswer({
      answer: "You spent ₹4250 this month, which is higher than last month.",
      citedFactIds: ["fact-1"],
      factSet: factSet([expenseTotalFact]),
      plan: { operation: "LOOKUP", metrics: ["EXPENSE_TOTAL"] },
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("UNSUPPORTED_COMPARISON_CLAIM");
  });

  it("accepts a comparison claim when the plan's operation genuinely is COMPARE", () => {
    const result = validateCitedAnswer({
      answer: "You spent ₹4250 this month, which is higher than last month.",
      citedFactIds: ["fact-1"],
      factSet: factSet([expenseTotalFact]),
      plan: { operation: "COMPARE", metrics: ["PERIOD_COMPARISON"] },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts a comparison claim from a v2 query plan only when a query genuinely is COMPARE", () => {
    const result = validateCitedAnswer({
      answer: "You spent ₹4250 this month, which is the same as last month.",
      citedFactIds: ["fact-1"],
      factSet: factSet([expenseTotalFact]),
      plan: {
        version: 2,
        queries: [{ metric: "EXPENSE_TOTAL", operation: "COMPARE" }],
      },
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a forecast claim injected into a non-forecast answer", () => {
    const result = validateCitedAnswer({
      answer: "You spent ₹4250 this month, and you will spend more next month.",
      citedFactIds: ["fact-1"],
      factSet: factSet([expenseTotalFact]),
      plan: { operation: "LOOKUP", metrics: ["EXPENSE_TOTAL"] },
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("UNSUPPORTED_FORECAST_CLAIM");
  });

  it("accepts forecast framing when the plan operation genuinely is FORECAST, but still rejects certainty language", () => {
    const framedAsEstimate = validateCitedAnswer({
      answer: "You are estimated to spend around ₹5000 next month.",
      citedFactIds: ["fact-1"],
      factSet: factSet([forecastFact]),
      plan: { operation: "FORECAST", metrics: ["SPENDING_FORECAST_EXPLANATION"] },
    });
    expect(framedAsEstimate.valid).toBe(true);

    const framedAsCertain = validateCitedAnswer({
      answer: "You will definitely spend ₹5000 next month.",
      citedFactIds: ["fact-1"],
      factSet: factSet([forecastFact]),
      plan: { operation: "FORECAST", metrics: ["SPENDING_FORECAST_EXPLANATION"] },
    });
    expect(framedAsCertain.valid).toBe(false);
    expect(framedAsCertain.reasonCode).toBe("UNSUPPORTED_CERTAINTY_LANGUAGE");
  });

  it("rejects a raw Mongo ObjectId leaked into the answer", () => {
    const result = validateCitedAnswer({
      answer: "Your expense 507f1f77bcf86cd799439011 was ₹4250.",
      citedFactIds: ["fact-1"],
      factSet: factSet([expenseTotalFact]),
      plan: { operation: "LOOKUP", metrics: ["EXPENSE_TOTAL"] },
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("LEAKED_IDENTIFIER");
  });

  it("rejects raw JSON-fragment leakage in the answer", () => {
    const result = validateCitedAnswer({
      answer: 'Here is the data: "totalSpent": 4250',
      citedFactIds: ["fact-1"],
      factSet: factSet([expenseTotalFact]),
      plan: { operation: "LOOKUP", metrics: ["EXPENSE_TOTAL"] },
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("RAW_FIELD_LEAKAGE");
  });

  it("rejects a cited fact ID that does not exist in the FactSet", () => {
    const result = validateCitedAnswer({
      answer: "You spent ₹4250 this month.",
      citedFactIds: ["fact-999"],
      factSet: factSet([expenseTotalFact]),
      plan: { operation: "LOOKUP", metrics: ["EXPENSE_TOTAL"] },
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("UNKNOWN_CITED_FACT");
  });

  it("rejects advice language regardless of metric", () => {
    const result = validateCitedAnswer({
      answer: "You spent ₹4250 this month. You should cut back on dining out.",
      citedFactIds: ["fact-1"],
      factSet: factSet([expenseTotalFact]),
      plan: { operation: "LOOKUP", metrics: ["EXPENSE_TOTAL"] },
    });
    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("OUT_OF_SCOPE_ADVICE");
  });
});
