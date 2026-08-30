// Batch 3F: answer-grounding transparency, proved end-to-end through
// POST /sia/ask and GET /sia/sessions/:sessionId/messages.
//
// Complements backend/tests/sia.grounding.test.js (groundingService.js in
// isolation) and leaves backend/tests/sia.ask.grounding.test.js (Batch 3D's
// grounded-ANSWER-VALIDATION suite -- a completely different concept: does
// the LLM's answer text stay truthful to the context, not "which sections
// were used") entirely untouched.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const mongoose = require("mongoose");

// Required ONCE, at module load, before any jest.resetModules() call below.
// These are used only to produce genuinely model-serialized grounding
// fixtures (see MODEL_SERIALIZED_* below) -- never to touch a database.
const SiaMessageModel = require("../models/SiaMessage");
const SiaRequestModel = require("../models/SiaRequest");
const { buildGroundingSnapshot: realBuildGroundingSnapshot } = require("../sia/groundingService");

const TEST_JWT_SECRET = "sia-grounding-transparency-test-secret";
const originalJwtSecret = process.env.JWT_SECRET;
const FAKE_CREDENTIAL = "test-credential-value-not-a-real-key";
const originalOpenAiKey = process.env.OPENAI_API_KEY;

const QUESTION = "Why is my financial health score low?";
const EXISTING_SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0d1";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  process.env.OPENAI_API_KEY = FAKE_CREDENTIAL;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
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
  return jwt.sign({ email: "sia-grounding-transparency@example.test", _id: userId }, TEST_JWT_SECRET);
}

const READY_CONFIG = { enabled: true, provider: "openai", model: "gpt-test", timeoutMs: 8000 };

// Loads the app with the full active session-store path connected (mirrors
// tests/sia.ask.activeSession.test.js's own convention), so appendTurn is
// genuinely exercised rather than skipped as "session store unavailable".
function loadApp({
  configOverrides,
  buildContextImpl,
  askLlmImpl,
  findOwnedSessionImpl,
  createSessionImpl,
  appendTurnImpl,
  idempotencyOverrides,
} = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({ ...READY_CONFIG, ...configOverrides }));

  const { classifyIntent: realClassifyIntent } = jest.requireActual("../sia/intentClassifier");
  jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: jest.fn(realClassifyIntent) }));

  const buildContextMock = jest.fn(
    buildContextImpl ||
      (async () => ({
        intent: "HEALTH_EXPLANATION",
        fields: {
          financialHealth: { overall: 75, risk: { label: "Low", color: "green" } },
          summary: { healthScore: 75, riskLevel: "Low" },
        },
        sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
      }))
  );
  jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

  const { LlmProviderError } = jest.requireActual("../sia/llmService");
  const askLlmMock = jest.fn(
    askLlmImpl || (async () => ({ answer: "Your health score is fine.", model: "mock-model", latencyMs: 5 }))
  );
  jest.doMock("../sia/llmService", () => ({ askLlm: askLlmMock, LlmProviderError }));

  const findOwnedSessionMock = jest.fn(
    findOwnedSessionImpl || (async (userId, sessionId) => ({ _id: sessionId, user: userId }))
  );
  const createSessionMock = jest.fn(createSessionImpl || (async (userId) => ({ _id: `sess-${userId}`, user: userId })));
  const appendTurnMock = jest.fn(appendTurnImpl || (async () => ({ deduplicated: false })));
  jest.doMock("../sia/sessionService", () => ({
    findOwnedSession: findOwnedSessionMock,
    createSession: createSessionMock,
    getOrCreateSession: jest.fn(),
    appendTurn: appendTurnMock,
    loadRecentTurns: jest.fn(async () => []),
    listSessions: jest.fn(async () => []),
    listMessages: jest.fn(async () => null),
    deleteSession: jest.fn(async () => false),
  }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => true }));

  const realIdempotency = jest.requireActual("../sia/idempotencyService");
  const reserveRequestMock = jest.fn(
    (idempotencyOverrides && idempotencyOverrides.reserveRequest) ||
      (async () => {
        throw new Error("reserveRequest should not be called without clientMessageId in these tests");
      })
  );
  const markAnswerReadyMock = jest.fn((idempotencyOverrides && idempotencyOverrides.markAnswerReady) || (async () => {}));
  const markCompletedMock = jest.fn((idempotencyOverrides && idempotencyOverrides.markCompleted) || (async () => {}));
  const releaseRequestMock = jest.fn(async () => {});
  jest.doMock("../sia/idempotencyService", () => ({
    ...realIdempotency,
    reserveRequest: reserveRequestMock,
    markAnswerReady: markAnswerReadyMock,
    markCompleted: markCompletedMock,
    releaseRequest: releaseRequestMock,
  }));

  const app = require("../app");
  return {
    app,
    buildContextMock,
    askLlmMock,
    findOwnedSessionMock,
    createSessionMock,
    appendTurnMock,
    reserveRequestMock,
    markAnswerReadyMock,
    markCompletedMock,
  };
}

