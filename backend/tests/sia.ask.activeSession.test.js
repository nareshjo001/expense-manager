// Batch 2 architecture closure: proves the ACTIVE session-store path
// through POST /sia/ask, not the disconnected/no-op branch.
// tests/sia.ask.test.js's 80 tests all run with
// mongoose.connection.readyState !== 1 (no real MongoDB), which proves
// backward compatibility but never exercises session creation, history
// loading, or persistence at all. This file forces
// mongoose.connection.readyState = 1 and mocks only
// sia/sessionService.js (the persistence boundary) plus the existing
// config/intentClassifier/contextBuilder/llmService boundaries -- so the
// controller's OWN active-path branching is genuinely exercised.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-ask-active-session-test-secret";
const originalJwtSecret = process.env.JWT_SECRET;

// Batch 3E: the controller's readiness gate additionally requires a
// non-blank provider credential. Obviously-fake placeholder, scoped to this
// suite and restored afterwards -- readiness checks PRESENCE, never format.
const FAKE_CREDENTIAL = "test-credential-value-not-a-real-key";
const originalOpenAiKey = process.env.OPENAI_API_KEY;

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.OPENAI_API_KEY = FAKE_CREDENTIAL;
});

afterAll(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
  if (originalOpenAiKey === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  }
});

let consoleLogSpy;
beforeEach(() => {
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  consoleLogSpy.mockRestore();
  jest.resetModules();
});

function signToken(userId) {
  return jwt.sign({ email: "sia-ask-active-session-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

const healthContext = () => ({
  intent: "HEALTH_EXPLANATION",
  fields: { financialHealth: { overall: 75, risk: { label: "Low", color: "green" } } },
  sourceReportGeneratedAt: "2026-08-08T00:00:00.000Z",
});

// Batch 3B.1: session resolution and session creation are now two
// separate service calls made at two different points in the request
// (lookup before the provider call so history can load; creation only
// AFTER a validated answer exists, so a failed turn leaves no empty
// conversation). These fixtures were updated to mock that exact pair --
// every assertion below is preserved, only the seam it observes moved.
// Session ids are now real ObjectId strings because the controller
// validates their shape and rejects malformed ones with 400.
const EXISTING_SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0d1";
const OTHER_SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0d2";

function loadActiveApp({
  buildContextImpl,
  askLlmImpl,
  findOwnedSessionImpl,
  createSessionImpl,
  appendTurnImpl,
  loadRecentTurnsImpl,
} = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({ enabled: true, provider: "openai", model: "sia-test-model", timeoutMs: 8000 }));

  const { classifyIntent: realClassifyIntent } = jest.requireActual("../sia/intentClassifier");
  jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: jest.fn(realClassifyIntent) }));

  const buildContextMock = jest.fn(buildContextImpl || (async () => healthContext()));
  jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

  const { LlmProviderError: RealLlmProviderError } = jest.requireActual("../sia/llmService");
  const askLlmMock = jest.fn(
    askLlmImpl || (async () => ({ answer: "Your health score is fine.", model: "mock-model", latencyMs: 5 }))
  );
  jest.doMock("../sia/llmService", () => ({ askLlm: askLlmMock, LlmProviderError: RealLlmProviderError }));

  const findOwnedSessionMock = jest.fn(
    findOwnedSessionImpl || (async (userId, sessionId) => ({ _id: sessionId, user: userId }))
  );
  const createSessionMock = jest.fn(
    createSessionImpl || (async (userId) => ({ _id: `sess-for-${userId}`, user: userId }))
  );
  const appendTurnMock = jest.fn(appendTurnImpl || (async () => ({ deduplicated: false })));
  const loadRecentTurnsMock = jest.fn(loadRecentTurnsImpl || (async () => []));
  jest.doMock("../sia/sessionService", () => ({
    findOwnedSession: findOwnedSessionMock,
    createSession: createSessionMock,
    getOrCreateSession: jest.fn(),
    appendTurn: appendTurnMock,
    loadRecentTurns: loadRecentTurnsMock,
    listSessions: jest.fn(async () => []),
    listMessages: jest.fn(async () => null),
    deleteSession: jest.fn(async () => false),
  }));

  // Forces the "connected" branch -- ask.js's isSessionStoreAvailable()
  // (imported from sia/sessionStoreAvailability.js) checks exactly this.
  // Deliberately does NOT touch the real, global `mongoose` singleton --
  // doing that would also affect every other model compiled elsewhere in
  // app.js's require graph (auth, expense, budget, etc.), which are never
  // actually connected in this Jest environment and would crash if
  // Mongoose believed otherwise. Mocking this one small module keeps the
  // rest of the application's real (disconnected) Mongoose behavior
  // completely untouched.
  jest.doMock("../sia/sessionStoreAvailability", () => ({
    isSessionStoreAvailable: () => true,
  }));

  const app = require("../app");
  return {
    app,
    buildContextMock,
    askLlmMock,
    findOwnedSessionMock,
    createSessionMock,
    appendTurnMock,
    loadRecentTurnsMock,
  };
}

