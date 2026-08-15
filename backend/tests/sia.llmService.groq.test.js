// Unit tests for the real Groq provider adapter inside
// backend/sia/llmService.js.
//
// axios is fully mocked BEFORE llmService.js is ever required, in every
// test in this file -- no real HTTP request is possible (Groq's live
// endpoint was already verified separately outside this test suite; no
// test here makes or needs a real network call). backend/sia/config is
// also mocked, the same isolation style as
// tests/sia.llmService.openai.test.js and tests/sia.llmService.gemini.test.js
// (this file's direct siblings -- Groq is the third implemented provider,
// OpenAI's and Gemini's adapters are untouched). Only GROQ_API_KEY is a
// real (test-controlled) environment variable, because llmService.js
// deliberately reads it directly from process.env rather than through the
// shared config module.
"use strict";

const ORIGINAL_GROQ_API_KEY = process.env.GROQ_API_KEY;

function restoreApiKeyEnv() {
  if (ORIGINAL_GROQ_API_KEY === undefined) {
    delete process.env.GROQ_API_KEY;
  } else {
    process.env.GROQ_API_KEY = ORIGINAL_GROQ_API_KEY;
  }
}

afterEach(() => {
  restoreApiKeyEnv();
  jest.resetModules();
});

afterAll(() => {
  restoreApiKeyEnv();
});

const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";

// Loads a brand-new backend/sia/config mock and a brand-new mocked axios
// module, then a brand-new llmService module, for a single test. Returns the
// axios post mock alongside askLlm/LlmProviderError so callers can both
// exercise the service and assert on the exact request axios received.
function loadLlmServiceWithMockedAxios({ configOverrides = {}, axiosPostMock } = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({
    enabled: false,
    provider: "groq",
    timeoutMs: 8000,
    model: "openai/gpt-oss-120b",
    ...configOverrides,
  }));

  const postMock = axiosPostMock || jest.fn();
  jest.doMock("axios", () => ({
    post: postMock,
  }));

  const llmService = require("../sia/llmService");
  return { ...llmService, postMock };
}

// The documented Groq (OpenAI-compatible) Chat Completions response shape:
// choices[0].message.content -- see
// https://console.groq.com/docs/api-reference#chat-create. Live-verified
// separately: HTTP 200, choices[0].message.content === "OK" for
// openai/gpt-oss-120b. This helper never performs that call; it only
// constructs the SAME documented shape for a mocked axios response.
function chatCompletionResponse(content, overrides = {}) {
  return {
    data: {
      id: "chatcmpl-groq-test",
      object: "chat.completion",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      ...overrides,
    },
  };
}

const SINGLE_MESSAGE_RESPONSE = chatCompletionResponse("  Your spending rose 12% this month.  ");

const VALID_REQUEST = {
  systemPrompt: "You are SIA, a read-only financial explainer.",
  context: { summary: { totalSpent: 4200 }, financialHealth: { overall: 61 } },
  question: "Why did my spending change?",
};

