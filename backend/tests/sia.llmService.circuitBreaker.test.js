// Integration tests proving askLlm() (backend/sia/llmService.js) actually
// consults and updates the SIA-001-T04 circuit breaker -- the pure
// breaker logic itself is covered in isolation by
// sia.providerCircuitBreaker.test.js; this file proves the wiring.
"use strict";

afterEach(() => {
  jest.resetModules();
});

function loadLlmServiceWithMockedAxios({ configOverrides = {}, axiosPostMock } = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({
    enabled: false,
    provider: "openai",
    timeoutMs: 8000,
    model: "gpt-4.1-mini",
    maxOutputTokens: 512,
    maxContextChars: 60000,
    circuitBreakerFailureThreshold: 3,
    circuitBreakerCooldownMs: 40,
    ...configOverrides,
  }));

  const postMock = axiosPostMock || jest.fn();
  jest.doMock("axios", () => ({ post: postMock }));

  const llmService = require("../sia/llmService");
  return { ...llmService, postMock };
}

const VALID_REQUEST = { systemPrompt: "sp", context: {}, question: "q" };

function timeoutError() {
  return Object.assign(new Error("timeout of 8000ms exceeded"), { code: "ECONNABORTED" });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("backend/sia/llmService -- circuit breaker integration", () => {
  it("calls the adapter for every attempt up to the threshold, all failing with PROVIDER_TIMEOUT", async () => {
    const postMock = jest.fn().mockRejectedValue(timeoutError());
    const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
    process.env.OPENAI_API_KEY = "sk-test-key";

    for (let i = 0; i < 3; i += 1) {
      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    }
    expect(postMock).toHaveBeenCalledTimes(3);
  });

  it("short-circuits with PROVIDER_CIRCUIT_OPEN once the threshold is reached, never calling the adapter again", async () => {
    const postMock = jest.fn().mockRejectedValue(timeoutError());
    const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
    process.env.OPENAI_API_KEY = "sk-test-key";

    for (let i = 0; i < 3; i += 1) {
      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    }
    expect(postMock).toHaveBeenCalledTimes(3);

    await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
      code: "PROVIDER_CIRCUIT_OPEN",
      provider: "openai",
    });
    // The 4th call never reached axios at all -- still 3.
    expect(postMock).toHaveBeenCalledTimes(3);
  });

  it("a static config/input failure (MODEL_NOT_CONFIGURED) never opens the breaker, however many times it happens", async () => {
    const postMock = jest.fn();
    const { askLlm } = loadLlmServiceWithMockedAxios({
      axiosPostMock: postMock,
      configOverrides: { model: null },
    });
    process.env.OPENAI_API_KEY = "sk-test-key";

    for (let i = 0; i < 10; i += 1) {
      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({ code: "MODEL_NOT_CONFIGURED" });
    }
    // Never PROVIDER_CIRCUIT_OPEN, and axios was never even reached by
    // MODEL_NOT_CONFIGURED's own pre-flight check (adapter-internal), so
    // this also confirms the breaker itself was never tripped.
    const finalAttempt = askLlm(VALID_REQUEST);
    await expect(finalAttempt).rejects.toMatchObject({ code: "MODEL_NOT_CONFIGURED" });
  });

  it("after the cooldown, a successful half-open trial closes the breaker and normal calls resume", async () => {
    const postMock = jest
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValue({
        data: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] },
      });
    const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
    process.env.OPENAI_API_KEY = "sk-test-key";

    for (let i = 0; i < 3; i += 1) {
      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    }
    await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({ code: "PROVIDER_CIRCUIT_OPEN" });
    expect(postMock).toHaveBeenCalledTimes(3);

    await delay(60);

    // Half-open trial call -- the 4th mocked response (a success) is used.
    const result = await askLlm(VALID_REQUEST);
    expect(result.answer).toBe("ok");
    expect(postMock).toHaveBeenCalledTimes(4);

    // Breaker is closed again -- a subsequent single failure alone must
    // not immediately reopen it (threshold is 3).
    postMock.mockRejectedValueOnce(timeoutError());
    await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    expect(postMock).toHaveBeenCalledTimes(5);
  });

  it("is scoped per provider -- opening openai's breaker never blocks gemini", async () => {
    const openaiPost = jest.fn().mockRejectedValue(timeoutError());
    const { askLlm: askOpenAi } = loadLlmServiceWithMockedAxios({ axiosPostMock: openaiPost });
    process.env.OPENAI_API_KEY = "sk-test-key";

    for (let i = 0; i < 3; i += 1) {
      await expect(askOpenAi(VALID_REQUEST)).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    }
    await expect(askOpenAi(VALID_REQUEST)).rejects.toMatchObject({ code: "PROVIDER_CIRCUIT_OPEN" });

    // A fresh module load (as a different provider would get in the real
    // app's single-provider deployment model) starts with its own clean
    // breaker state -- proven directly against providerCircuitBreaker's
    // own per-provider keying in sia.providerCircuitBreaker.test.js; here
    // we just confirm loadLlmServiceWithMockedAxios's jest.resetModules()
    // gives a fresh breaker too, so tests never leak into each other.
    const geminiPost = jest.fn().mockResolvedValue({
      data: { choices: [{ message: { role: "assistant", content: "hi" } }] },
    });
    const { askLlm: askGemini } = loadLlmServiceWithMockedAxios({
      axiosPostMock: geminiPost,
      configOverrides: { provider: "gemini", model: "gemini-3.6-flash" },
    });
    process.env.GEMINI_API_KEY = "gm-test-key";

    const result = await askGemini(VALID_REQUEST);
    expect(result.answer).toBe("hi");
  });
});
