// Workstream 2: SIA voice-input readiness regression suite --
// backend/sia/readiness.js's isVoiceReady(), and the additive
// capabilities.voiceInput block on GET /sia/status.
//
// Proves:
//   1. isVoiceReady() table-driven across every configuration permutation
//      that matters.
//   2. isVoiceReady() is fully INDEPENDENT of isSiaReady() -- voice can be
//      unavailable while text stays ready, and vice versa (neither reads
//      the other's config fields or credential).
//   3. GET /sia/status's capabilities.voiceInput block reflects
//      isVoiceReady() and never leaks "groq"/"whisper"/a credential-shaped
//      string.
//
// Same isolation style as tests/sia.readiness.groq.test.js: sia/config.js
// is re-mocked per test via jest.doMock + jest.resetModules(), and every
// credential env var is saved/restored around every test so no real value
// ever leaks between tests or into a later suite. No live network/provider
// call is possible anywhere in this file.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-readiness-voice-test-secret";
const originalJwtSecret = process.env.JWT_SECRET;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalGroqKey = process.env.GROQ_API_KEY;

const FAKE_GROQ_CREDENTIAL = "test-groq-credential-not-a-real-key";
const FAKE_OPENAI_CREDENTIAL = "test-openai-credential-not-a-real-key";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

