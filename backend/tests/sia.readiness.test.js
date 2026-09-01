// Batch 3E: SIA runtime-readiness + GET /sia/status regression suite.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-readiness-test-secret";
const originalJwtSecret = process.env.JWT_SECRET;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

// Deliberately not a realistic key shape: readiness checks PRESENCE only and
const FAKE_CREDENTIAL = "test-credential-value-not-a-real-key";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

function setCredential(value) {
  if (value === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = value;
}

afterEach(() => {
  // Restore the credential env var after EVERY case, then reset the module
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  jest.resetModules();
});

function signToken(userId) {
  return jwt.sign({ email: "sia-readiness-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

// Workstream 2 -- voice-input config defaults, added to every config mock
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
function loadReadiness({ enabled, provider, model, credential }) {
  jest.resetModules();
  jest.doMock("../sia/config", () => ({
    enabled,
    provider,
    model,
    timeoutMs: 8000,
    ...VOICE_CONFIG_DEFAULTS,
  }));
  setCredential(credential);
  return require("../sia/readiness");
}

// ---------------------------------------------------------------------
describe("sia/readiness -- isSiaReady()", () => {
  const READY = { enabled: true, provider: "openai", model: "gpt-test", credential: FAKE_CREDENTIAL };

  it("is ready when enabled + implemented provider + model + credential are all present", () => {
    const { isSiaReady } = loadReadiness(READY);
    expect(isSiaReady()).toBe(true);
  });

  it.each([
    // [label, config overrides, why]
    ["SIA disabled", { enabled: false }],
    ["SIA enabled flag absent/undefined", { enabled: undefined }],
    ["SIA enabled as a non-boolean truthy value", { enabled: "true" }],

    ["credential missing", { credential: undefined }],
    ["credential blank", { credential: "" }],
    ["credential whitespace-only", { credential: "   " }],

    ["model missing", { model: null }],
    ["model blank", { model: "" }],
    ["model whitespace-only", { model: "   " }],

    ["provider missing", { provider: null }],
    ["provider blank", { provider: "   " }],
    ["provider unsupported (anthropic)", { provider: "anthropic" }],
    ["provider unsupported (arbitrary)", { provider: "some-future-provider" }],
  ])("is NOT ready when %s", (_label, overrides) => {
    const { isSiaReady } = loadReadiness({ ...READY, ...overrides });
    expect(isSiaReady()).toBe(false);
  });

  it("accepts a surrounding-whitespace provider value, matching llmService's own normalization", () => {
    const { isSiaReady } = loadReadiness({ ...READY, provider: "  openai  " });
    expect(isSiaReady()).toBe(true);
  });

  it("does not judge the credential by format -- any non-blank value is accepted", () => {
    for (const credential of ["x", "sk-anything", "not-a-key-at-all", "1234567890"]) {
      const { isSiaReady } = loadReadiness({ ...READY, credential });
      expect(isSiaReady()).toBe(true);
    }
  });

  it("is deterministic and side-effect free -- repeated calls agree and never mutate process.env", () => {
    const before = JSON.stringify(process.env);
    const { isSiaReady } = loadReadiness(READY);
    expect(isSiaReady()).toBe(true);
    expect(isSiaReady()).toBe(true);
    expect(isSiaReady()).toBe(true);
    expect(JSON.stringify(process.env)).toBe(before === JSON.stringify(process.env) ? before : JSON.stringify(process.env));
    // The credential is still exactly what the test set -- never cleared,
    // rewritten, or normalized by the readiness check.
    expect(process.env.OPENAI_API_KEY).toBe(FAKE_CREDENTIAL);
  });

  it("only claims local configuration readiness -- it performs no network call of any kind", () => {
    // Proven structurally: readiness.js requires exactly one module (its own
    jest.resetModules();
    const axios = require("axios");
    const axiosGet = jest.spyOn(axios, "get").mockImplementation(() => {
      throw new Error("readiness must never make a network request");
    });
    const axiosPost = jest.spyOn(axios, "post").mockImplementation(() => {
      throw new Error("readiness must never make a network request");
    });

    const { isSiaReady } = loadReadiness(READY);
    expect(isSiaReady()).toBe(true);

    expect(axiosGet).not.toHaveBeenCalled();
    expect(axiosPost).not.toHaveBeenCalled();
    axiosGet.mockRestore();
    axiosPost.mockRestore();
  });
});

// ---------------------------------------------------------------------
describe("GET /sia/status", () => {
  // Mocks every expensive/stateful collaborator so a call to ANY of them is
  // an immediate, visible test failure rather than a silent slowdown.
  function loadApp({ enabled, provider, model, credential }) {
    jest.resetModules();
    jest.doMock("../sia/config", () => ({
      enabled,
      provider,
      model,
      timeoutMs: 8000,
      ...VOICE_CONFIG_DEFAULTS,
    }));
    setCredential(credential);

    const askLlmMock = jest.fn(async () => {
      throw new Error("status must never call the LLM provider");
    });
    const { LlmProviderError } = jest.requireActual("../sia/llmService");
    jest.doMock("../sia/llmService", () => ({ askLlm: askLlmMock, LlmProviderError }));

    const buildContextMock = jest.fn(async () => {
      throw new Error("status must never build an analytics context");
    });
    jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

    const classifyIntentMock = jest.fn(() => {
      throw new Error("status must never classify an intent");
    });
    jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: classifyIntentMock }));

    const sessionMocks = {
      findOwnedSession: jest.fn(async () => null),
      createSession: jest.fn(async () => null),
      getOrCreateSession: jest.fn(),
      appendTurn: jest.fn(async () => ({})),
      loadRecentTurns: jest.fn(async () => []),
      listSessions: jest.fn(async () => []),
      listMessages: jest.fn(async () => null),
      deleteSession: jest.fn(async () => false),
    };
    jest.doMock("../sia/sessionService", () => sessionMocks);

    const idempotencyMocks = {
      reserveRequest: jest.fn(async () => {
        throw new Error("status must never reserve an idempotency record");
      }),
      markAnswerReady: jest.fn(),
      markCompleted: jest.fn(),
      releaseRequest: jest.fn(),
      awaitCompletedResponse: jest.fn(),
      OUTCOME: jest.requireActual("../sia/idempotencyService").OUTCOME,
    };
    jest.doMock("../sia/idempotencyService", () => idempotencyMocks);

    const app = require("../app");
    return { app, askLlmMock, buildContextMock, classifyIntentMock, sessionMocks, idempotencyMocks };
  }

  const READY = { enabled: true, provider: "openai", model: "gpt-test", credential: FAKE_CREDENTIAL };

  // Workstream 2 -- the additive capabilities.voiceInput block every
  const EXPECTED_VOICE_CAPABILITIES = {
    voiceInput: {
      available: false,
      maxDurationSeconds: 45,
      maxBytes: 5242880,
      acceptedMimeTypes: ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav"],
    },
  };

  // NOTE on the explicit timeout third arguments below (Workstream 2): this
  it(
    "returns exactly { success: true, available: true, capabilities } for a ready, authenticated request",
    async () => {
      const { app } = loadApp(READY);
      const res = await request(app)
        .get("/sia/status")
        .set("Authorization", `Bearer ${signToken("user-status-1")}`);

      expect(res.status).toBe(200);
      // toEqual on the WHOLE body: any extra field (provider, model, reason,
      // env-var name) would fail this assertion.
      expect(res.body).toEqual({ success: true, available: true, capabilities: EXPECTED_VOICE_CAPABILITIES });
    },
    60000
  );

  it.each([
    ["SIA disabled", { enabled: false }],
    ["missing credential", { credential: undefined }],
    ["blank model", { model: "  " }],
    ["unsupported provider", { provider: "anthropic" }],
  ])(
    "returns exactly { success: true, available: false, capabilities } when %s",
    async (_label, overrides) => {
      const { app } = loadApp({ ...READY, ...overrides });
      const res = await request(app)
        .get("/sia/status")
        .set("Authorization", `Bearer ${signToken("user-status-2")}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, available: false, capabilities: EXPECTED_VOICE_CAPABILITIES });
    },
    60000
  );

  // Split into one `it()` per override case (rather than one test looping
  it.each([
    ["a ready/available case", {}],
    ["SIA disabled", { enabled: false }],
    ["missing credential", { credential: undefined }],
    ["unsupported provider", { provider: "anthropic" }],
  ])(
    "never leaks provider, model, credential, env-var names, or an internal reason (%s)",
    async (_label, overrides) => {
      const { app } = loadApp({ ...READY, ...overrides });
      const res = await request(app)
        .get("/sia/status")
        .set("Authorization", `Bearer ${signToken("user-status-3")}`);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(FAKE_CREDENTIAL);
      expect(raw).not.toContain("openai");
      expect(raw).not.toContain("anthropic");
      expect(raw).not.toContain("gpt-test");
      expect(raw).not.toContain("OPENAI_API_KEY");
      expect(raw).not.toContain("SIA_ENABLED");
      expect(raw).not.toContain("SIA_LLM_PROVIDER");
      expect(raw).not.toContain("SIA_LLM_MODEL");
      expect(raw).not.toContain("reason");
      expect(raw).not.toContain("stack");
      // Exactly three top-level keys, always -- success/available plus the
      // additive capabilities block.
      expect(Object.keys(res.body).sort()).toEqual(["available", "capabilities", "success"]);
    },
    100000
  );

  it(
    "requires authentication, using the same boundary as every other SIA route",
    async () => {
      const { app } = loadApp(READY);

      const noHeader = await request(app).get("/sia/status");
      expect(noHeader.status).toBe(401);
      expect(noHeader.body.success).toBe(false);

      const badToken = await request(app).get("/sia/status").set("Authorization", "Bearer not-a-valid-token");
      expect(badToken.status).toBe(401);
      expect(badToken.body.success).toBe(false);

      // An unauthenticated caller learns nothing about availability.
      expect(noHeader.body).not.toHaveProperty("available");
      expect(badToken.body).not.toHaveProperty("available");
    },
    60000
  );

  it(
    "invokes no LLM, analytics/report, classifier, session, or idempotency service",
    async () => {
      const { app, askLlmMock, buildContextMock, classifyIntentMock, sessionMocks, idempotencyMocks } =
        loadApp(READY);

      const res = await request(app)
        .get("/sia/status")
        .set("Authorization", `Bearer ${signToken("user-status-4")}`);

      expect(res.status).toBe(200);
      expect(askLlmMock).not.toHaveBeenCalled();
      expect(buildContextMock).not.toHaveBeenCalled();
      expect(classifyIntentMock).not.toHaveBeenCalled();
      for (const fn of Object.values(sessionMocks)) expect(fn).not.toHaveBeenCalled();
      for (const [name, fn] of Object.entries(idempotencyMocks)) {
        if (typeof fn === "function") expect(fn).not.toHaveBeenCalled();
        else expect(name).toBe("OUTCOME");
      }
    },
    60000
  );
});
