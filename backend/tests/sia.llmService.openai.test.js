// Unit tests for the real OpenAI provider adapter inside
"use strict";

const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function restoreApiKeyEnv() {
  if (ORIGINAL_OPENAI_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_API_KEY;
  }
}

afterEach(() => {
  restoreApiKeyEnv();
  jest.resetModules();
});

afterAll(() => {
  restoreApiKeyEnv();
});

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

// Loads a brand-new backend/sia/config mock and a brand-new mocked axios
function loadLlmServiceWithMockedAxios({ configOverrides = {}, axiosPostMock } = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({
    enabled: false,
    provider: "openai",
    timeoutMs: 8000,
    model: "gpt-4.1-mini",
    ...configOverrides,
  }));

  const postMock = axiosPostMock || jest.fn();
  jest.doMock("axios", () => ({
    post: postMock,
  }));

  const llmService = require("../sia/llmService");
  return { ...llmService, postMock };
}

function completedResponse(output) {
  return { data: { status: "completed", output } };
}

const SINGLE_CHUNK_RESPONSE = completedResponse([
  {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text: "  Your spending rose 12% this month.  " }],
  },
]);

const MULTI_CHUNK_RESPONSE = completedResponse([
  // A reasoning item must be ignored entirely, not treated as answer text.
  { type: "reasoning", content: [{ type: "reasoning_text", text: "internal reasoning, not the answer" }] },
  {
    type: "message",
    role: "assistant",
    content: [
      { type: "output_text", text: "Part one. " },
      { type: "output_text", text: "Part two." },
    ],
  },
]);

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