describe("backend/sia/llmService -- Groq provider adapter", () => {
  describe("request shape", () => {
    it("posts to the exact Groq chat/completions endpoint", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock.mock.calls[0][0]).toBe(GROQ_CHAT_COMPLETIONS_URL);
    });

    it("sends the Groq key ONLY through the Authorization header, plus Content-Type", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await askLlm(VALID_REQUEST);

      const requestConfig = postMock.mock.calls[0][2];
      expect(requestConfig.headers).toMatchObject({
        Authorization: "Bearer gsk-test-key",
        "Content-Type": "application/json",
      });
      // The key must never appear anywhere else in the request: not the URL,
      // not the body, not a query param.
      expect(postMock.mock.calls[0][0]).not.toContain("gsk-test-key");
      expect(JSON.stringify(postMock.mock.calls[0][1])).not.toContain("gsk-test-key");
    });

    it("uses the centrally configured model (matches the live-verified openai/gpt-oss-120b by default)", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock.mock.calls[0][1].model).toBe("openai/gpt-oss-120b");
    });

    it("uses whatever model is configured, not a hardcoded default", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { model: "llama-3.3-70b-versatile" },
      });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock.mock.calls[0][1].model).toBe("llama-3.3-70b-versatile");
    });

    it("converts systemPrompt, history, and the question+context into valid chat-completion messages", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await askLlm({
        ...VALID_REQUEST,
        history: [
          { role: "user", content: "What was last month's total?" },
          { role: "assistant", content: "Last month you spent 3800." },
        ],
      });

      const body = postMock.mock.calls[0][1];
      expect(Array.isArray(body.messages)).toBe(true);
      expect(body.messages).toHaveLength(4);

      expect(body.messages[0]).toEqual({ role: "system", content: VALID_REQUEST.systemPrompt });

      expect(body.messages[1].role).toBe("user");
      expect(body.messages[1].content).toContain("What was last month's total?");
      expect(body.messages[1].content).toContain("Earlier conversation");

      expect(body.messages[2]).toEqual({ role: "assistant", content: "Last month you spent 3800." });

      expect(body.messages[3].role).toBe("user");
      expect(body.messages[3].content).toContain(VALID_REQUEST.question);
      expect(body.messages[3].content).toContain(JSON.stringify(VALID_REQUEST.context));

      // Every message uses a real chat-completion role.
      for (const message of body.messages) {
        expect(["system", "user", "assistant"]).toContain(message.role);
        expect(typeof message.content).toBe("string");
      }
    });

    it("omits history messages entirely when no history is supplied", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await askLlm(VALID_REQUEST);

      const body = postMock.mock.calls[0][1];
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
    });

    it("does not mutate the supplied context object", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";
      const context = Object.freeze({ summary: Object.freeze({ totalSpent: 4200 }) });

      await expect(askLlm({ ...VALID_REQUEST, context })).resolves.toBeDefined();
    });

    it("bounds the request with config.timeoutMs (SIA_LLM_TIMEOUT_MS), no retry behaviour added", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { timeoutMs: 30000 },
      });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock.mock.calls[0][2].timeout).toBe(30000);
      // Exactly one outbound attempt -- no automatic retry.
      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("successful response extraction", () => {
    it("extracts and trims choices[0].message.content", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      const result = await askLlm(VALID_REQUEST);

      expect(result.answer).toBe("Your spending rose 12% this month.");
      expect(result.model).toBe("openai/gpt-oss-120b");
      expect(typeof result.latencyMs).toBe("number");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("matches the live-verified minimal response (\"OK\")", async () => {
      const postMock = jest.fn().mockResolvedValue(chatCompletionResponse("OK"));
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      const result = await askLlm(VALID_REQUEST);

      expect(result.answer).toBe("OK");
    });

    it("reads only the FIRST choice when multiple are returned", async () => {
      const postMock = jest.fn().mockResolvedValue({
        data: {
          choices: [
            { index: 0, message: { role: "assistant", content: "First answer." } },
            { index: 1, message: { role: "assistant", content: "Second, unused answer." } },
          ],
        },
      });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      const result = await askLlm(VALID_REQUEST);

      expect(result.answer).toBe("First answer.");
      expect(result.answer).not.toContain("Second, unused");
    });
  });

  describe("provider reasoning fields are ignored", () => {
    it("never returns a sibling `reasoning` field on the message, even when the provider includes one", async () => {
      // Some Groq models (openai/gpt-oss-*) return an extra `reasoning`
      // field on the SAME message object as `content`. The adapter must
      // read only `content` -- the reasoning text must never reach the
      // returned answer.
      const postMock = jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Your spending rose 12% this month.",
                reasoning: "SENSITIVE_INTERNAL_REASONING_TRACE: step 1, step 2...",
              },
              finish_reason: "stop",
            },
          ],
        },
      });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      const result = await askLlm(VALID_REQUEST);

      expect(result.answer).toBe("Your spending rose 12% this month.");
      expect(result.answer).not.toContain("SENSITIVE_INTERNAL_REASONING_TRACE");
      expect(Object.keys(result)).toEqual(["answer", "model", "latencyMs"]);
    });

    it("never returns a `reasoning_content` field either", async () => {
      const postMock = jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: "Your spending rose 12% this month.",
                reasoning_content: "SENSITIVE_REASONING_CONTENT_TRACE",
              },
            },
          ],
        },
      });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      const result = await askLlm(VALID_REQUEST);

      expect(result.answer).toBe("Your spending rose 12% this month.");
      expect(result.answer).not.toContain("SENSITIVE_REASONING_CONTENT_TRACE");
    });

    it("a reasoning-only message (no usable content) is rejected as empty output, not silently answered with reasoning text", async () => {
      const postMock = jest.fn().mockResolvedValue({
        data: {
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: null, reasoning: "internal reasoning only" },
            },
          ],
        },
      });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "groq",
      });
    });
  });

  describe("pre-request validation failures", () => {
    it("rejects with MODEL_NOT_CONFIGURED when config.model is missing, and never calls axios", async () => {
      const postMock = jest.fn();
      const { askLlm, LlmProviderError } = loadLlmServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { model: null },
      });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toBeInstanceOf(LlmProviderError);
      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "MODEL_NOT_CONFIGURED",
        provider: "groq",
      });
      expect(postMock).not.toHaveBeenCalled();
    });

    it.each([
      ["missing", undefined],
      ["blank", "   "],
    ])(
      "rejects with PROVIDER_API_KEY_NOT_CONFIGURED when GROQ_API_KEY is %s, and never calls axios",
      async (_label, value) => {
        const postMock = jest.fn();
        const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
        if (value === undefined) {
          delete process.env.GROQ_API_KEY;
        } else {
          process.env.GROQ_API_KEY = value;
        }

        await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
          code: "PROVIDER_API_KEY_NOT_CONFIGURED",
          provider: "groq",
        });
        expect(postMock).not.toHaveBeenCalled();
      }
    );

    it("does NOT fall back to OPENAI_API_KEY or GEMINI_API_KEY when GROQ_API_KEY is absent", async () => {
      const postMock = jest.fn();
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      delete process.env.GROQ_API_KEY;
      const originalOpenAiKey = process.env.OPENAI_API_KEY;
      const originalGeminiKey = process.env.GEMINI_API_KEY;
      process.env.OPENAI_API_KEY = "sk-should-not-be-used";
      process.env.GEMINI_API_KEY = "gm-should-not-be-used";

      try {
        await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
          code: "PROVIDER_API_KEY_NOT_CONFIGURED",
          provider: "groq",
        });
        expect(postMock).not.toHaveBeenCalled();
      } finally {
        if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = originalOpenAiKey;
        if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = originalGeminiKey;
      }
    });
  });

  describe("transport failure normalization", () => {
    it("normalizes an axios timeout (ECONNABORTED) to PROVIDER_TIMEOUT", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED" })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_TIMEOUT",
        provider: "groq",
      });
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    it("normalizes a request-sent-but-no-response network failure to PROVIDER_NETWORK_ERROR", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("connect ECONNREFUSED"), { request: {} })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_NETWORK_ERROR",
        provider: "groq",
      });
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    it("normalizes a Groq 4xx/5xx HTTP response (e.g. non-2xx) to PROVIDER_HTTP_ERROR", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("Request failed with status code 429"), {
          response: { status: 429, data: { error: { message: "rate limit exceeded" } } },
        })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_HTTP_ERROR",
        provider: "groq",
      });
      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("malformed / empty response handling", () => {
    it("rejects a response with no data with PROVIDER_MALFORMED_RESPONSE", async () => {
      const postMock = jest.fn().mockResolvedValue({});
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_MALFORMED_RESPONSE",
        provider: "groq",
      });
    });

    it("rejects a response whose choices is missing/not an array with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue({ data: {} });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "groq",
      });
    });

    it("rejects an empty choices array with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue({ data: { choices: [] } });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "groq",
      });
    });

    it("rejects a choice with a non-string message.content with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue({
        data: { choices: [{ message: { role: "assistant", content: null } }] },
      });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "groq",
      });
    });

    it("rejects a choice with a missing message with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue({ data: { choices: [{}] } });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "groq",
      });
    });

    it("rejects a whitespace-only message.content with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue(chatCompletionResponse("   "));
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "groq",
      });
    });
  });

  describe("no secret / financial-context / raw-provider-message leakage", () => {
    it("never leaks the API key, Authorization header, financial context, question, or raw HTTP body in a thrown error", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("Request failed with status code 401"), {
          response: {
            status: 401,
            data: { error: { message: "Invalid API Key: gsk-test-key" } },
          },
        })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

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
      const serialized = JSON.stringify({
        message: caughtError.message,
        name: caughtError.name,
        code: caughtError.code,
        provider: caughtError.provider,
        stack: caughtError.stack,
      });

      expect(serialized).not.toContain("gsk-test-key");
      expect(serialized).not.toContain("SENSITIVE_SYSTEM_PROMPT_MARKER");
      expect(serialized).not.toContain("SENSITIVE_CONTEXT_MARKER");
      expect(serialized).not.toContain("SENSITIVE_QUESTION_MARKER");
      expect(serialized).not.toContain("424242");
      expect(serialized).not.toContain("Invalid API Key");
      expect(serialized).not.toContain("Bearer");
    });

    it("a successful call never logs anything (console.log is never invoked by llmService itself)", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      try {
        await askLlm(VALID_REQUEST);
        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe("mock integrity", () => {
    it("axios.post is the injected mock, not a real HTTP client -- zero real network calls are possible", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await askLlm(VALID_REQUEST);

      expect(jest.isMockFunction(postMock)).toBe(true);
      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });
});