describe("POST /sia/ask -- active session path: new conversation", () => {
  it("creates a session (no client sessionId), fetches the report by authenticated identity, persists exactly one completed turn, and returns sessionId additively", async () => {
    const { app, buildContextMock, createSessionMock, appendTurnMock } = loadActiveApp();
    const token = signToken("user-active-1");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?" });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe("sess-for-user-active-1");
    // All existing response fields remain present alongside the additive one.
    expect(res.body).toMatchObject({ success: true, intent: "HEALTH_EXPLANATION" });

    // Batch 3G: a brand-new conversation's first successfully answered
    // question is now also passed through so the session can be created
    // with a deterministic, local title in the same insert -- see
    // sia.sessionTitle.test.js and sia.sessionService.test.js's
    // "createSession title persistence" suite for the derivation itself.
    expect(createSessionMock).toHaveBeenCalledWith("user-active-1", "Why is my financial health score low?");
    expect(buildContextMock).toHaveBeenCalledWith("user-active-1", "HEALTH_EXPLANATION");

    expect(appendTurnMock).toHaveBeenCalledTimes(1);
    const [appendArgs] = appendTurnMock.mock.calls[0];
    expect(appendArgs).toMatchObject({
      sessionId: "sess-for-user-active-1",
      userId: "user-active-1",
      question: "Why is my financial health score low?",
      intent: "HEALTH_EXPLANATION",
      answer: "Your health score is fine.",
    });
  });
});

describe("POST /sia/ask -- active session path: existing conversation", () => {
  it("uses the supplied sessionId (ownership resolved inside sessionService), loads bounded history, and passes it into the LLM orchestration -- not merely available", async () => {
    const priorTurns = [
      { role: "user", content: "Earlier question", intent: "HEALTH_EXPLANATION" },
      { role: "assistant", content: "Earlier answer", intent: "HEALTH_EXPLANATION" },
    ];
    const { app, askLlmMock, findOwnedSessionMock, loadRecentTurnsMock } = loadActiveApp({
      findOwnedSessionImpl: async (userId, sessionId) => ({ _id: sessionId, user: userId }),
      loadRecentTurnsImpl: async () => priorTurns,
    });
    const token = signToken("user-active-2");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?", sessionId: EXISTING_SESSION_ID });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(EXISTING_SESSION_ID);
    expect(findOwnedSessionMock).toHaveBeenCalledWith("user-active-2", EXISTING_SESSION_ID);
    expect(loadRecentTurnsMock).toHaveBeenCalledWith(EXISTING_SESSION_ID, "user-active-2");

    // The critical proof: history reached askLlm's actual call arguments,
    // not just sessionService's own return value.
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    const [askArgs] = askLlmMock.mock.calls[0];
    expect(askArgs.history).toEqual(priorTurns);
  });

  it("still fetches the latest canonical report fresh every turn -- history is never a substitute source of current facts", async () => {
    const { app, buildContextMock } = loadActiveApp({
      loadRecentTurnsImpl: async () => [{ role: "user", content: "old question about health" }],
    });
    const token = signToken("user-active-3");

    await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?", sessionId: OTHER_SESSION_ID });

    expect(buildContextMock).toHaveBeenCalledTimes(1);
    expect(buildContextMock).toHaveBeenCalledWith("user-active-3", "HEALTH_EXPLANATION");
  });
});

