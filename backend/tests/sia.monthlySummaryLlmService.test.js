"use strict";

// AI-001-T03 -- unit tests for monthlySummaryLlmService.js. askLlm() is
// mocked (jest.mock) -- this suite never makes a real network/provider
// call, matching this sandbox's no-live-LLM-credentials constraint and
// SIA's own existing test conventions for llmService.js consumers.

jest.mock("../sia/llmService");
const { askLlm, LlmProviderError } = require("../sia/llmService");
const config = require("../sia/config");
const { generateLlmMonthlySummary, isLlmAvailable, isValidStructuredShape } = require("../sia/monthlySummaryLlmService");

const fullReport = {
  metadata: { version: 10 },
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

const savedConfig = { ...config };
afterEach(() => {
  Object.assign(config, savedConfig);
  jest.clearAllMocks();
});

describe("isLlmAvailable", () => {
  test("false when SIA is disabled", () => {
    config.enabled = false;
    config.provider = "groq";
    expect(isLlmAvailable()).toBe(false);
  });

  test("false when no provider is configured", () => {
    config.enabled = true;
    config.provider = null;
    expect(isLlmAvailable()).toBe(false);
  });

  test("true when enabled and a provider is configured", () => {
    config.enabled = true;
    config.provider = "groq";
    expect(isLlmAvailable()).toBe(true);
  });
});

describe("isValidStructuredShape", () => {
  test("accepts a well-formed { narrative, citedFactIds } shape", () => {
    expect(isValidStructuredShape({ narrative: "hi", citedFactIds: ["summary.totalSpent"] })).toBe(true);
  });
  test.each([
    [null],
    [{}],
    [{ narrative: "" , citedFactIds: [] }],
    [{ narrative: "hi", citedFactIds: "not-an-array" }],
    [{ narrative: "hi", citedFactIds: [1, 2] }],
    [{ narrative: 5, citedFactIds: [] }],
  ])("rejects malformed shape %#", (shape) => {
    expect(isValidStructuredShape(shape)).toBe(false);
  });
});

describe("generateLlmMonthlySummary", () => {
  test("returns LLM_NOT_AVAILABLE without calling askLlm when SIA is disabled", async () => {
    config.enabled = false;
    const result = await generateLlmMonthlySummary(fullReport);
    expect(result).toEqual({ ok: false, reasonCode: "LLM_NOT_AVAILABLE" });
    expect(askLlm).not.toHaveBeenCalled();
  });

  test("returns NO_ELIGIBLE_FACTS without calling askLlm when the report has no eligible facts", async () => {
    config.enabled = true;
    config.provider = "groq";
    const result = await generateLlmMonthlySummary({ spending: { hasData: false } });
    expect(result).toEqual({ ok: false, reasonCode: "NO_ELIGIBLE_FACTS" });
    expect(askLlm).not.toHaveBeenCalled();
  });

  test("returns ok:true with the parsed narrative/citedFactIds on a valid structured response", async () => {
    config.enabled = true;
    config.provider = "groq";
    askLlm.mockResolvedValue({
      answer: '{"narrative":"You spent ₹45230.5.","citedFactIds":["summary.totalSpent"]}',
      structuredOutput: { narrative: "You spent ₹45230.5.", citedFactIds: ["summary.totalSpent"] },
      model: "llama-3.1-70b",
      latencyMs: 812,
    });

    const result = await generateLlmMonthlySummary(fullReport);
    expect(result.ok).toBe(true);
    expect(result.narrative).toBe("You spent ₹45230.5.");
    expect(result.citedFactIds).toEqual(["summary.totalSpent"]);
    expect(result.provider).toBe("groq");
    expect(result.model).toBe("llama-3.1-70b");
    expect(result.latencyMs).toBe(812);
  });

  test("normalizes an LlmProviderError into ok:false PROVIDER_ERROR, never rethrows", async () => {
    config.enabled = true;
    config.provider = "groq";
    askLlm.mockRejectedValue(new LlmProviderError("boom", { code: "PROVIDER_HTTP_ERROR", provider: "groq" }));

    const result = await generateLlmMonthlySummary(fullReport);
    expect(result).toEqual({ ok: false, reasonCode: "PROVIDER_ERROR", provider: "groq" });
  });

  test("returns INVALID_STRUCTURED_OUTPUT when the parsed shape doesn't match the schema", async () => {
    config.enabled = true;
    config.provider = "groq";
    askLlm.mockResolvedValue({
      answer: '{"oops": true}',
      structuredOutput: { oops: true },
      model: "llama-3.1-70b",
      latencyMs: 500,
    });

    const result = await generateLlmMonthlySummary(fullReport);
    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe("INVALID_STRUCTURED_OUTPUT");
  });

  test("never throws even on an unexpected non-LlmProviderError rejection", async () => {
    config.enabled = true;
    config.provider = "groq";
    askLlm.mockRejectedValue(new Error("totally unexpected"));

    await expect(generateLlmMonthlySummary(fullReport)).resolves.toEqual(
      expect.objectContaining({ ok: false, reasonCode: "PROVIDER_ERROR" })
    );
  });
});
