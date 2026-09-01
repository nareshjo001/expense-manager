// Groq-provider readiness regression suite -- sia/readiness.js's
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-readiness-groq-test-secret";
const originalJwtSecret = process.env.JWT_SECRET;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalGroqKey = process.env.GROQ_API_KEY;

// Deliberately not realistic key shapes -- readiness checks PRESENCE only.
const FAKE_GROQ_CREDENTIAL = "test-groq-credential-not-a-real-key";
const FAKE_OPENAI_CREDENTIAL = "test-openai-credential-not-a-real-key";
const FAKE_GEMINI_CREDENTIAL = "test-gemini-credential-not-a-real-key";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

function setEnvCredentials({ openai, gemini, groq }) {
  if (openai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = openai;

  if (gemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = gemini;

  if (groq === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = groq;
}

afterEach(() => {
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;
  jest.resetModules();
});

function signToken(userId) {
  return jwt.sign({ email: "sia-readiness-groq-test@example.test", _id: userId }, TEST_JWT_SECRET);
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
function loadReadiness({ enabled, provider, model, openaiCredential, geminiCredential, groqCredential }) {
  jest.resetModules();
  jest.doMock("../sia/config", () => ({
    enabled,
    provider,
    model,
    timeoutMs: 8000,
    ...VOICE_CONFIG_DEFAULTS,
  }));
  setEnvCredentials({ openai: openaiCredential, gemini: geminiCredential, groq: groqCredential });
  return require("../sia/readiness");
}

describe("sia/readiness -- Groq provider", () => {
  it("exposes groq in IMPLEMENTED_PROVIDERS alongside openai and gemini (neither is dropped)", () => {
    const { IMPLEMENTED_PROVIDERS } = loadReadiness({
      enabled: true,
      provider: "groq",
      model: "openai/gpt-oss-120b",
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });

    expect(IMPLEMENTED_PROVIDERS).toContain("groq");
    expect(IMPLEMENTED_PROVIDERS).toContain("openai");
    expect(IMPLEMENTED_PROVIDERS).toContain("gemini");
  });

  it("is ready when enabled + provider=groq + model + GROQ_API_KEY are all present", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "groq",
      model: "openai/gpt-oss-120b",
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(true);
  });

  it.each([
    ["GROQ_API_KEY missing", { groqCredential: undefined }],
    ["GROQ_API_KEY blank", { groqCredential: "" }],
    ["GROQ_API_KEY whitespace-only", { groqCredential: "   " }],
  ])(
    "is NOT ready when provider=groq and %s -- even if OPENAI_API_KEY and GEMINI_API_KEY happen to be set",
    (_label, overrides) => {
      const { isSiaReady } = loadReadiness({
        enabled: true,
        provider: "groq",
        model: "openai/gpt-oss-120b",
        groqCredential: FAKE_GROQ_CREDENTIAL,
        openaiCredential: FAKE_OPENAI_CREDENTIAL,
        geminiCredential: FAKE_GEMINI_CREDENTIAL,
        ...overrides,
      });

      expect(isSiaReady()).toBe(false);
    }
  );

  it("provider=groq does NOT fall back to an OPENAI_API_KEY or GEMINI_API_KEY present in the environment", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "groq",
      model: "openai/gpt-oss-120b",
      groqCredential: undefined,
      openaiCredential: FAKE_OPENAI_CREDENTIAL,
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(false);
  });

  it("accepts a surrounding-whitespace \"groq\" provider value, matching llmService's own normalization", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "  groq  ",
      model: "openai/gpt-oss-120b",
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(true);
  });

  it("does not judge the Groq credential by format -- any non-blank value is accepted", () => {
    for (const groqCredential of ["x", "gsk_anything", "not-a-key-at-all", "1234567890"]) {
      const { isSiaReady } = loadReadiness({
        enabled: true,
        provider: "groq",
        model: "openai/gpt-oss-120b",
        groqCredential,
      });
      expect(isSiaReady()).toBe(true);
    }
  });

  it("accepts a non-default model (e.g. a different Groq-hosted model id)", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(true);
  });

  it("model/enabled rules apply identically to the groq provider (not just openai/gemini)", () => {
    const disabled = loadReadiness({
      enabled: false,
      provider: "groq",
      model: "openai/gpt-oss-120b",
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });
    expect(disabled.isSiaReady()).toBe(false);

    const noModel = loadReadiness({
      enabled: true,
      provider: "groq",
      model: null,
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });
    expect(noModel.isSiaReady()).toBe(false);
  });

  it("still performs no network call of any kind for the groq path either", () => {
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
      provider: "groq",
      model: "openai/gpt-oss-120b",
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });
    expect(isSiaReady()).toBe(true);

    expect(axiosGet).not.toHaveBeenCalled();
    expect(axiosPost).not.toHaveBeenCalled();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
  });
});

