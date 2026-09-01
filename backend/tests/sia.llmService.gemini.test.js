// Unit tests for the real Gemini provider adapter inside
"use strict";

const ORIGINAL_GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function restoreApiKeyEnv() {
  if (ORIGINAL_GEMINI_API_KEY === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = ORIGINAL_GEMINI_API_KEY;
  }
}

afterEach(() => {
  restoreApiKeyEnv();
  jest.resetModules();
});

afterAll(() => {
  restoreApiKeyEnv();
});

const GEMINI_CHAT_COMPLETIONS_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

// Loads a brand-new backend/sia/config mock and a brand-new mocked axios
function loadLlmServiceWithMockedAxios({ configOverrides = {}, axiosPostMock } = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({
    enabled: false,
    provider: "gemini",
    timeoutMs: 8000,
    model: "gemini-3.6-flash",
    ...configOverrides,
  }));

  const postMock = axiosPostMock || jest.fn();
  jest.doMock("axios", () => ({
    post: postMock,
  }));

  const llmService = require("../sia/llmService");
  return { ...llmService, postMock };
}

// The documented Gemini (OpenAI-compatible) Chat Completions response shape:
// choices[0].message.content -- see https://ai.google.dev/gemini-api/docs/openai.
function chatCompletionResponse(content, overrides = {}) {
  return {
    data: {
      id: "chatcmpl-test",
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

const STRUCTURED_OUTPUT = {
  name: "sia_query_plan",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { plan: { type: "object" } },
    required: ["plan"],
  },
};
const STRUCTURED_VALUE = { plan: { version: 2, outcome: "unsupported" } };

describe("backend/sia/llmService -- Gemini provider adapter", () => {
  describe("request shape", () => {
    it("posts to the exact Gemini OpenAI-compatible chat/completions endpoint", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock.mock.calls[0][0]).toBe(GEMINI_CHAT_COMPLETIONS_URL);
    });

    it("sends the Gemini key ONLY through the Authorization header, plus Content-Type", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await askLlm(VALID_REQUEST);

      const requestConfig = postMock.mock.calls[0][2];
      expect(requestConfig.headers).toMatchObject({
        Authorization: "Bearer gm-test-key",
        "Content-Type": "application/json",
      });
      // The key must never appear anywhere else in the request: not the URL,
      // not the body, not a query param.
      expect(postMock.mock.calls[0][0]).not.toContain("gm-test-key");
      expect(JSON.stringify(postMock.mock.calls[0][1])).not.toContain("gm-test-key");
    });

    it("uses the centrally configured model", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { model: "gemini-3.6-pro" },
      });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock.mock.calls[0][1].model).toBe("gemini-3.6-pro");
    });

    it("converts systemPrompt, history, and the question+context into valid chat-completion messages", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

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
      process.env.GEMINI_API_KEY = "gm-test-key";

      await askLlm(VALID_REQUEST);

      const body = postMock.mock.calls[0][1];
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[1].role).toBe("user");
    });

    it("does not mutate the supplied context object", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";
      const context = Object.freeze({ summary: Object.freeze({ totalSpent: 4200 }) });

      await expect(askLlm({ ...VALID_REQUEST, context })).resolves.toBeDefined();
    });

    it("bounds the request with config.timeoutMs (SIA_LLM_TIMEOUT_MS), no retry behaviour added", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { timeoutMs: 30000 },
      });
      process.env.GEMINI_API_KEY = "gm-test-key";

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
      process.env.GEMINI_API_KEY = "gm-test-key";

      const result = await askLlm(VALID_REQUEST);

      expect(result.answer).toBe("Your spending rose 12% this month.");
      expect(result.model).toBe("gemini-3.6-flash");
      expect(typeof result.latencyMs).toBe("number");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
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
      process.env.GEMINI_API_KEY = "gm-test-key";

      const result = await askLlm(VALID_REQUEST);

      expect(result.answer).toBe("First answer.");
      expect(result.answer).not.toContain("Second, unused");
    });

    it("uses OpenAI-compatible json_schema mode only when structured output is requested, then returns the parsed value", async () => {
      const serialized = JSON.stringify(STRUCTURED_VALUE);
      const postMock = jest.fn().mockResolvedValue(chatCompletionResponse(serialized));
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      const result = await askLlm({ ...VALID_REQUEST, structuredOutput: STRUCTURED_OUTPUT });

      expect(postMock.mock.calls[0][1].response_format).toEqual({
        type: "json_schema",
        json_schema: {
          name: "sia_query_plan",
          strict: true,
          schema: STRUCTURED_OUTPUT.schema,
        },
      });
      expect(result.answer).toBe(serialized);
      expect(result.structuredOutput).toEqual(STRUCTURED_VALUE);
    });

    it("rejects non-JSON output in structured mode without treating it as a text answer", async () => {
      const postMock = jest.fn().mockResolvedValue(chatCompletionResponse("not-json"));
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm({ ...VALID_REQUEST, structuredOutput: STRUCTURED_OUTPUT })).rejects.toMatchObject({
        code: "PROVIDER_MALFORMED_STRUCTURED_OUTPUT",
        provider: "gemini",
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
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toBeInstanceOf(LlmProviderError);
      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "MODEL_NOT_CONFIGURED",
        provider: "gemini",
      });
      expect(postMock).not.toHaveBeenCalled();
    });

    it.each([
      ["missing", undefined],
      ["blank", "   "],
    ])(
      "rejects with PROVIDER_API_KEY_NOT_CONFIGURED when GEMINI_API_KEY is %s, and never calls axios",
      async (_label, value) => {
        const postMock = jest.fn();
        const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
        if (value === undefined) {
          delete process.env.GEMINI_API_KEY;
        } else {
          process.env.GEMINI_API_KEY = value;
        }

        await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
          code: "PROVIDER_API_KEY_NOT_CONFIGURED",
          provider: "gemini",
        });
        expect(postMock).not.toHaveBeenCalled();
      }
    );

    it("does NOT fall back to OPENAI_API_KEY when GEMINI_API_KEY is absent", async () => {
      const postMock = jest.fn();
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      delete process.env.GEMINI_API_KEY;
      const originalOpenAiKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = "sk-should-not-be-used";

      try {
        await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
          code: "PROVIDER_API_KEY_NOT_CONFIGURED",
          provider: "gemini",
        });
        expect(postMock).not.toHaveBeenCalled();
      } finally {
        if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = originalOpenAiKey;
      }
    });
  });

  describe("transport failure normalization", () => {
    it("normalizes an axios timeout (ECONNABORTED) to PROVIDER_TIMEOUT", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED" })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_TIMEOUT",
        provider: "gemini",
      });
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    it("normalizes a request-sent-but-no-response network failure to PROVIDER_NETWORK_ERROR", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("connect ECONNREFUSED"), { request: {} })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_NETWORK_ERROR",
        provider: "gemini",
      });
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    it("normalizes a Gemini 4xx/5xx HTTP response to PROVIDER_HTTP_ERROR", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("Request failed with status code 500"), {
          response: { status: 500, data: { error: { message: "internal error" } } },
        })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_HTTP_ERROR",
        provider: "gemini",
      });
      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("malformed / empty response handling", () => {
    it("rejects a response with no data with PROVIDER_MALFORMED_RESPONSE", async () => {
      const postMock = jest.fn().mockResolvedValue({});
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_MALFORMED_RESPONSE",
        provider: "gemini",
      });
    });

    it("rejects a response whose choices is missing/not an array with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue({ data: {} });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "gemini",
      });
    });

    it("rejects an empty choices array with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue({ data: { choices: [] } });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "gemini",
      });
    });

    it("rejects a choice with a non-string message.content with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue({
        data: { choices: [{ message: { role: "assistant", content: null } }] },
      });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "gemini",
      });
    });

    it("rejects a choice with a missing message with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue({ data: { choices: [{}] } });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "gemini",
      });
    });

    it("rejects a whitespace-only message.content with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue(chatCompletionResponse("   "));
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "gemini",
      });
    });
  });

  describe("no secret / financial-context / raw-provider-message leakage", () => {
    it("never leaks the API key, Authorization header, financial context, question, or raw HTTP body in a thrown error", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("Request failed with status code 401"), {
          response: {
            status: 401,
            data: { error: { message: "API key not valid: gm-test-key" } },
          },
        })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";

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

      expect(serialized).not.toContain("gm-test-key");
      expect(serialized).not.toContain("SENSITIVE_SYSTEM_PROMPT_MARKER");
      expect(serialized).not.toContain("SENSITIVE_CONTEXT_MARKER");
      expect(serialized).not.toContain("SENSITIVE_QUESTION_MARKER");
      expect(serialized).not.toContain("424242");
      expect(serialized).not.toContain("API key not valid");
      expect(serialized).not.toContain("Bearer");
    });

    it("a successful call never logs anything (console.log is never invoked by llmService itself)", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_MESSAGE_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GEMINI_API_KEY = "gm-test-key";
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
      process.env.GEMINI_API_KEY = "gm-test-key";

      await askLlm(VALID_REQUEST);

      expect(jest.isMockFunction(postMock)).toBe(true);
      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });
});