describe("backend/sia/llmService -- OpenAI provider adapter", () => {
  describe("request shape", () => {
    it("posts to the exact /v1/responses endpoint", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock.mock.calls[0][0]).toBe(OPENAI_RESPONSES_URL);
    });

    it("sends Authorization and Content-Type headers", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await askLlm(VALID_REQUEST);

      const requestConfig = postMock.mock.calls[0][2];
      expect(requestConfig.headers).toMatchObject({
        Authorization: "Bearer sk-test-key",
        "Content-Type": "application/json",
      });
    });

    it("uses the centrally configured model", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { model: "gpt-5-mini" },
      });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock.mock.calls[0][1].model).toBe("gpt-5-mini");
    });

    it("passes systemPrompt through as instructions", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock.mock.calls[0][1].instructions).toBe(VALID_REQUEST.systemPrompt);
    });

    it("includes the serialized context and the question in the user input", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await askLlm(VALID_REQUEST);

      const body = postMock.mock.calls[0][1];
      expect(Array.isArray(body.input)).toBe(true);
      expect(body.input).toHaveLength(1);
      expect(body.input[0].role).toBe("user");
      expect(body.input[0].content).toContain(VALID_REQUEST.question);
      expect(body.input[0].content).toContain(JSON.stringify(VALID_REQUEST.context));
    });

    it("does not mutate the supplied context object", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";
      const context = Object.freeze({ summary: Object.freeze({ totalSpent: 4200 }) });

      await expect(askLlm({ ...VALID_REQUEST, context })).resolves.toBeDefined();
    });

    it("sends store: false", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock.mock.calls[0][1].store).toBe(false);
    });

    it("bounds the request with config.timeoutMs", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { timeoutMs: 4321 },
      });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await askLlm(VALID_REQUEST);

      expect(postMock.mock.calls[0][2].timeout).toBe(4321);
    });
  });

  describe("successful response extraction", () => {
    it("extracts and trims a single output_text chunk", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      const result = await askLlm(VALID_REQUEST);

      expect(result.answer).toBe("Your spending rose 12% this month.");
      expect(result.model).toBe("gpt-4.1-mini");
      expect(typeof result.latencyMs).toBe("number");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("joins multiple output_text chunks and ignores non-message items", async () => {
      const postMock = jest.fn().mockResolvedValue(MULTI_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      const result = await askLlm(VALID_REQUEST);

      expect(result.answer).toBe("Part one. Part two.");
      expect(result.answer).not.toContain("internal reasoning");
    });

    it("uses Responses API json_schema mode only when structured output is requested, then returns the parsed value", async () => {
      const serialized = JSON.stringify(STRUCTURED_VALUE);
      const postMock = jest.fn().mockResolvedValue(
        completedResponse([
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: serialized }],
          },
        ])
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      const result = await askLlm({ ...VALID_REQUEST, structuredOutput: STRUCTURED_OUTPUT });

      expect(postMock.mock.calls[0][1].text).toEqual({
        format: {
          type: "json_schema",
          name: "sia_query_plan",
          strict: true,
          schema: STRUCTURED_OUTPUT.schema,
        },
      });
      expect(result.answer).toBe(serialized);
      expect(result.structuredOutput).toEqual(STRUCTURED_VALUE);
    });

    it("rejects non-JSON output in structured mode without treating it as a text answer", async () => {
      const postMock = jest.fn().mockResolvedValue(
        completedResponse([
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "not-json" }],
          },
        ])
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm({ ...VALID_REQUEST, structuredOutput: STRUCTURED_OUTPUT })).rejects.toMatchObject({
        code: "PROVIDER_MALFORMED_STRUCTURED_OUTPUT",
        provider: "openai",
      });
    });
  });

  describe("pre-request validation failures", () => {
    it("rejects an invalid structured-output request before calling the provider", async () => {
      const postMock = jest.fn();
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(
        askLlm({ ...VALID_REQUEST, structuredOutput: { name: "invalid name", schema: {} } })
      ).rejects.toMatchObject({
        code: "STRUCTURED_OUTPUT_INVALID_REQUEST",
        provider: "openai",
      });
      expect(postMock).not.toHaveBeenCalled();
    });

    it("rejects with MODEL_NOT_CONFIGURED when config.model is missing, and never calls axios", async () => {
      const postMock = jest.fn();
      const { askLlm, LlmProviderError } = loadLlmServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { model: null },
      });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toBeInstanceOf(LlmProviderError);
      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({ code: "MODEL_NOT_CONFIGURED" });
      expect(postMock).not.toHaveBeenCalled();
    });

    it.each([
      ["missing", undefined],
      ["blank", "   "],
    ])(
      "rejects with PROVIDER_API_KEY_NOT_CONFIGURED when OPENAI_API_KEY is %s, and never calls axios",
      async (_label, value) => {
        const postMock = jest.fn();
        const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
        if (value === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = value;
        }

        await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
          code: "PROVIDER_API_KEY_NOT_CONFIGURED",
        });
        expect(postMock).not.toHaveBeenCalled();
      }
    );

    it("an unsupported (non-openai) provider still rejects with PROVIDER_NOT_IMPLEMENTED and never calls axios", async () => {
      const postMock = jest.fn();
      const { askLlm } = loadLlmServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { provider: "anthropic" },
      });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({ code: "PROVIDER_NOT_IMPLEMENTED" });
      expect(postMock).not.toHaveBeenCalled();
    });
  });

  describe("transport failure normalization", () => {
    it("normalizes an axios timeout (ECONNABORTED) to PROVIDER_TIMEOUT", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("timeout of 8000ms exceeded"), { code: "ECONNABORTED" })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_TIMEOUT",
        provider: "openai",
      });
      // M3-2: a timeout is never retried -- exactly one outbound attempt.
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    it("normalizes a request-sent-but-no-response network failure to PROVIDER_NETWORK_ERROR", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("connect ECONNREFUSED"), { request: {} })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_NETWORK_ERROR",
        provider: "openai",
      });
      // M3-2: a network failure is never retried -- exactly one outbound attempt.
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    it("normalizes an OpenAI 4xx/5xx HTTP response to PROVIDER_HTTP_ERROR", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("Request failed with status code 500"), {
          response: { status: 500, data: { error: { message: "internal error" } } },
        })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_HTTP_ERROR",
        provider: "openai",
      });
      // M3-2: an HTTP error response is never retried -- exactly one outbound attempt.
      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("failed / incomplete / malformed / empty response handling", () => {
    it("rejects a non-completed status with PROVIDER_RESPONSE_INCOMPLETE", async () => {
      const postMock = jest.fn().mockResolvedValue({
        data: { status: "incomplete", output: [] },
      });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_RESPONSE_INCOMPLETE",
      });
    });

    it("rejects a failed status with PROVIDER_RESPONSE_INCOMPLETE", async () => {
      const postMock = jest.fn().mockResolvedValue({
        data: { status: "failed", output: [] },
      });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_RESPONSE_INCOMPLETE",
      });
    });

    it("rejects a response with no data with PROVIDER_MALFORMED_RESPONSE", async () => {
      const postMock = jest.fn().mockResolvedValue({});
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_MALFORMED_RESPONSE",
      });
    });

    it("rejects a response whose output is missing/not an array with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue({ data: { status: "completed" } });
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
      });
    });

    it("rejects a response with only non-message items (e.g. reasoning-only) with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue(
        completedResponse([{ type: "reasoning", content: [{ type: "reasoning_text", text: "thinking..." }] }])
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
      });
    });

    it("rejects a message item with only blank output_text with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue(
        completedResponse([{ type: "message", content: [{ type: "output_text", text: "   " }] }])
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await expect(askLlm(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
      });
    });
  });

  describe("no secret / financial-context / raw-provider-message leakage", () => {
    it("never leaks the API key, headers, financial context, question, or raw HTTP body in a thrown error", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("Request failed with status code 401"), {
          response: {
            status: 401,
            data: { error: { message: "Incorrect API key provided: sk-test-key" } },
          },
        })
      );
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

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

      expect(serialized).not.toContain("sk-test-key");
      expect(serialized).not.toContain("SENSITIVE_SYSTEM_PROMPT_MARKER");
      expect(serialized).not.toContain("SENSITIVE_CONTEXT_MARKER");
      expect(serialized).not.toContain("SENSITIVE_QUESTION_MARKER");
      expect(serialized).not.toContain("424242");
      expect(serialized).not.toContain("Incorrect API key provided");
      expect(serialized).not.toContain("Bearer");
    });
  });

  describe("mock integrity", () => {
    it("axios.post is the injected mock, not a real HTTP client -- zero real network calls are possible", async () => {
      const postMock = jest.fn().mockResolvedValue(SINGLE_CHUNK_RESPONSE);
      const { askLlm } = loadLlmServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.OPENAI_API_KEY = "sk-test-key";

      await askLlm(VALID_REQUEST);

      expect(jest.isMockFunction(postMock)).toBe(true);
      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });
});