describe("POST /sia/ask -- active session path: failure paths", () => {
  it("a provider failure persists no completed turn, and creates no empty session", async () => {
    const { app, appendTurnMock, createSessionMock } = loadActiveApp({
      askLlmImpl: async () => {
        const { LlmProviderError } = jest.requireActual("../sia/llmService");
        throw new LlmProviderError("boom", { code: "PROVIDER_TIMEOUT", provider: "openai" });
      },
    });
    const token = signToken("user-active-4");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?" });

    expect(res.status).toBe(503);
    expect(appendTurnMock).not.toHaveBeenCalled();
    // Batch 3B.1: session creation is deferred until a validated answer
    // exists, so a failed first turn leaves no empty conversation behind.
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it("a no-data response on an EXISTING session persists no completed turn, but still returns the additive sessionId", async () => {
    const { app, appendTurnMock } = loadActiveApp({
      buildContextImpl: async () => ({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" }),
    });
    const token = signToken("user-active-5");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?", sessionId: EXISTING_SESSION_ID });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(EXISTING_SESSION_ID);
    expect(appendTurnMock).not.toHaveBeenCalled();
  });

  it("a no-data response on a NEW conversation creates no empty session", async () => {
    const { app, appendTurnMock, createSessionMock } = loadActiveApp({
      buildContextImpl: async () => ({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" }),
    });
    const token = signToken("user-active-5b");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // No turn exists to store, so an empty conversation would be pure
    // noise in the user's history.
    expect(createSessionMock).not.toHaveBeenCalled();
    expect(res.body.sessionId).toBeUndefined();
    expect(appendTurnMock).not.toHaveBeenCalled();
  });

  it("a grounded-response validation rejection persists no completed turn", async () => {
    const { app, appendTurnMock } = loadActiveApp({
      buildContextImpl: async () => ({
        intent: "SPENDING_FORECAST_EXPLANATION",
        fields: { forecast: { hasData: true, nextMonthForecast: { hasData: true, estimate: 1000, range: { lower: 800, upper: 1200 } } } },
        sourceReportGeneratedAt: "2026-08-08T00:00:00.000Z",
      }),
      askLlmImpl: async () => ({ answer: "Next month you'll spend $999999.", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-active-6");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "What is my spending forecast for next month?" });

    expect(res.status).toBe(503);
    expect(appendTurnMock).not.toHaveBeenCalled();
  });

  it("a session-store failure (e.g. createSession throws) degrades to the pre-existing no-session behavior, not a failed request", async () => {
    const { app, appendTurnMock } = loadActiveApp({
      createSessionImpl: async () => {
        throw new Error("db unavailable");
      },
    });
    const token = signToken("user-active-7");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?" });

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBeUndefined();
    expect(appendTurnMock).not.toHaveBeenCalled();
  });

  it("a persistence failure during appendTurn never falsely claims history was saved -- the response is unaffected either way", async () => {
    const { app } = loadActiveApp({
      appendTurnImpl: async () => {
        throw new Error("write failed");
      },
    });
    const token = signToken("user-active-8");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?" });

    // The user's answer is unaffected by the persistence failure -- no
    // error surfaces, no different status code, no different body shape.
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessionId).toBeDefined();
  });
});

describe("POST /sia/ask -- active session path: request-body identity cannot be overridden", () => {
  it("a request-body userId is never used as the identity passed to createSession/buildContext", async () => {
    const { app, createSessionMock, buildContextMock } = loadActiveApp();
    const token = signToken("user-active-9");

    await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?", userId: "attacker-controlled-id" });

    expect(createSessionMock).toHaveBeenCalledWith("user-active-9", "Why is my financial health score low?");
    expect(buildContextMock).toHaveBeenCalledWith("user-active-9", "HEALTH_EXPLANATION");
  });
});