describe("sia/readiness -- OpenAI and Gemini readiness remain unchanged after the Groq addition", () => {
  it("openai is still ready with the exact same openai + OPENAI_API_KEY configuration as before", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "openai",
      model: "gpt-test",
      openaiCredential: FAKE_OPENAI_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(true);
  });

  it("gemini is still ready with the exact same gemini + GEMINI_API_KEY configuration as before", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "gemini",
      model: "gemini-3.6-flash",
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(true);
  });

  it("provider=openai is still NOT ready without OPENAI_API_KEY, even if GEMINI_API_KEY and GROQ_API_KEY are set", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "openai",
      model: "gpt-test",
      openaiCredential: undefined,
      geminiCredential: FAKE_GEMINI_CREDENTIAL,
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(false);
  });

  it("provider=gemini is still NOT ready without GEMINI_API_KEY, even if OPENAI_API_KEY and GROQ_API_KEY are set", () => {
    const { isSiaReady } = loadReadiness({
      enabled: true,
      provider: "gemini",
      model: "gemini-3.6-flash",
      geminiCredential: undefined,
      openaiCredential: FAKE_OPENAI_CREDENTIAL,
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });

    expect(isSiaReady()).toBe(false);
  });

  it("neither openai nor gemini ever falls back to GROQ_API_KEY", () => {
    const openaiCase = loadReadiness({
      enabled: true,
      provider: "openai",
      model: "gpt-test",
      openaiCredential: undefined,
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });
    expect(openaiCase.isSiaReady()).toBe(false);

    const geminiCase = loadReadiness({
      enabled: true,
      provider: "gemini",
      model: "gemini-3.6-flash",
      geminiCredential: undefined,
      groqCredential: FAKE_GROQ_CREDENTIAL,
    });
    expect(geminiCase.isSiaReady()).toBe(false);
  });
});

describe("GET /sia/status -- never leaks provider/model/credential for any of the three providers", () => {
  function loadApp({ enabled, provider, model, openaiCredential, geminiCredential, groqCredential }) {
    jest.resetModules();
    jest.doMock("../sia/config", () => ({
      enabled,
      provider,
      model,
      timeoutMs: 8000,
      ...VOICE_CONFIG_DEFAULTS,
    }));
    setEnvCredentials({ openai: openaiCredential, gemini: geminiCredential, groq: groqCredential });

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

  // NOTE on the explicit 60000ms third argument below (Workstream 2): this
  it(
    "returns exactly { success: true, available: true, capabilities } when ready with provider=groq",
    async () => {
      const { app } = loadApp({
        enabled: true,
        provider: "groq",
        model: "openai/gpt-oss-120b",
        groqCredential: FAKE_GROQ_CREDENTIAL,
      });
      const res = await request(app)
        .get("/sia/status")
        .set("Authorization", `Bearer ${signToken("user-groq-status-1")}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, available: true, capabilities: EXPECTED_VOICE_CAPABILITIES });
    },
    60000
  );

  it(
    "returns exactly { success: true, available: false, capabilities } when provider=groq has no GROQ_API_KEY",
    async () => {
      const { app } = loadApp({
        enabled: true,
        provider: "groq",
        model: "openai/gpt-oss-120b",
        groqCredential: undefined,
      });
      const res = await request(app)
        .get("/sia/status")
        .set("Authorization", `Bearer ${signToken("user-groq-status-2")}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, available: false, capabilities: EXPECTED_VOICE_CAPABILITIES });
    },
    60000
  );

  it(
    "never leaks the word \"groq\", the model id, the credential, or GROQ_API_KEY in the response body",
    async () => {
      for (const overrides of [
        { groqCredential: FAKE_GROQ_CREDENTIAL },
        { groqCredential: undefined },
      ]) {
        const { app } = loadApp({
          enabled: true,
          provider: "groq",
          model: "openai/gpt-oss-120b",
          ...overrides,
        });
        const res = await request(app)
          .get("/sia/status")
          .set("Authorization", `Bearer ${signToken("user-groq-status-3")}`);

        const raw = JSON.stringify(res.body);
        expect(raw).not.toContain("groq");
        expect(raw).not.toContain("openai/gpt-oss-120b");
        expect(raw).not.toContain(FAKE_GROQ_CREDENTIAL);
        expect(raw).not.toContain("GROQ_API_KEY");
        expect(raw).not.toContain("SIA_LLM_PROVIDER");
        expect(raw).not.toContain("SIA_LLM_MODEL");
        expect(Object.keys(res.body).sort()).toEqual(["available", "capabilities", "success"]);
        jest.resetModules();
      }
    },
    60000
  );
});
