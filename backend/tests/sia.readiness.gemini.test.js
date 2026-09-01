// Gemini-provider readiness regression suite -- sia/readiness.js's
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-readiness-gemini-test-secret";
const originalJwtSecret = process.env.JWT_SECRET;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;

// Deliberately not a realistic key shape -- readiness checks PRESENCE only.
const FAKE_GEMINI_CREDENTIAL = "test-gemini-credential-not-a-real-key";
const FAKE_OPENAI_CREDENTIAL = "test-openai-credential-not-a-real-key";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

function setEnvCredentials({ openai, gemini }) {
  if (openai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = openai;

  if (gemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = gemini;
}

afterEach(() => {
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
  jest.resetModules();
});

function signToken(userId) {
  return jwt.sign({ email: "sia-readiness-gemini-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

// Workstream 2 -- voice-input config defaults (see
const VOICE_CONFIG_DEFAULTS = {
  voiceEnabled: false,
  sttProvider: "groq",
  sttModel: "whisper-large-v3-turbo",
  sttTimeoutMs: 30000,
  sttMaxBytes: 5242880,
  sttMaxDurationSeconds: 45,
};

// Loads a fresh readiness module against an explicit config shape, without
// touching the real process.env-derived config object.
function loadReadiness({ enabled, provider, model, openaiCredential, geminiCredential }) {
  jest.resetModules();
  jest.doMock("../sia/config", () => ({
    enabled,
    provider,
    model,
    timeoutMs: 8000,
    ...VOICE_CONFIG_DEFAULTS,
  }));
  setEnvCredentials({ openai: openaiCredential, gemini: geminiCredential });
  return require("../sia/readiness");
}

describe("sia/readiness -- Gemini provider", () => {
  it("exposes gemini in IMPLEMENTED_PROVIDERS alongside openai (openai is not dropped)", () => {
    const { IMPLEMENTED_PROVIDERS } = loadReadiness({
      enabled: true,
      provider: "gemini",
      model: "gemini-3.6-flash",
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
    });

    expect(IMPLEMENTED_PROVIDERS).toContain("gemini");
    expect(IMPLEMENTED_PROVIDERS).toContain("openai");
  });

  it("is ready when enabled + provider=gemini + model + GEMINI_API_KEY are all present", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "gemini",
      model: "gemini-3.6-flash",
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(true);
  });

  it.each([
    ["GEMINI_API_KEY missing", { geminiCredential: undefined }],
    ["GEMINI_API_KEY blank", { geminiCredential: "" }],
    ["GEMINI_API_KEY whitespace-only", { geminiCredential: "   " }],
  ])("is NOT ready when provider=gemini and %s -- even if OPENAI_API_KEY happens to be set", (_label, overrides) => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "gemini",
      model: "gemini-3.6-flash",
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
      openaiCredential: FAKE_OPENAI_CREDENTIAL,
      ...overrides,
    });

    expect(isSiaReady()).toBe(false);
  });

  it("provider=gemini does NOT fall back to an OPENAI_API_KEY present in the environment", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "gemini",
      model: "gemini-3.6-flash",
      geminiCredential: undefined,
      openaiCredential: FAKE_OPENAI_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(false);
  });

  it("accepts a surrounding-whitespace \"gemini\" provider value, matching llmService's own normalization", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "  gemini  ",
      model: "gemini-3.6-flash",
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(true);
  });

  it("does not judge the Gemini credential by format -- any non-blank value is accepted", () => {
    for (const geminiCredential of ["x", "AIzaAnything", "not-a-key-at-all", "1234567890"]) {
      const { isSiaReady } = loadReadiness({
        enabled: true,
        provider: "gemini",
        model: "gemini-3.6-flash",
        geminiCredential,
      });
      expect(isSiaReady()).toBe(true);
    }
  });

  it("model/enabled rules apply identically to the gemini provider (not just openai)", () => {
    const disabled = loadReadiness({
      enabled: false,
      provider: "gemini",
      model: "gemini-3.6-flash",
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
    });
    expect(disabled.isSiaReady()).toBe(false);

    const noModel = loadReadiness({
      enabled: true,
      provider: "gemini",
      model: null,
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
    });
    expect(noModel.isSiaReady()).toBe(false);
  });

  it("still performs no network call of any kind for the gemini path either", () => {
    jest.resetModules();
    const axios = require("axios");
    const axiosGet = jest.spyOn(axios, "get").mockImplementation(() => {
      throw new Error("readiness must never make a network request");
    });
    const axiosPost = jest.spyOn(axios, "post").mockImplementation(() => {
      throw new Error("readiness must never make a network request");
    });

    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "gemini",
      model: "gemini-3.6-flash",
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
    });
    expect(isSiaReady()).toBe(true);

    expect(axiosGet).not.toHaveBeenCalled();
    expect(axiosPost).not.toHaveBeenCalled();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
  });
});

