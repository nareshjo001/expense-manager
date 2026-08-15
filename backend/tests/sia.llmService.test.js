// Unit tests for backend/sia/llmService.js.
//
// backend/sia/config.js is fully mocked -- these tests never depend on real
// process.env state. No network, MongoDB, Redis, ML service, or real
// provider call is ever made; this stub cannot make one anyway (see
// llmService.js). Follows the same module-reset isolation style as
// tests/sia.config.test.js and tests/sia.contextBuilder.test.js: each test
// loads a fresh module registry and a fresh config mock, so no mock state
// leaks between tests.
"use strict";

// Loads a brand-new backend/sia/config mock and a brand-new llmService
// module for a single test.
function loadLlmService(configOverrides = {}) {
  jest.resetModules();
  jest.doMock("../sia/config", () => ({
    enabled: false,
    provider: null,
    timeoutMs: 8000,
    ...configOverrides,
  }));
  return require("../sia/llmService");
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

afterEach(() => {
  jest.resetModules();
});

describe("backend/sia/llmService", () => {
  it("exports askLlm and LlmProviderError", () => {
    const { askLlm, LlmProviderError } = loadLlmService();

    expect(typeof askLlm).toBe("function");
    expect(typeof LlmProviderError).toBe("function");
  });

  it("LlmProviderError extends Error", () => {
    const { LlmProviderError } = loadLlmService();
    const err = new LlmProviderError("test message", { code: "PROVIDER_NOT_CONFIGURED", provider: null });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LlmProviderError);
    expect(err.name).toBe("LlmProviderError");
    expect(typeof err.stack).toBe("string");
  });

  it("rejects with LlmProviderError when no provider is configured", async () => {
    const { askLlm, LlmProviderError } = loadLlmService({ provider: null });

    await expect(
      askLlm({ systemPrompt: "sp", context: {}, question: "q" })
    ).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('missing provider uses code "PROVIDER_NOT_CONFIGURED"', async () => {
    const { askLlm } = loadLlmService({ provider: null });

    await expect(askLlm({ systemPrompt: "sp", context: {}, question: "q" })).rejects.toMatchObject({
      code: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("missing provider exposes provider: null", async () => {
    const { askLlm } = loadLlmService({ provider: null });

    await expect(askLlm({ systemPrompt: "sp", context: {}, question: "q" })).rejects.toMatchObject({
      provider: null,
    });
  });

  it("a blank provider (defensive: bypassing config.js's own normalization) follows the same not-configured behaviour", async () => {
    const blankValues = ["", "   "];
    for (const blank of blankValues) {
      const { askLlm } = loadLlmService({ provider: blank });

      await expect(askLlm({ systemPrompt: "sp", context: {}, question: "q" })).rejects.toMatchObject({
        code: "PROVIDER_NOT_CONFIGURED",
        provider: null,
      });
    }
  });

  it("rejects with LlmProviderError when a provider is configured but unimplemented", async () => {
    const { askLlm, LlmProviderError } = loadLlmService({ provider: "azure-openai" });

    await expect(
      askLlm({ systemPrompt: "sp", context: {}, question: "q" })
    ).rejects.toBeInstanceOf(LlmProviderError);
  });

  it('a configured, unimplemented provider uses code "PROVIDER_NOT_IMPLEMENTED"', async () => {
    const { askLlm } = loadLlmService({ provider: "azure-openai" });

    await expect(askLlm({ systemPrompt: "sp", context: {}, question: "q" })).rejects.toMatchObject({
      code: "PROVIDER_NOT_IMPLEMENTED",
    });
  });

  it('the normalized "openai" provider no longer uses code "PROVIDER_NOT_IMPLEMENTED" (real M1-3 adapter exists)', async () => {
    const { askLlm } = loadLlmService({ provider: "openai" });

    await expect(askLlm({ systemPrompt: "sp", context: {}, question: "q" })).rejects.not.toMatchObject({
      code: "PROVIDER_NOT_IMPLEMENTED",
    });
  });

  it("preserves the configured provider name in error.provider", async () => {
    const { askLlm } = loadLlmService({ provider: "anthropic" });

    await expect(askLlm({ systemPrompt: "sp", context: {}, question: "q" })).rejects.toMatchObject({
      provider: "anthropic",
    });
  });

  it("trims the configured provider name when preserving it (defensive normalization)", async () => {
    const { askLlm } = loadLlmService({ provider: "  gemini  " });

    await expect(askLlm({ systemPrompt: "sp", context: {}, question: "q" })).rejects.toMatchObject({
      provider: "gemini",
    });
  });

  it("never returns a fabricated success value for any provider state", async () => {
    for (const providerValue of [null, "openai", "anthropic", "gemini", "groq"]) {
      const { askLlm } = loadLlmService({ provider: providerValue });
      let resolvedValue;
      let rejected = false;
      try {
        resolvedValue = await askLlm({ systemPrompt: "sp", context: {}, question: "q" });
      } catch (err) {
        rejected = true;
      }
      expect(rejected).toBe(true);
      expect(resolvedValue).toBeUndefined();
    }
  });

  it("the failure is a Promise rejection, not a synchronous call-site exception", () => {
    const { askLlm } = loadLlmService({ provider: null });

    let thrownSynchronously = false;
    let returnValue;
    try {
      returnValue = askLlm({ systemPrompt: "sp", context: {}, question: "q" });
    } catch (err) {
      thrownSynchronously = true;
    }

    expect(thrownSynchronously).toBe(false);
    expect(returnValue).toBeInstanceOf(Promise);
    // Attach a catch handler so the rejection doesn't surface as an
    // unhandled rejection in the test run.
    return returnValue.catch(() => {});
  });

  it("does not mutate the supplied request object or nested context", async () => {
    const { askLlm } = loadLlmService({ provider: "openai" });
    const request = deepFreeze({
      systemPrompt: "system prompt text",
      context: { summary: { totalSpent: 100 }, financialHealth: { overall: 50 } },
      question: "why did my spending change?",
    });

    // Object.freeze + "use strict" in llmService.js means any attempted
    // mutation of `request` or its nested `context` throws instead of
    // silently succeeding, which would otherwise surface as a rejection
    // this test doesn't expect (LlmProviderError specifically).
    await expect(askLlm(request)).rejects.toBeInstanceOf(require("../sia/llmService").LlmProviderError);
  });

  it("error messages never contain the system prompt, question, or serialized financial context", async () => {
    const { askLlm } = loadLlmService({ provider: "openai" });
    const sensitiveRequest = {
      systemPrompt: "SENSITIVE_SYSTEM_PROMPT_MARKER",
      context: { summary: { totalSpent: 424242 }, marker: "SENSITIVE_CONTEXT_MARKER" },
      question: "SENSITIVE_QUESTION_MARKER",
    };

    let caughtError;
    try {
      await askLlm(sensitiveRequest);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeDefined();
    const serializedError = JSON.stringify({
      message: caughtError.message,
      name: caughtError.name,
      code: caughtError.code,
      provider: caughtError.provider,
      stack: caughtError.stack,
    });

    expect(serializedError).not.toContain("SENSITIVE_SYSTEM_PROMPT_MARKER");
    expect(serializedError).not.toContain("SENSITIVE_CONTEXT_MARKER");
    expect(serializedError).not.toContain("SENSITIVE_QUESTION_MARKER");
    expect(serializedError).not.toContain("424242");
  });

  it("does not implicitly recognize any specific provider name as supported (openai, gemini, and groq are the only implemented adapters)", async () => {
    // "gemini" and "groq" intentionally excluded from this list -- both are
    // now real implemented adapters (see tests/sia.llmService.gemini.test.js
    // and tests/sia.llmService.groq.test.js), so neither belongs among the
    // deliberately-unsupported names asserted here. "OpenAI"/"Gemini"/"Groq"
    // (capitalized) stay in this list: normalization trims whitespace but
    // never case-folds, so these remain explicit unsupported names distinct
    // from the real lowercase provider identifiers.
    const candidateProviders = [
      "anthropic",
      "azure-openai",
      "some-future-provider",
      "OpenAI",
      "Gemini",
      "Groq",
    ];

    for (const providerName of candidateProviders) {
      const { askLlm } = loadLlmService({ provider: providerName });

      await expect(askLlm({ systemPrompt: "sp", context: {}, question: "q" })).rejects.toMatchObject({
        code: "PROVIDER_NOT_IMPLEMENTED",
        provider: providerName,
      });
    }
  });

  it('the normalized "gemini" provider no longer uses code "PROVIDER_NOT_IMPLEMENTED" (real Gemini adapter exists)', async () => {
    const { askLlm } = loadLlmService({ provider: "gemini" });

    await expect(askLlm({ systemPrompt: "sp", context: {}, question: "q" })).rejects.not.toMatchObject({
      code: "PROVIDER_NOT_IMPLEMENTED",
    });
  });

  it('the normalized "groq" provider no longer uses code "PROVIDER_NOT_IMPLEMENTED" (real Groq adapter exists)', async () => {
    const { askLlm } = loadLlmService({ provider: "groq" });

    await expect(askLlm({ systemPrompt: "sp", context: {}, question: "q" })).rejects.not.toMatchObject({
      code: "PROVIDER_NOT_IMPLEMENTED",
    });
  });
});