const post = (app, token, body) =>
  request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(body);

describe("POST /sia/ask -- grounding transparency (Batch 3F)", () => {
  it("returns a grounding snapshot matching exactly the sections present in the context sent to the provider", async () => {
    const { app } = loadApp();
    const res = await post(app, signToken("user-1"), { question: QUESTION });

    expect(res.status).toBe(200);
    // sourceReportGeneratedAt ("2026-08-09T00:00:00.000Z" above) is the
    // report's generation timestamp, not either section's reporting period
    // -- it must never surface as `period` (Batch 3F acceptance
    // remediation). Neither financialHealth nor summary currently exposes
    // its own authoritative period field, so both sources correctly omit it.
    expect(res.body.grounding).toEqual({
      sources: [
        { key: "financialHealth", label: "Financial health analysis" },
        { key: "summary", label: "Financial summary" },
      ],
    });
    // basedOn (Batch 3D/M3-4) is completely unaffected.
    expect(res.body.basedOn).toEqual([
      "financialHealth",
      "financialHealth.overall",
      "financialHealth.risk.label",
    ]);
  });

  it("a selected-but-absent section is never listed, even though the classifier chose that intent", async () => {
    const { app } = loadApp({
      buildContextImpl: async () => ({
        intent: "HEALTH_EXPLANATION",
        // Only financialHealth this time -- summary is absent, unlike the
        // normal HEALTH_EXPLANATION shape.
        fields: { financialHealth: { overall: 40, risk: { label: "High", color: "red" } } },
        sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
      }),
    });
    const res = await post(app, signToken("user-2"), { question: QUESTION });

    expect(res.body.grounding.sources.map((s) => s.key)).toEqual(["financialHealth"]);
  });

  it("no raw analytics values, prompts, or identifiers appear anywhere in the grounding object", async () => {
    const { app } = loadApp({
      buildContextImpl: async () => ({
        intent: "CATEGORY_SPENDING_EXPLANATION",
        fields: {
          categories: {
            topCategory: { category: "Secret Category Name", total: 123456.78 },
            categoryDistribution: [{ category: "Secret Category Name", amount: 123456.78, percentage: 99.9 }],
          },
        },
        sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
      }),
    });
    const res = await post(app, signToken("user-3"), { question: "Which category am I spending the most on?" });

    const serialized = JSON.stringify(res.body.grounding);
    expect(serialized).not.toContain("Secret Category Name");
    expect(serialized).not.toContain("123456");
    expect(serialized).not.toContain("99.9");
    expect(serialized).not.toContain(FAKE_CREDENTIAL);
    expect(serialized).not.toContain("user-3");
  });

  it("client-supplied grounding in the request body is completely ignored -- the server-computed value always wins", async () => {
    const { app } = loadApp();
    const res = await post(app, signToken("user-4"), {
      question: QUESTION,
      grounding: { sources: [{ key: "financialHealth", label: "FORGED LABEL", period: "1999-01-01" }] },
    });

    expect(res.status).toBe(200);
    const labels = res.body.grounding.sources.map((s) => s.label);
    expect(labels).not.toContain("FORGED LABEL");
    expect(res.body.grounding.sources.find((s) => s.key === "financialHealth").label).toBe(
      "Financial health analysis"
    );
  });

  it("the exact same grounding snapshot returned in the response is what gets persisted via appendTurn", async () => {
    const { app, appendTurnMock } = loadApp();
    const res = await post(app, signToken("user-5"), { question: QUESTION });

    expect(appendTurnMock).toHaveBeenCalledTimes(1);
    const [args] = appendTurnMock.mock.calls[0];
    expect(args.grounding).toEqual(res.body.grounding);
  });

  it("a brand-new conversation (no sessionId) still returns and persists grounding", async () => {
    const { app, appendTurnMock, createSessionMock } = loadApp();
    const res = await post(app, signToken("user-6"), { question: QUESTION });

    expect(createSessionMock).toHaveBeenCalledTimes(1);
    expect(res.body.grounding.sources.length).toBeGreaterThan(0);
    expect(appendTurnMock.mock.calls[0][0].grounding).toEqual(res.body.grounding);
  });

  it("continuing an existing session also returns and persists grounding", async () => {
    const { app, appendTurnMock } = loadApp();
    const res = await post(app, signToken("user-7"), { question: QUESTION, sessionId: EXISTING_SESSION_ID });

    expect(res.body.sessionId).toBe(EXISTING_SESSION_ID);
    expect(res.body.grounding.sources.length).toBeGreaterThan(0);
    expect(appendTurnMock.mock.calls[0][0].grounding).toEqual(res.body.grounding);
  });

  it("a no-data response (fields === null) carries no grounding, and appendTurn is never called", async () => {
    const { app, appendTurnMock } = loadApp({
      buildContextImpl: async () => ({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" }),
    });
    const res = await post(app, signToken("user-8"), { question: QUESTION });

    expect(res.status).toBe(200);
    expect(res.body.grounding).toBeUndefined();
    expect(appendTurnMock).not.toHaveBeenCalled();
  });

  it("an unready deployment exits before context building -- and therefore before any grounding is ever computed", async () => {
    const { app, buildContextMock } = loadApp({ configOverrides: { enabled: false } });
    const res = await post(app, signToken("user-9"), { question: QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    expect(buildContextMock).not.toHaveBeenCalled();
  });

  it("idempotent REPLAY_COMPLETED returns the exact previously-stored grounding, unchanged", async () => {
    const storedPayload = {
      success: true,
      answer: "Your health score is fine.",
      intent: "HEALTH_EXPLANATION",
      basedOn: ["financialHealth"],
      grounding: { sources: [{ key: "financialHealth", label: "Financial health analysis", period: "2026-08-09" }] },
      sessionId: EXISTING_SESSION_ID,
    };
    const { app, buildContextMock } = loadApp({
      idempotencyOverrides: {
        reserveRequest: async () => ({
          outcome: "REPLAY_COMPLETED",
          record: { responseStatus: 200, responsePayload: storedPayload },
        }),
      },
    });

    const res = await post(app, signToken("user-10"), { question: QUESTION, clientMessageId: "replay-key-1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(storedPayload);
    // A pure replay never touches context building again.
    expect(buildContextMock).not.toHaveBeenCalled();
  });

  it("idempotent RESUME_ANSWER_READY reconstructs the response with the SAME grounding stored at answer-ready time, without recomputing it", async () => {
    const storedGrounding = {
      sources: [{ key: "financialHealth", label: "Financial health analysis", period: "2026-08-01" }],
    };
    const { app, appendTurnMock, buildContextMock } = loadApp({
      idempotencyOverrides: {
        reserveRequest: async () => ({
          outcome: "RESUME_ANSWER_READY",
          record: {
            _id: "req-resume-1",
            answer: "Your health score is fine.",
            intent: "HEALTH_EXPLANATION",
            session: null,
            grounding: storedGrounding,
          },
          ownerToken: "owner-token-1",
        }),
      },
    });

    const res = await post(app, signToken("user-11"), { question: QUESTION, clientMessageId: "resume-key-1" });

    expect(res.status).toBe(200);
    expect(res.body.grounding).toEqual(storedGrounding);
    expect(appendTurnMock.mock.calls[0][0].grounding).toEqual(storedGrounding);
    // The resume path never rebuilds context or recomputes grounding from
    // (possibly since-changed) current analytics.
    expect(buildContextMock).not.toHaveBeenCalled();
  });
});

describe("GET /sia/sessions/:sessionId/messages -- grounding transparency (Batch 3F)", () => {
  function loadSessionsApp(listMessagesImpl) {
    jest.resetModules();
    jest.doMock("../sia/config", () => READY_CONFIG);
    jest.doMock("../sia/sessionService", () => ({
      findOwnedSession: jest.fn(),
      createSession: jest.fn(),
      getOrCreateSession: jest.fn(),
      appendTurn: jest.fn(),
      loadRecentTurns: jest.fn(async () => []),
      listSessions: jest.fn(async () => []),
      listMessages: jest.fn(listMessagesImpl),
      deleteSession: jest.fn(async () => false),
    }));
    return require("../app");
  }

  it("returns the exact stored grounding snapshot for an assistant message that has one", async () => {
    const grounding = { sources: [{ key: "risk", label: "Financial risk signals", period: "2026-08-01" }] };
    const app = loadSessionsApp(async () => ({
      session: { _id: EXISTING_SESSION_ID },
      messages: [
        { role: "user", content: "What is my risk?", intent: "FINANCIAL_RISK_EXPLANATION", createdAt: new Date() },
        {
          role: "assistant",
          content: "Your risk is low.",
          intent: "FINANCIAL_RISK_EXPLANATION",
          createdAt: new Date(),
          grounding,
        },
      ],
    }));

    const res = await request(app)
      .get(`/sia/sessions/${EXISTING_SESSION_ID}/messages`)
      .set("Authorization", `Bearer ${signToken("user-12")}`);

    expect(res.status).toBe(200);
    expect(res.body.messages[0].grounding).toBeUndefined();
    expect(res.body.messages[1].grounding).toEqual(grounding);
  });

  it("an existing/legacy message with no grounding field still works and renders no grounding key", async () => {
    const app = loadSessionsApp(async () => ({
      session: { _id: EXISTING_SESSION_ID },
      messages: [
        { role: "user", content: "Old question", intent: "HEALTH_EXPLANATION", createdAt: new Date() },
        { role: "assistant", content: "Old answer", intent: "HEALTH_EXPLANATION", createdAt: new Date() },
      ],
    }));

    const res = await request(app)
      .get(`/sia/sessions/${EXISTING_SESSION_ID}/messages`)
      .set("Authorization", `Bearer ${signToken("user-13")}`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[1]).not.toHaveProperty("grounding");
  });
});

// ---------------------------------------------------------------------
// Batch 3F pre-commit remediation: strict grounding-shape equivalence
// across ALL FOUR response paths.
// ---------------------------------------------------------------------
// The acceptance audit found that `period: { default: null }` on both
// grounding subdocument schemas made persisted snapshots differ from
// freshly generated ones (`{key,label}` vs `{key,label,period:null}`).
// The defaults were removed. These tests prove the fix at the ROUTE
// boundary, and -- critically -- the persistence-path fixtures below are
// produced by running a real grounding snapshot through real Mongoose
// document construction and serialization, NOT by transcribing an expected
// shape by hand. A handwritten fixture would have silently agreed with
// whatever the schema did; a model-serialized one cannot.
describe("grounding shape is strictly identical across fresh / resume / replay / history (Batch 3F pre-commit remediation)", () => {
  // The genuine snapshot the fresh path produces for the standard
  // HEALTH_EXPLANATION context used by loadApp()'s default buildContext.
  const FRESH_GROUNDING = realBuildGroundingSnapshot({
    intent: "HEALTH_EXPLANATION",
    fields: {
      financialHealth: { overall: 75, risk: { label: "Low", color: "green" } },
      summary: { healthScore: 75, riskLevel: "Low" },
    },
    sourceReportGeneratedAt: "2026-08-09T00:00:00.000Z",
  });

  // The SAME snapshot after a real round-trip through each persistence
  // schema -- exactly what markAnswerReady()/appendTurn() would hand back
  // on the resume and history paths respectively.
  const MODEL_SERIALIZED_VIA_REQUEST = new SiaRequestModel({
    user: new mongoose.Types.ObjectId(),
    clientMessageId: "shape-key",
    questionFingerprint: "d".repeat(64),
    grounding: FRESH_GROUNDING,
  }).toObject().grounding;

  const MODEL_SERIALIZED_VIA_MESSAGE = new SiaMessageModel({
    session: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    role: "assistant",
    content: "Your health score is fine.",
    intent: "HEALTH_EXPLANATION",
    grounding: FRESH_GROUNDING,
  }).toObject().grounding;

  function loadSessionsAppFor(messages) {
    jest.resetModules();
    jest.doMock("../sia/config", () => READY_CONFIG);
    jest.doMock("../sia/sessionService", () => ({
      findOwnedSession: jest.fn(),
      createSession: jest.fn(),
      getOrCreateSession: jest.fn(),
      appendTurn: jest.fn(),
      loadRecentTurns: jest.fn(async () => []),
      listSessions: jest.fn(async () => []),
      listMessages: jest.fn(async () => ({ session: { _id: EXISTING_SESSION_ID }, messages })),
      deleteSession: jest.fn(async () => false),
    }));
    return require("../app");
  }

  // Split into four single-app-load tests (was one test cold-reloading the
  // app FOUR times) -- each reload costs 25-50s in this sandbox (this
  // file's loadApp() additionally pulls in the real, unmocked
  // financialQueryService.js -> real Mongoose models via ask.js's
  // unconditional semanticPipeline.js require, which is measurably slower
  // to first-load than sia.ask.test.js's fully-mocked equivalent), so four
  // sequential reloads in one test could exceed even a generous scoped
  // timeout, and in this sandbox reliably exceeds what a single command
  // invocation can observe complete. Splitting -- rather than just raising
  // the timeout further -- keeps each test's wall-clock bounded to ONE
  // reload. No assertion was removed: every path still proves (a) no
  // `period` property on any source, (b) the exact `{key,label}` key set,
  // and (c) strict equality with the SAME authoritative expected shape
  // every path was compared against before (previously via a live
  // "fresh" response; here via FRESH_GROUNDING itself, the identical pure
  // computation the live fresh path would also have produced -- proven by
  // the dedicated "fresh /sia/ask" test below, which still hits the real
  // route end-to-end exactly as before).
  function expectNoPeriodAndMatchesFreshShape(body) {
    expect(body).toBeDefined();
    expect(body.sources.length).toBeGreaterThan(0);
    for (const source of body.sources) {
      expect(source).not.toHaveProperty("period");
      expect(Object.keys(source).sort()).toEqual(["key", "label"]);
    }
    expect(body).toStrictEqual(FRESH_GROUNDING);
    expect(JSON.stringify(body)).toBe(JSON.stringify(FRESH_GROUNDING));
  }

  it(
    "fresh /sia/ask carries no period property and matches the pure buildGroundingSnapshot output",
    async () => {
      const { app: freshApp } = loadApp();
      const freshRes = await post(freshApp, signToken("shape-1"), { question: QUESTION });
      expect(freshRes.status).toBe(200);
      expectNoPeriodAndMatchesFreshShape(freshRes.body.grounding);
    },
    60000
  );

  it(
    "RESUME_ANSWER_READY (fed model-serialized data) carries no period property and matches",
    async () => {
      const { app: resumeApp } = loadApp({
        idempotencyOverrides: {
          reserveRequest: async () => ({
            outcome: "RESUME_ANSWER_READY",
            record: {
              _id: "req-shape-1",
              answer: "Your health score is fine.",
              intent: "HEALTH_EXPLANATION",
              session: null,
              grounding: MODEL_SERIALIZED_VIA_REQUEST,
            },
            ownerToken: "owner-shape-1",
          }),
        },
      });
      const resumeRes = await post(resumeApp, signToken("shape-2"), {
        question: QUESTION,
        clientMessageId: "shape-resume-key",
      });
      expect(resumeRes.status).toBe(200);
      expectNoPeriodAndMatchesFreshShape(resumeRes.body.grounding);
    },
    60000
  );

  it(
    "REPLAY_COMPLETED (payload a real completed attempt would have stored verbatim) carries no period property and matches",
    async () => {
      // Built directly, not from a live "fresh" response, so this test
      // needs only ONE app load -- the exact shape a real completed first
      // attempt would have persisted (success/answer/intent/basedOn/
      // grounding), using the SAME FRESH_GROUNDING constant path 1
      // independently proves the real route also produces.
      const storedFreshPayload = {
        success: true,
        answer: "Your health score is fine.",
        intent: "HEALTH_EXPLANATION",
        basedOn: ["financialHealth", "financialHealth.overall", "financialHealth.risk.label"],
        grounding: FRESH_GROUNDING,
      };
      const { app: replayApp } = loadApp({
        idempotencyOverrides: {
          reserveRequest: async () => ({
            outcome: "REPLAY_COMPLETED",
            record: { responseStatus: 200, responsePayload: { ...storedFreshPayload } },
          }),
        },
      });
      const replayRes = await post(replayApp, signToken("shape-3"), {
        question: QUESTION,
        clientMessageId: "shape-replay-key",
      });
      expect(replayRes.status).toBe(200);
      expectNoPeriodAndMatchesFreshShape(replayRes.body.grounding);
    },
    60000
  );

  it(
    "session history (fed model-serialized data) carries no period property and matches",
    async () => {
      const historyApp = loadSessionsAppFor([
        {
          role: "assistant",
          content: "Your health score is fine.",
          intent: "HEALTH_EXPLANATION",
          createdAt: new Date(),
          grounding: MODEL_SERIALIZED_VIA_MESSAGE,
        },
      ]);
      const historyRes = await request(historyApp)
        .get(`/sia/sessions/${EXISTING_SESSION_ID}/messages`)
        .set("Authorization", `Bearer ${signToken("shape-4")}`);
      expect(historyRes.status).toBe(200);
      expectNoPeriodAndMatchesFreshShape(historyRes.body.messages[0].grounding);
    },
    60000
  );

  it("an explicitly supplied valid period survives the resume and history paths unchanged", async () => {
    const withPeriod = { sources: [{ key: "budget", label: "Budget status", period: "2026-08" }] };
    const viaRequest = new SiaRequestModel({
      user: new mongoose.Types.ObjectId(),
      clientMessageId: "shape-period-key",
      questionFingerprint: "e".repeat(64),
      grounding: withPeriod,
    }).toObject().grounding;

    const { app: resumeApp } = loadApp({
      idempotencyOverrides: {
        reserveRequest: async () => ({
          outcome: "RESUME_ANSWER_READY",
          record: {
            _id: "req-shape-2",
            answer: "Budget answer.",
            intent: "BUDGET_STATUS_EXPLANATION",
            session: null,
            grounding: viaRequest,
          },
          ownerToken: "owner-shape-2",
        }),
      },
    });
    const resumeRes = await post(resumeApp, signToken("shape-5"), {
      question: QUESTION,
      clientMessageId: "shape-period-resume",
    });

    expect(resumeRes.status).toBe(200);
    expect(resumeRes.body.grounding).toStrictEqual(withPeriod);
    expect(resumeRes.body.grounding.sources[0].period).toBe("2026-08");
  });
});