function setEnvCredentials({ openai, groq }) {
  if (openai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = openai;

  if (groq === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = groq;
}

afterEach(() => {
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalGroqKey === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = originalGroqKey;
  jest.resetModules();
});

function signToken(userId) {
  return jwt.sign({ email: "sia-readiness-voice-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

// Loads a fresh readiness module against an explicit, fully-specified
// config shape (both the text SIA_LLM_* surface and the voice SIA_STT_*
// surface), without touching the real process.env-derived config object.
function loadReadiness({
  enabled = false,
  provider = null,
  model = null,
  openaiCredential,
  voiceEnabled = false,
  sttProvider = "groq",
  groqCredential,
} = {}) {
  jest.resetModules();
  jest.doMock("../sia/config", () => ({
    enabled,
    provider,
    model,
    timeoutMs: 8000,
    voiceEnabled,
    sttProvider,
    sttModel: "whisper-large-v3-turbo",
    sttTimeoutMs: 30000,
    sttMaxBytes: 5242880,
    sttMaxDurationSeconds: 45,
  }));
  setEnvCredentials({ openai: openaiCredential, groq: groqCredential });
  return require("../sia/readiness");
}

const VOICE_READY = { voiceEnabled: true, sttProvider: "groq", groqCredential: FAKE_GROQ_CREDENTIAL };

describe("sia/readiness -- isVoiceReady()", () => {
  it("is ready when voiceEnabled + provider=groq + GROQ_API_KEY are all present", () => {
    const { isVoiceReady } = loadReadiness(VOICE_READY);
    expect(isVoiceReady()).toBe(true);
  });

  it("exposes groq in IMPLEMENTED_STT_PROVIDERS", () => {
    const { IMPLEMENTED_STT_PROVIDERS } = loadReadiness(VOICE_READY);
    expect(IMPLEMENTED_STT_PROVIDERS).toContain("groq");
  });

  it.each([
    ["voice disabled", { voiceEnabled: false }],
    ["voice enabled flag absent/undefined", { voiceEnabled: undefined }],
    ["voice enabled as a non-boolean truthy value", { voiceEnabled: "true" }],

    ["GROQ_API_KEY missing", { groqCredential: undefined }],
    ["GROQ_API_KEY blank", { groqCredential: "" }],
    ["GROQ_API_KEY whitespace-only", { groqCredential: "   " }],

    ["sttProvider blank", { sttProvider: "   " }],
    ["sttProvider unsupported (elevenlabs)", { sttProvider: "elevenlabs" }],
    ["sttProvider unsupported (arbitrary)", { sttProvider: "some-future-provider" }],
  ])("is NOT ready when %s", (_label, overrides) => {
    const { isVoiceReady } = loadReadiness({ ...VOICE_READY, ...overrides });
    expect(isVoiceReady()).toBe(false);
  });

  it("accepts a surrounding-whitespace \"groq\" provider value", () => {
    const { isVoiceReady } = loadReadiness({ ...VOICE_READY, sttProvider: "  groq  " });
    expect(isVoiceReady()).toBe(true);
  });

  it("does not judge the Groq credential by format -- any non-blank value is accepted", () => {
    for (const groqCredential of ["x", "gsk-anything", "not-a-key-at-all", "1234567890"]) {
      const { isVoiceReady } = loadReadiness({ ...VOICE_READY, groqCredential });
      expect(isVoiceReady()).toBe(true);
    }
  });

  it("performs no network call of any kind", () => {
    jest.resetModules();
    const axios = require("axios");
    const axiosGet = jest.spyOn(axios, "get").mockImplementation(() => {
      throw new Error("readiness must never make a network request");
    });
    const axiosPost = jest.spyOn(axios, "post").mockImplementation(() => {
      throw new Error("readiness must never make a network request");
    });

    const { isVoiceReady } = loadReadiness(VOICE_READY);
    expect(isVoiceReady()).toBe(true);

    expect(axiosGet).not.toHaveBeenCalled();
    expect(axiosPost).not.toHaveBeenCalled();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
  });
});

describe("sia/readiness -- isVoiceReady() and isSiaReady() are fully independent", () => {
  it("voice is ready while text is NOT ready (text disabled, no text provider/model/credential)", () => {
    const { isVoiceReady, isSiaReady } = loadReadiness({
      enabled: false,
      provider: null,
      model: null,
      ...VOICE_READY,
    });
    expect(isVoiceReady()).toBe(true);
    expect(isSiaReady()).toBe(false);
  });

  it("text is ready while voice is NOT ready (voice disabled)", () => {
    const { isVoiceReady, isSiaReady } = loadReadiness({
      enabled: true,
      provider: "openai",
      model: "gpt-test",
      openaiCredential: FAKE_OPENAI_CREDENTIAL,
      voiceEnabled: false,
    });
    expect(isSiaReady()).toBe(true);
    expect(isVoiceReady()).toBe(false);
  });

  it("both ready simultaneously when both are independently fully configured", () => {
    const { isVoiceReady, isSiaReady } = loadReadiness({
      enabled: true,
      provider: "openai",
      model: "gpt-test",
      openaiCredential: FAKE_OPENAI_CREDENTIAL,
      ...VOICE_READY,
    });
    expect(isSiaReady()).toBe(true);
    expect(isVoiceReady()).toBe(true);
  });

  it("both NOT ready simultaneously when neither is configured", () => {
    const { isVoiceReady, isSiaReady } = loadReadiness({});
    expect(isSiaReady()).toBe(false);
    expect(isVoiceReady()).toBe(false);
  });

  it("OPENAI_API_KEY presence never influences isVoiceReady, and GROQ_API_KEY presence never influences isSiaReady(provider=openai)", () => {
    const { isVoiceReady, isSiaReady } = loadReadiness({
      enabled: true,
      provider: "openai",
      model: "gpt-test",
      openaiCredential: FAKE_OPENAI_CREDENTIAL,
      voiceEnabled: true,
      sttProvider: "groq",
      groqCredential: undefined,
    });
    // Voice needs its OWN GROQ_API_KEY -- OPENAI_API_KEY being present for
    // the text provider does not satisfy it.
    expect(isVoiceReady()).toBe(false);
    expect(isSiaReady()).toBe(true);
  });
});

describe("GET /sia/status -- capabilities.voiceInput reflects isVoiceReady()", () => {
  function loadApp({
    enabled = false,
    provider = null,
    model = null,
    openaiCredential,
    voiceEnabled = false,
    sttProvider = "groq",
    groqCredential,
  } = {}) {
    jest.resetModules();
    jest.doMock("../sia/config", () => ({
      enabled,
      provider,
      model,
      timeoutMs: 8000,
      voiceEnabled,
      sttProvider,
      sttModel: "whisper-large-v3-turbo",
      sttTimeoutMs: 30000,
      sttMaxBytes: 5242880,
      sttMaxDurationSeconds: 45,
    }));
    setEnvCredentials({ openai: openaiCredential, groq: groqCredential });

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

  // NOTE on the explicit 60000ms third argument below: this sandbox pays a
  // large one-time-per-call cost for jest.resetModules() + require("../app")
  // (the same characteristic already visible, unmodified by this file, in
  // tests/sia.readiness.groq.test.js's sibling GET /sia/status block) --
  // each call here has been observed taking up to ~55s in this environment,
  // well past Jest's default 5000ms per-test timeout, even though the
  // request itself resolves correctly. This mirrors the documented,
  // narrowly-scoped fix in tests/sia.ask.test.js (a per-test timeout, not a
  // suite-wide jest.setTimeout()) rather than masking a real hang.
  it(
    "capabilities.voiceInput.available is true when voice is fully configured",
    async () => {
      const { app } = loadApp(VOICE_READY);
      const res = await request(app)
        .get("/sia/status")
        .set("Authorization", `Bearer ${signToken("user-voice-status-1")}`);

      expect(res.status).toBe(200);
      expect(res.body.capabilities.voiceInput).toEqual({
        available: true,
        maxDurationSeconds: 45,
        maxBytes: 5242880,
        acceptedMimeTypes: ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"],
      });
    },
    60000
  );

  it(
    "capabilities.voiceInput.available is false when GROQ_API_KEY is absent, but ceilings/mime list are still reported",
    async () => {
      const { app } = loadApp({ ...VOICE_READY, groqCredential: undefined });
      const res = await request(app)
        .get("/sia/status")
        .set("Authorization", `Bearer ${signToken("user-voice-status-2")}`);

      expect(res.status).toBe(200);
      expect(res.body.capabilities.voiceInput).toEqual({
        available: false,
        maxDurationSeconds: 45,
        maxBytes: 5242880,
        acceptedMimeTypes: ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"],
      });
    },
    60000
  );

  it(
    "available (text) and capabilities.voiceInput.available (voice) can disagree in either direction",
    async () => {
      const textReadyVoiceNot = await (async () => {
        const { app } = loadApp({
          enabled: true,
          provider: "openai",
          model: "gpt-test",
          openaiCredential: FAKE_OPENAI_CREDENTIAL,
          voiceEnabled: false,
        });
        return request(app).get("/sia/status").set("Authorization", `Bearer ${signToken("user-voice-status-3")}`);
      })();
      expect(textReadyVoiceNot.body.available).toBe(true);
      expect(textReadyVoiceNot.body.capabilities.voiceInput.available).toBe(false);

      const voiceReadyTextNot = await (async () => {
        const { app } = loadApp({ enabled: false, ...VOICE_READY });
        return request(app).get("/sia/status").set("Authorization", `Bearer ${signToken("user-voice-status-4")}`);
      })();
      expect(voiceReadyTextNot.body.available).toBe(false);
      expect(voiceReadyTextNot.body.capabilities.voiceInput.available).toBe(true);
    },
    90000
  );

  it(
    "never leaks \"groq\", \"whisper\", the model id, the credential, GROQ_API_KEY, or SIA_STT_* env-var names",
    async () => {
      for (const overrides of [VOICE_READY, { ...VOICE_READY, groqCredential: undefined }]) {
        const { app } = loadApp(overrides);
        const res = await request(app)
          .get("/sia/status")
          .set("Authorization", `Bearer ${signToken("user-voice-status-5")}`);

        const raw = JSON.stringify(res.body);
        expect(raw.toLowerCase()).not.toContain("groq");
        expect(raw.toLowerCase()).not.toContain("whisper");
        expect(raw).not.toContain(FAKE_GROQ_CREDENTIAL);
        expect(raw).not.toContain("GROQ_API_KEY");
        expect(raw).not.toContain("SIA_STT_PROVIDER");
        expect(raw).not.toContain("SIA_STT_MODEL");
        jest.resetModules();
      }
    },
    120000
  );
});
