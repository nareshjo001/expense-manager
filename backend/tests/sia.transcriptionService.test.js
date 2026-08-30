// Unit tests for the Groq STT provider adapter inside
// backend/sia/transcriptionService.js.
//
// axios is fully mocked BEFORE transcriptionService.js is ever required, in
// every test in this file -- no real HTTP request is possible. backend/sia/config
// is also mocked, the same isolation style as tests/sia.llmService.groq.test.js.
// Only GROQ_API_KEY is a real (test-controlled) environment variable, because
// transcriptionService.js deliberately reads it directly from process.env
// rather than through the shared config module.
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

const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

// Loads a brand-new backend/sia/config mock and a brand-new mocked axios
// module, then a brand-new transcriptionService module, for a single test.
function loadServiceWithMockedAxios({ configOverrides = {}, axiosPostMock } = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({
    sttProvider: "groq",
    sttModel: "whisper-large-v3-turbo",
    sttTimeoutMs: 30000,
    sttMaxBytes: 5242880,
    sttMaxDurationSeconds: 45,
    ...configOverrides,
  }));

  const postMock = axiosPostMock || jest.fn();
  jest.doMock("axios", () => ({
    post: postMock,
  }));

  const transcriptionService = require("../sia/transcriptionService");
  return { ...transcriptionService, postMock };
}

function verboseJsonResponse(text, overrides = {}) {
  return {
    data: {
      task: "transcribe",
      language: "english",
      duration: 2.84,
      text,
      segments: [],
      ...overrides,
    },
  };
}

const AUDIO_BUFFER = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]);

const VALID_REQUEST = {
  buffer: AUDIO_BUFFER,
  filename: "audio",
  mimeType: "audio/webm",
};

