// Batch 3E: proves POST /sia/ask now uses the SAME readiness evaluator that
// GET /sia/status answers with -- so the two endpoints can never disagree --
// and that an unready deployment does no work and leaves no trace.
//
// Before Batch 3E the controller gated on `config.enabled` alone, so a
// deployment with SIA enabled but no provider/model/credential admitted the
// request, classified it, built a full Report V3 analytics context, and only
// then failed at the provider boundary -- paying for real work to produce a
// guaranteed 503. These tests pin the corrected ordering.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-ask-readiness-test-secret";
const originalJwtSecret = process.env.JWT_SECRET;
const originalOpenAiKey = process.env.OPENAI_API_KEY;

const FAKE_CREDENTIAL = "test-credential-value-not-a-real-key";
const QUESTION = "Why is my financial health score low?";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

let consoleLogSpy;
beforeEach(() => {
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  jest.resetModules();
});

function signToken(userId) {
  return jwt.sign({ email: "sia-ask-readiness-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

// Deliberately merged with object spread rather than destructuring
// defaults: a destructured default parameter would silently substitute the
// fallback for an explicitly-passed `undefined`, so the "missing
// credential" case below could never actually express "absent".
function loadApp(overrides = {}) {
  const { enabled, provider, model, credential } = {
    enabled: true,
    provider: "openai",
    model: "gpt-test",
    credential: FAKE_CREDENTIAL,
    ...overrides,
  };

  jest.resetModules();

  jest.doMock("../sia/config", () => ({ enabled, provider, model, timeoutMs: 8000 }));
  if (credential === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = credential;

  const { classifyIntent: realClassifyIntent } = jest.requireActual("../sia/intentClassifier");
  const classifyIntentMock = jest.fn(realClassifyIntent);
  jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: classifyIntentMock }));

  const buildContextMock = jest.fn(async () => ({
    intent: "HEALTH_EXPLANATION",
    fields: { financialHealth: { overall: 75, risk: { label: "Low", color: "green" } } },
    sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
  }));
  jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

  const { LlmProviderError } = jest.requireActual("../sia/llmService");
  const askLlmMock = jest.fn(async () => ({
    answer: "Your financial health score is 75, reflecting Low overall risk.",
    model: "mock-model",
    latencyMs: 5,
  }));
  jest.doMock("../sia/llmService", () => ({ askLlm: askLlmMock, LlmProviderError }));

  const createSessionMock = jest.fn(async (userId) => ({ _id: "sess-1", user: userId }));
  const appendTurnMock = jest.fn(async () => ({ deduplicated: false }));
  jest.doMock("../sia/sessionService", () => ({
    findOwnedSession: jest.fn(async () => null),
    createSession: createSessionMock,
    getOrCreateSession: jest.fn(),
    appendTurn: appendTurnMock,
    loadRecentTurns: jest.fn(async () => []),
    listSessions: jest.fn(async () => []),
    listMessages: jest.fn(async () => null),
    deleteSession: jest.fn(async () => false),
  }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => true }));

  const reserveRequestMock = jest.fn(async () => {
    throw new Error("an unready request must never reserve an idempotency record");
  });
  jest.doMock("../sia/idempotencyService", () => ({
    ...jest.requireActual("../sia/idempotencyService"),
    reserveRequest: reserveRequestMock,
  }));

  const app = require("../app");
  return { app, classifyIntentMock, buildContextMock, askLlmMock, createSessionMock, appendTurnMock, reserveRequestMock };
}

const post = (app, token, body) =>
  request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(body);

describe("POST /sia/ask -- Batch 3E readiness gate", () => {
  it.each([
    ["SIA disabled", { enabled: false }],
    ["missing credential", { credential: undefined }],
    ["blank credential", { credential: "   " }],
    ["missing model", { model: null }],
    ["blank model", { model: "  " }],
    ["unsupported provider", { provider: "anthropic" }],
    ["missing provider", { provider: null }],
  ])(
    "%s: returns the existing generic 503 and performs no classification, context build, LLM call, persistence, or reservation",
    async (_label, overrides) => {
      const {
        app,
        classifyIntentMock,
        buildContextMock,
        askLlmMock,
        createSessionMock,
        appendTurnMock,
        reserveRequestMock,
      } = loadApp(overrides);

      const res = await post(app, signToken("user-unready-1"), {
        question: QUESTION,
        clientMessageId: "key-unready-1",
      });

      // Byte-identical to the pre-existing unavailable contract -- no new
      // status code, no reason code, no configuration detail.
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });

      // No work performed at all.
      expect(classifyIntentMock).not.toHaveBeenCalled();
      expect(buildContextMock).not.toHaveBeenCalled();
      expect(askLlmMock).not.toHaveBeenCalled();
      expect(createSessionMock).not.toHaveBeenCalled();
      expect(appendTurnMock).not.toHaveBeenCalled();
      expect(reserveRequestMock).not.toHaveBeenCalled();

      // Nothing about the deployment leaks.
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(FAKE_CREDENTIAL);
      expect(raw).not.toContain("OPENAI_API_KEY");
      expect(raw).not.toContain("provider");
      expect(raw).not.toContain("model");
    }
  );

  it("a ready deployment still follows the existing successful workflow end to end", async () => {
    const { app, classifyIntentMock, buildContextMock, askLlmMock, appendTurnMock } = loadApp();

    const res = await post(app, signToken("user-ready-1"), { question: QUESTION });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.intent).toBe("HEALTH_EXPLANATION");
    expect(res.body.answer).toBe("Your financial health score is 75, reflecting Low overall risk.");
    // The full pipeline really ran.
    expect(classifyIntentMock).toHaveBeenCalledTimes(1);
    expect(buildContextMock).toHaveBeenCalledTimes(1);
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(appendTurnMock).toHaveBeenCalledTimes(1);
  });

  it("the readiness gate runs BEFORE request validation, so an unready deployment never reveals validation detail", async () => {
    const { app } = loadApp({ enabled: false });

    // A request that WOULD be a 400 on a ready deployment (missing question)
    // is answered with the same unavailable 503 instead -- the gate is first.
    const res = await post(app, signToken("user-unready-2"), {});

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("Batch 3D grounding behaviour is unchanged on a ready deployment (an invented figure is still rejected)", async () => {
    jest.resetModules();
    jest.doMock("../sia/config", () => ({ enabled: true, provider: "openai", model: "gpt-test", timeoutMs: 8000 }));
    process.env.OPENAI_API_KEY = FAKE_CREDENTIAL;

    const { classifyIntent } = jest.requireActual("../sia/intentClassifier");
    jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: jest.fn(classifyIntent) }));
    jest.doMock("../sia/contextBuilder", () => ({
      buildContext: jest.fn(async () => ({
        intent: "HEALTH_EXPLANATION",
        fields: { financialHealth: { overall: 75, risk: { label: "Low", color: "green" } } },
        sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
      })),
    }));
    const { LlmProviderError } = jest.requireActual("../sia/llmService");
    jest.doMock("../sia/llmService", () => ({
      askLlm: jest.fn(async () => ({
        answer: "Your health is affected by an invented charge of $999999.",
        model: "mock-model",
        latencyMs: 5,
      })),
      LlmProviderError,
    }));

    const app = require("../app");
    const res = await post(app, signToken("user-ready-grounding"), { question: QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    expect(JSON.stringify(res.body)).not.toContain("999999");
  });
});
