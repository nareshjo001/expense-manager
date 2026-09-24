"use strict";

// AI-001-T03/T04 -- integration tests for monthlySummaryService.js's
// generateMonthlySummary(), the single public orchestrator entry point
// that composes the template baseline (T02), the optional LLM path (T03),
// and its numeric-claim validator (T04). Only the LLM boundary
// (monthlySummaryLlmService.generateLlmMonthlySummary) is mocked here --
// AI-001-T04's real validateMonthlySummaryAnswer() runs for real, so this
// suite also verifies the two modules actually compose correctly, not
// just each in isolation.

jest.mock("../sia/monthlySummaryLlmService");
const { generateLlmMonthlySummary } = require("../sia/monthlySummaryLlmService");
const { generateMonthlySummary } = require("../sia/monthlySummaryService");

const fullReport = {
  metadata: { version: 10, reportPeriod: { month: 9, year: 2026 } },
  spending: { hasData: true, largestExpense: null, stability: {} },
  summary: { totalSpent: 45230.5, transactionCount: 62 },
  budgets: { hasData: true, hasBudget: false },
  categories: { monthly: { hasData: false } },
  trends: { hasData: false },
  insights: { weeklyChange: { hasData: false }, categoryPattern: { hasData: false }, stability: { hasData: false } },
  financialHealth: { overall: 70, risk: "Low", signals: [] },
  anomalies: { hasData: false },
  forecast: { hasData: false },
};

afterEach(() => jest.clearAllMocks());

describe("generateMonthlySummary -- allowLlm false (default)", () => {
  test("returns the template baseline and never calls the LLM path", async () => {
    const result = await generateMonthlySummary(fullReport);
    expect(result.isFallback).toBe(true);
    expect(result.source).toBe("template");
    expect(generateLlmMonthlySummary).not.toHaveBeenCalled();
  });
});

describe("generateMonthlySummary -- allowLlm true", () => {
  test("returns the LLM-authored result when it succeeds and passes validation", async () => {
    generateLlmMonthlySummary.mockResolvedValue({
      ok: true,
      narrative: "You spent ₹45230.5 across 62 transactions this month.",
      citedFactIds: ["summary.totalSpent", "summary.transactionCount"],
      provider: "groq",
      model: "llama-3.1-70b",
      latencyMs: 700,
    });

    const result = await generateMonthlySummary(fullReport, { allowLlm: true });
    expect(result.isFallback).toBe(false);
    expect(result.source).toBe("llm");
    expect(result.narrative).toBe("You spent ₹45230.5 across 62 transactions this month.");
    expect(result.provider).toBe("groq");
    expect(result.citedFacts.map((f) => f.factId)).toEqual(["summary.totalSpent", "summary.transactionCount"]);
  });

  test("falls back to the template when the LLM path itself fails", async () => {
    generateLlmMonthlySummary.mockResolvedValue({ ok: false, reasonCode: "PROVIDER_ERROR", provider: "groq" });

    const result = await generateMonthlySummary(fullReport, { allowLlm: true });
    expect(result.isFallback).toBe(true);
    expect(result.source).toBe("template");
    expect(result.llmAttempted).toBe(true);
    expect(result.llmReasonCode).toBe("PROVIDER_ERROR");
  });

  test("falls back to the template when the LLM succeeds but fails AI-001-T04 validation (invented figure)", async () => {
    generateLlmMonthlySummary.mockResolvedValue({
      ok: true,
      narrative: "You spent ₹99999 this month, way over budget!",
      citedFactIds: ["summary.totalSpent"],
      provider: "groq",
      model: "llama-3.1-70b",
      latencyMs: 700,
    });

    const result = await generateMonthlySummary(fullReport, { allowLlm: true });
    expect(result.isFallback).toBe(true);
    expect(result.source).toBe("template");
    expect(result.llmAttempted).toBe(true);
    expect(result.llmReasonCode).toBe("VALIDATION_UNSUPPORTED_MONETARY_FIGURE");
  });

  test("falls back to the template when the LLM cites an unknown/ineligible fact", async () => {
    generateLlmMonthlySummary.mockResolvedValue({
      ok: true,
      narrative: "Your budget looks fine this month.",
      citedFactIds: ["budgets.utilization"], // ineligible: hasBudget is false on fullReport
      provider: "groq",
      model: "llama-3.1-70b",
      latencyMs: 700,
    });

    const result = await generateMonthlySummary(fullReport, { allowLlm: true });
    expect(result.isFallback).toBe(true);
    expect(result.llmReasonCode).toBe("VALIDATION_UNKNOWN_CITED_FACT");
  });

  test("never attempts the LLM path when there is no data at all", async () => {
    const result = await generateMonthlySummary({ spending: { hasData: false } }, { allowLlm: true });
    expect(result.hasData).toBe(false);
    expect(result.source).toBe("template");
    expect(generateLlmMonthlySummary).not.toHaveBeenCalled();
  });
});