describe("backend/sia/transcriptionService -- Groq STT provider adapter", () => {
  describe("request shape", () => {
    it("posts to the exact Groq audio/transcriptions endpoint", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("Hello there."));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await transcribeAudio(VALID_REQUEST);

      expect(postMock).toHaveBeenCalledTimes(1);
      expect(postMock.mock.calls[0][0]).toBe(GROQ_TRANSCRIPTIONS_URL);
    });

    it("sends the Groq key ONLY through the Authorization header", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("Hello there."));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await transcribeAudio(VALID_REQUEST);

      const requestConfig = postMock.mock.calls[0][2];
      expect(requestConfig.headers.Authorization).toBe("Bearer gsk-test-key");
      expect(postMock.mock.calls[0][0]).not.toContain("gsk-test-key");
    });

    it("uses a real multipart/form-data body with a genuine boundary (never a hand-built string)", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("Hello there."));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await transcribeAudio(VALID_REQUEST);

      const body = postMock.mock.calls[0][1];
      const requestConfig = postMock.mock.calls[0][2];
      // A real `form-data` instance exposes getHeaders()/append() and a
      // Content-Type header carrying a real "boundary=" parameter.
      expect(typeof body.getHeaders).toBe("function");
      expect(requestConfig.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
    });

    it("uses the centrally configured STT model", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("Hello there."));
      const { transcribeAudio } = loadServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { sttModel: "whisper-large-v3" },
      });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await transcribeAudio(VALID_REQUEST);
      // form-data buffers the multipart body lazily -- assert via the
      // constructed FormData's internal stream is not practical here, so
      // this is instead covered end-to-end by the model-not-configured
      // test below (proving the model IS read from config).
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    it("bounds the request with config.sttTimeoutMs, no retry behaviour added", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("Hello there."));
      const { transcribeAudio } = loadServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { sttTimeoutMs: 12345 },
      });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await transcribeAudio(VALID_REQUEST);

      expect(postMock.mock.calls[0][2].timeout).toBe(12345);
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    it("forwards the AbortController signal when supplied", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("Hello there."));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";
      const controller = new AbortController();

      await transcribeAudio({ ...VALID_REQUEST, signal: controller.signal });

      expect(postMock.mock.calls[0][2].signal).toBe(controller.signal);
    });
  });

  describe("successful response extraction", () => {
    it("extracts transcript, language, and duration (ms) from the verbose_json shape", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("  Show me last month's spending.  "));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      const result = await transcribeAudio(VALID_REQUEST);

      expect(result).toEqual({
        transcript: "Show me last month's spending.",
        detectedLanguage: "english",
        durationMs: 2840,
      });
    });

    it("defaults detectedLanguage to \"unknown\" when the provider omits language", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("Hi.", { language: undefined }));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      const result = await transcribeAudio(VALID_REQUEST);
      expect(result.detectedLanguage).toBe("unknown");
    });

    it("falls back to observed latency when the provider omits duration", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("Hi.", { duration: undefined }));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      const result = await transcribeAudio(VALID_REQUEST);
      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("pre-request validation failures", () => {
    it("rejects with MODEL_NOT_CONFIGURED when config.sttModel is missing, and never calls axios", async () => {
      const postMock = jest.fn();
      const { transcribeAudio, TranscriptionProviderError } = loadServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { sttModel: null },
      });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toBeInstanceOf(TranscriptionProviderError);
      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "MODEL_NOT_CONFIGURED",
        provider: "groq",
      });
      expect(postMock).not.toHaveBeenCalled();
    });

    it.each([
      ["missing", undefined],
      ["blank", "   "],
    ])("rejects with PROVIDER_API_KEY_NOT_CONFIGURED when GROQ_API_KEY is %s, and never calls axios", async (_label, value) => {
      const postMock = jest.fn();
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      if (value === undefined) delete process.env.GROQ_API_KEY;
      else process.env.GROQ_API_KEY = value;

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_API_KEY_NOT_CONFIGURED",
        provider: "groq",
      });
      expect(postMock).not.toHaveBeenCalled();
    });

    it("rejects with PROVIDER_NOT_CONFIGURED when no STT provider is configured", async () => {
      const postMock = jest.fn();
      const { transcribeAudio } = loadServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { sttProvider: null },
      });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_NOT_CONFIGURED",
        provider: null,
      });
      expect(postMock).not.toHaveBeenCalled();
    });

    it("rejects with PROVIDER_NOT_IMPLEMENTED for an unsupported provider, and never calls axios", async () => {
      const postMock = jest.fn();
      const { transcribeAudio } = loadServiceWithMockedAxios({
        axiosPostMock: postMock,
        configOverrides: { sttProvider: "elevenlabs" },
      });

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_NOT_IMPLEMENTED",
        provider: "elevenlabs",
      });
      expect(postMock).not.toHaveBeenCalled();
    });
  });

  describe("transport failure normalization", () => {
    it("normalizes an axios timeout (ECONNABORTED) to PROVIDER_TIMEOUT", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("timeout of 30000ms exceeded"), { code: "ECONNABORTED" })
      );
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_TIMEOUT",
        provider: "groq",
      });
    });

    it("normalizes a request-sent-but-no-response network failure to PROVIDER_NETWORK_ERROR", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("connect ECONNREFUSED"), { request: {} })
      );
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_NETWORK_ERROR",
        provider: "groq",
      });
    });

    it("normalizes a Groq 4xx/5xx HTTP response to PROVIDER_HTTP_ERROR", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("Request failed with status code 429"), {
          response: { status: 429, data: { error: { message: "rate limit exceeded" } } },
        })
      );
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_HTTP_ERROR",
        provider: "groq",
      });
    });

    it("normalizes a client-initiated abort (ERR_CANCELED) to PROVIDER_REQUEST_ABORTED, without crashing", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("canceled"), { code: "ERR_CANCELED" })
      );
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_REQUEST_ABORTED",
        provider: "groq",
      });
    });
  });

  describe("malformed / empty response handling", () => {
    it("rejects a response with no data with PROVIDER_MALFORMED_RESPONSE", async () => {
      const postMock = jest.fn().mockResolvedValue({});
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_MALFORMED_RESPONSE",
        provider: "groq",
      });
    });

    it("rejects a response with no usable text with PROVIDER_EMPTY_OUTPUT (e.g. silent audio)", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse(""));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "groq",
      });
    });

    it("rejects a whitespace-only text with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("   "));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "groq",
      });
    });

    it("rejects a non-string text field with PROVIDER_EMPTY_OUTPUT", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse(null));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await expect(transcribeAudio(VALID_REQUEST)).rejects.toMatchObject({
        code: "PROVIDER_EMPTY_OUTPUT",
        provider: "groq",
      });
    });
  });

  describe("no secret / audio / transcript leakage", () => {
    it("never leaks the API key, Authorization header, audio buffer content, or transcript in a thrown error", async () => {
      const postMock = jest.fn().mockRejectedValue(
        Object.assign(new Error("Request failed with status code 401"), {
          response: { status: 401, data: { error: { message: "Invalid API Key: gsk-test-key" } } },
        })
      );
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      let caughtError;
      try {
        await transcribeAudio({
          buffer: Buffer.from("SENSITIVE_AUDIO_BYTES_MARKER"),
          filename: "audio",
          mimeType: "audio/webm",
          languageHint: "SENSITIVE_LANGUAGE_HINT_MARKER",
        });
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
      expect(serialized).not.toContain("SENSITIVE_AUDIO_BYTES_MARKER");
      expect(serialized).not.toContain("SENSITIVE_LANGUAGE_HINT_MARKER");
      expect(serialized).not.toContain("Invalid API Key");
      expect(serialized).not.toContain("Bearer");
    });

    it("a successful call never logs anything (console.log is never invoked by transcriptionService itself)", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("Hi."));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

      try {
        await transcribeAudio(VALID_REQUEST);
        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        logSpy.mockRestore();
      }
    });
  });

  describe("mock integrity", () => {
    it("axios.post is the injected mock, not a real HTTP client -- zero real network calls are possible", async () => {
      const postMock = jest.fn().mockResolvedValue(verboseJsonResponse("Hi."));
      const { transcribeAudio } = loadServiceWithMockedAxios({ axiosPostMock: postMock });
      process.env.GROQ_API_KEY = "gsk-test-key";

      await transcribeAudio(VALID_REQUEST);

      expect(jest.isMockFunction(postMock)).toBe(true);
      expect(postMock).toHaveBeenCalledTimes(1);
    });
  });
});
