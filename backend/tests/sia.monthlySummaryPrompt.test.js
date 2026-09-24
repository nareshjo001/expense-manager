"use strict";

// AI-001-T03 -- unit tests for monthlySummaryPrompt.js. Pure function of a
// report object -- no database, no LLM/provider call.

const {
  buildMonthlySummaryPromptRequest,
  buildFactsContext,
  MONTHLY_SUMMARY_SCHEMA,
  STRUCTURED_OUTPUT_NAME,
} = require("../sia/monthlySummaryPrompt");

const fullReport = {
  metadata: { version: 10 },
  spending: {
    hasData: true,
    largestExpense: { expenseAmount: 8000, expenseCategory: "Electronics" },
    stability: { coefficientOfVariation: 0.42 },
  },
  summary: { totalSpent: 45230.5, transactionCount: 62, dailyAverage: 1959.15 },
  budgets: { hasData: true, hasBudget: false },
  categories: { monthly: { hasData: false } },
  trends: { hasData: true, monthlyTrend: { percentageChange: 12.4, isNewSpending: false, direction: "up" } },
  insights: {
    weeklyChange: { hasData: false },
    categoryPattern: { hasData: false },
    stability: { hasData: false },
  },
  financialHealth: { overall: 62, risk: "Medium", signals: [] },
  anomalies: { hasData: false },
  forecast: { hasData: false },
};

describe("buildFactsContext", () => {
  test("only includes currently-eligible facts, each with factId/label/unit/value only", () => {
    const { facts } = buildFactsContext(fullReport);
    expect(facts.length).toBeGreaterThan(0);
    facts.forEach((fact) => {
      expect(Object.keys(fact).sort()).toEqual(["factId", "label", "unit", "value"]);
    });
    expect(facts.some((f) => f.factId === "summary.totalSpent")).toBe(true);
    // budgets.hasBudget is false -- no budget.* fact should ever appear.
    expect(facts.some((f) => f.factId.startsWith("budgets."))).toBe(false);
  });

  test("returns an empty facts array for a report with no spending data", () => {
    const { facts } = buildFactsContext({ spending: { hasData: false } });
    expect(facts).toEqual([]);
  });
});

describe("buildMonthlySummaryPromptRequest", () => {
  const request = buildMonthlySummaryPromptRequest(fullReport);

  test("returns the exact shape askLlm() expects", () => {
    expect(typeof request.systemPrompt).toBe("string");
    expect(request.systemPrompt.length).toBeGreaterThan(0);
    expect(typeof request.question).toBe("string");
    expect(request.context).toHaveProperty("facts");
    expect(request.structuredOutput).toEqual({ name: STRUCTURED_OUTPUT_NAME, schema: MONTHLY_SUMMARY_SCHEMA });
  });

  test("the schema requires narrative (string) and citedFactIds (string[]), nothing else", () => {
    expect(MONTHLY_SUMMARY_SCHEMA.required).toEqual(["narrative", "citedFactIds"]);
    expect(MONTHLY_SUMMARY_SCHEMA.additionalProperties).toBe(false);
    expect(MONTHLY_SUMMARY_SCHEMA.properties.narrative.type).toBe("string");
    expect(MONTHLY_SUMMARY_SCHEMA.properties.citedFactIds.type).toBe("array");
  });

  test("the system prompt tells the model never to invent a number", () => {
    expect(request.systemPrompt.toLowerCase()).toMatch(/never invent/);
  });

  test("the schema is JSON-serializable (a provider must be able to transmit it)", () => {
    expect(() => JSON.stringify(MONTHLY_SUMMARY_SCHEMA)).not.toThrow();
  });
});