describe("sia/readiness -- OpenAI readiness remains unchanged after the Gemini addition", () => {
  it("is still ready with the exact same openai + OPENAI_API_KEY configuration as before", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "openai",
      model: "gpt-test",
      openaiCredential: FAKE_OPENAI_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(true);
  });

  it("provider=openai is still NOT ready without OPENAI_API_KEY, even if GEMINI_API_KEY is set", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "openai",
      model: "gpt-test",
      openaiCredential: undefined,
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(false);
  });

  it("provider=openai does NOT fall back to a GEMINI_API_KEY present in the environment", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "openai",
      model: "gpt-test",
      openaiCredential: undefined,
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(false);
  });
});

describe("GET /sia/status -- never leaks provider/model/credential for either provider", () => {
  function loadApp({ enabled, provider, model, openaiCredential, geminiCredential }) {
    jest.resetModules();
    jest.doMock("../sia/config", () => ({
      enabled,
      provider,
      model,
      timeoutMs: 8000,
      ...VOICE_CONFIG_DEFAULTS,
    }));
    setEnvCredentials({ openai: openaiCredential, gemini: geminiCredential });

    const askLlmMock = jest.fn(async () => {
      throw new Error("status must never call the LLM provider");
    });
    const { LlmProviderError } = jest.requireActual("../sia/llmService");
    jest.doMock("../sia/llmService", () => ({ askLlm: askLlmMock, LlmProviderError }));

    const buildContextMock = jest.fn(async () => {
      throw new Error("status must never build an analytics context");
    });
    jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

    const app = require("../app");
    return { app };
  }

  // Workstream 2 -- the additive capabilities.voiceInput block every
  const EXPECTED_VOICE_CAPABILITIES = {
    voiceInput: {
      available: false,
      maxDurationSeconds: 45,
      maxBytes: 5242880,
      acceptedMimeTypes: ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"],
    },
  };

  // NOTE on the explicit 60000ms third argument below (Workstream 2): see
  it(
    "returns exactly { success: true, available: true, capabilities } when ready with provider=gemini",
    async () => {
      const { app } = loadApp({
        enabled: true,
        provider: "gemini",
        model: "gemini-3.6-flash",
        geminiCredential: FAKE_GEMINI_CREDENTIAL,
      });
      const res = await request(app)
        .get("/sia/status")
        .set("Authorization", `Bearer ${signToken("user-gemini-status-1")}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, available: true, capabilities: EXPECTED_VOICE_CAPABILITIES });
    },
    60000
  );

  it(
    "returns exactly { success: true, available: false, capabilities } when provider=gemini has no GEMINI_API_KEY",
    async () => {
      const { app } = loadApp({
        enabled: true,
        provider: "gemini",
        model: "gemini-3.6-flash",
        geminiCredential: undefined,
      });
      const res = await request(app)
        .get("/sia/status")
        .set("Authorization", `Bearer ${signToken("user-gemini-status-2")}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, available: false, capabilities: EXPECTED_VOICE_CAPABILITIES });
    },
    60000
  );

  it(
    "never leaks the word \"gemini\", the model id, the credential, or GEMINI_API_KEY in the response body",
    async () => {
      for (const overrides of [
        { geminiCredential: FAKE_GEMINI_CREDENTIAL },
        { geminiCredential: undefined },
      ]) {
        const { app } = loadApp({
          enabled: true,
          provider: "gemini",
          model: "gemini-3.6-flash",
          ...overrides,
        });
        const res = await request(app)
          .get("/sia/status")
          .set("Authorization", `Bearer ${signToken("user-gemini-status-3")}`);

        const raw = JSON.stringify(res.body);
        expect(raw).not.toContain("gemini");
        expect(raw).not.toContain("gemini-3.6-flash");
        expect(raw).not.toContain(FAKE_GEMINI_CREDENTIAL);
        expect(raw).not.toContain("GEMINI_API_KEY");
        expect(raw).not.toContain("SIA_LLM_PROVIDER");
        expect(raw).not.toContain("SIA_LLM_MODEL");
        expect(Object.keys(res.body).sort()).toEqual(["available", "capabilities", "success"]);
        jest.resetModules();
      }
    },
    60000
  );
});
