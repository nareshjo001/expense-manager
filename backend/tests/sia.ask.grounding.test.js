// Batch 2 architecture closure: proves grounded-response validation is
// actually wired into POST /sia/ask for the three Batch 2 intents -- not
// just unit-tested in isolation (see tests/sia.responseValidator.test.js).
// Mirrors tests/sia.ask.test.js's exact loadApp() isolation pattern.
//
// Batch 3D extends this same controller-level proof to the four original
// intents (HEALTH_EXPLANATION, SPENDING_CHANGE_EXPLANATION,
// BUDGET_STATUS_EXPLANATION, CATEGORY_SPENDING_EXPLANATION), which are now
// validated identically -- see the "Batch 3D" describe blocks below.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-ask-grounding-test-secret";
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
  return jwt.sign({ email: "sia-ask-grounding-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

function loadApp({ buildContextImpl, askLlmImpl } = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({ enabled: true, provider: "openai", model: "sia-test-model", timeoutMs: 8000 }));

  const { classifyIntent: realClassifyIntent } = jest.requireActual("../sia/intentClassifier");
  jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: jest.fn(realClassifyIntent) }));

  const buildContextMock = jest.fn(buildContextImpl);
  jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

  const { LlmProviderError: RealLlmProviderError } = jest.requireActual("../sia/llmService");
  const askLlmMock = jest.fn(askLlmImpl);
  jest.doMock("../sia/llmService", () => ({ askLlm: askLlmMock, LlmProviderError: RealLlmProviderError }));

  const app = require("../app");
  return { app, buildContextMock, askLlmMock };
}

const forecastContext = () => ({
  intent: "SPENDING_FORECAST_EXPLANATION",
  fields: {
    forecast: {
      hasData: true,
      nextMonthForecast: { hasData: true, isEstimate: true, estimate: 1200, range: { lower: 1000, upper: 1400 } },
    },
  },
  sourceReportGeneratedAt: "2026-08-08T00:00:00.000Z",
});

// Batch 3D: real contextFields shapes for the four newly-validated
// intents, matching the exact production shapes confirmed in
// backend/sia/contextBuilder.js (and the same fixtures
// tests/sia.ask.test.js / tests/sia.responseValidator.test.js already use
// for these intents).
const healthContext = () => ({
  intent: "HEALTH_EXPLANATION",
  fields: {
    financialHealth: { overall: 75, risk: { label: "Low", color: "green" } },
    summary: { healthScore: 75, riskLevel: "Low" },
  },
  sourceReportGeneratedAt: "2026-08-08T00:00:00.000Z",
});

const spendingChangeContext = () => ({
  intent: "SPENDING_CHANGE_EXPLANATION",
  fields: {
    trends: { monthlyTrend: [{ month: "2025-12", total: 900 }, { month: "2026-01", total: 1200 }] },
    summary: { comparePastMonth: { changePercent: 33.3, direction: "increase" }, totalSpent: 1200 },
  },
  sourceReportGeneratedAt: "2026-08-08T00:00:00.000Z",
});

const budgetContext = () => ({
  intent: "BUDGET_STATUS_EXPLANATION",
  fields: {
    budget: {
      budget: 5000,
      spent: 3200,
      hasBudget: true,
      status: "Warning",
      isOverspent: false,
      exceededBy: 0,
      utilization: 64,
      remainingBudget: 1800,
      budgetLeft: 36,
      projectionStatus: "AtRisk",
      projectionReliable: true,
      projectedSpent: 4300,
      projectedOverspend: 0,
      projectedOverspendPercent: 0,
    },
  },
  sourceReportGeneratedAt: "2026-08-08T00:00:00.000Z",
});

const categoryContext = () => ({
  intent: "CATEGORY_SPENDING_EXPLANATION",
  fields: {
    categories: {
      topCategory: { category: "Groceries", total: 1234.56 },
      leastCategory: { category: "Books", total: 12.34 },
      categoryDistribution: [
        { category: "Groceries", amount: 1234.56, percentage: 61.7 },
        { category: "Rent", amount: 700, percentage: 35 },
        { category: "Books", amount: 12.34, percentage: 3.3 },
      ],
      concentrationIndex: 49.2,
      top3Concentration: 100,
      categoryGrowth: [
        { category: "Groceries", previous: 1000, current: 1234.56, change: 234.56, growthPercentage: 23.46, isNewCategory: false, trend: "up" },
        { category: "Books", previous: 0, current: 12.34, change: 12.34, growthPercentage: null, isNewCategory: true, trend: "up" },
      ],
    },
  },
  sourceReportGeneratedAt: "2026-08-08T00:00:00.000Z",
});

// One row per newly-validated intent: its context builder, its matching
// question (so classifyIntent routes correctly), a legitimately grounded
// answer, and an answer carrying an invented currency figure absent from
// that context.
const NEWLY_VALIDATED_CASES = [
  {
    intent: "HEALTH_EXPLANATION",
    question: "Why is my financial health score low?",
    context: healthContext,
    legitAnswer: "Your financial health score is 75, reflecting Low overall risk.",
    inventedAnswer: "Your financial health is affected by an unexplained charge of $999999.",
  },
  {
    intent: "SPENDING_CHANGE_EXPLANATION",
    question: "Why did my spending increase?",
    context: spendingChangeContext,
    legitAnswer: "Your spending is now $1200 this month, up from $900 last month.",
    inventedAnswer: "Your spending increase includes an invented charge of $999999.",
  },
  {
    intent: "BUDGET_STATUS_EXPLANATION",
    question: "Explain my current budget status.",
    context: budgetContext,
    legitAnswer: "You have $1800 remaining on your budget, at 64% utilization.",
    inventedAnswer: "Your budget status includes an invented overspend of $999999.",
  },
  {
    intent: "CATEGORY_SPENDING_EXPLANATION",
    question: "Which category am I spending the most on?",
    context: categoryContext,
    legitAnswer: "Groceries is your top category at $1234.56 this month.",
    inventedAnswer: "Groceries spending includes an invented figure of $999999.",
  },
];

// Semantic-accuracy remediation: hoisted to module scope (originally
// defined inside the "Batch 3D: grounding rejection + idempotency
// interaction" describe block below) so both that describe block and the
// new "validator checks are wired end-to-end" describe block above can
// share the identical harness. Behavior is byte-for-byte unchanged from
// the original in-describe definitions -- this is a pure scope move.
//
// Note: findOneAndUpdate is required here too, not just
// create/findOne/deleteOne -- the SUCCESSFUL retry path this suite also
// exercises reaches idempotencyService.markCompleted(), which is a
// findOneAndUpdate compare-and-set (see backend/sia/idempotencyService.js).
// Only the initial REJECTED call stays confined to create/deleteOne.
function createMinimalSiaRequestFake() {
  const docs = [];
  let nextId = 1;

  const matches = (doc, filter) =>
    Object.keys(filter).every((key) => String(doc[key]) === String(filter[key]));

  return {
    async findOne(filter) {
      return docs.find((d) => matches(d, filter)) || null;
    },
    async create(attrs) {
      const clash = docs.find((d) => String(d.user) === String(attrs.user) && d.clientMessageId === attrs.clientMessageId);
      if (clash) throw Object.assign(new Error("E11000 duplicate key error"), { code: 11000 });
      const doc = { _id: `req-${nextId++}`, ...attrs };
      docs.push(doc);
      return doc;
    },
    async findOneAndUpdate(filter, update) {
      // Compare-and-set, exactly as the real model's contract requires:
      // only a caller whose filter (including the exact prior
      // ownerToken) still matches may mutate.
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return null;
      Object.assign(doc, update.$set);
      return doc;
    },
    async deleteOne(filter) {
      const index = docs.findIndex((d) => matches(d, filter));
      if (index >= 0) docs.splice(index, 1);
      return { deletedCount: index >= 0 ? 1 : 0 };
    },
    __docs: docs,
  };
}

function loadAppWithIdempotency({ buildContextImpl, askLlmImpl }) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({ enabled: true, provider: "openai", model: "sia-test-model", timeoutMs: 8000 }));

  const { classifyIntent: realClassifyIntent } = jest.requireActual("../sia/intentClassifier");
  jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: jest.fn(realClassifyIntent) }));

  const buildContextMock = jest.fn(buildContextImpl);
  jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

  const { LlmProviderError: RealLlmProviderError } = jest.requireActual("../sia/llmService");
  const askLlmMock = jest.fn(askLlmImpl);
  jest.doMock("../sia/llmService", () => ({ askLlm: askLlmMock, LlmProviderError: RealLlmProviderError }));

  const createSessionMock = jest.fn(async (userId) => ({ _id: "should-never-be-created", user: userId }));
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

  const requestFake = createMinimalSiaRequestFake();
  const { REQUEST_STATUS } = jest.requireActual("../models/SiaRequest");
  jest.doMock("../models/SiaRequest", () => {
    const exported = requestFake;
    exported.REQUEST_STATUS = REQUEST_STATUS;
    return exported;
  });

  const app = require("../app");
  return { app, createSessionMock, appendTurnMock, requestFake, askLlmMock };
}

// Windows timeout diagnosis (semantic-accuracy remediation follow-up):
// Windows CI reported "rejects an invented monetary figure..." (the first
// test below) exceeding Jest's default 5000ms testTimeout. Traced from
// source, not assumed:
//   - That test sends no clientMessageId, so ask.js's ENTIRE idempotency-
//     reservation block (`if (requestedClientMessageId) { ... }`) is
//     structurally unreachable for it -- confirmed by reading ask.js's
//     control flow directly, not inferred. It never calls
//     loadAppWithIdempotency/createMinimalSiaRequestFake at all, so the
//     hoisted-helper shared-state hypothesis does not apply to it either --
//     createMinimalSiaRequestFake() allocates a fresh `docs = []` array
//     per call, byte-for-byte identical to its pre-hoist form, and this
//     test never calls it.
//   - This file's `ask.js`/`responseValidator.js` diff (see
//     tests/sia.responseValidator.test.js's own coverage for the
//     production logic) adds zero control-flow to ask.js (string/comment
//     content only) and adds four new responseValidator.js checks that are
//     each gated behind an `intent === ...` condition this test's
//     SPENDING_FORECAST_EXPLANATION answer never satisfies -- none of the
//     new code executes for this test's case at all.
//   - The remaining, source-consistent explanation: this is the FIRST call
//     to loadApp()/loadAppWithIdempotency() in the whole file, and
//     therefore the first `require("../app")` in this Jest worker for
//     these two grounding-focused files. Babel-jest's transform of that
//     require's full graph (Express, Mongoose, every Controller/Route/
//     Service, the analytics engine, and backend/sia/ -- now larger after
//     this remediation's prompt/validator additions) is cached across
//     `jest.resetModules()` calls (resetModules only clears the MODULE
//     REGISTRY -- it never clears Jest's separate source-transform cache),
//     so every loadApp()/loadAppWithIdempotency() call AFTER the first
//     only pays cheap re-execution cost, never re-transformation. That
//     one-time transform cost was previously charged entirely against this
//     one test's individual testTimeout budget.
// Fix: pay that one-time cost here, at module-evaluation time, which Jest
// does not subject to any per-test/per-hook testTimeout at all -- so it no
// longer counts against any single test's 5000ms budget. This performs no
// request, no assertion, and no network/LLM call -- it only forces the
// require graph to be resolved and transformed once, up front. Not a
// timeout increase, not a sleep, not a poll, not a fake timer, not a
// weakened assertion, not a retry.
loadApp({
  buildContextImpl: async () => null,
  askLlmImpl: async () => ({ answer: "warmup", model: "warmup", latencyMs: 0 }),
});

describe("POST /sia/ask -- grounded-response validation wiring (Batch 2)", () => {
  it("rejects an invented monetary figure with the same generic 503 contract, and never leaks the invented figure", async () => {
    const { app, askLlmMock } = loadApp({
      buildContextImpl: async () => forecastContext(),
      askLlmImpl: async () => ({ answer: "Next month you'll spend $99999.", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-ground-1");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "What is my spending forecast for next month?" });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    expect(JSON.stringify(res.body)).not.toContain("99999");
    expect(askLlmMock).toHaveBeenCalledTimes(1); // no retry
  });

  it("rejects a leaked identifier the same way", async () => {
    const { app } = loadApp({
      buildContextImpl: async () => forecastContext(),
      askLlmImpl: async () => ({ answer: "See record 64f1a2b3c4d5e6f7a8b9c0d1 for details.", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-ground-2");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "What is my spending forecast for next month?" });

    expect(res.status).toBe(503);
  });

  it("a validly grounded forecast paraphrase is returned normally", async () => {
    const { app } = loadApp({
      buildContextImpl: async () => forecastContext(),
      askLlmImpl: async () => ({
        answer: "Based on your recent spending, next month is estimated at $1200, likely between $1000 and $1400.",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-ground-3");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "What is my spending forecast for next month?" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.intent).toBe("SPENDING_FORECAST_EXPLANATION");
  });

  // Batch 3D: the four original intents were previously bypassed entirely
  // by responseValidator.js (a hardcoded `{valid:true}` regardless of
  // content). That bypass is now removed -- these intents are validated
  // exactly like the three Batch 2 intents above. The positive/negative
  // pairs below replace the old "does not run grounded-response validation
  // for the four original intents" test, which asserted the now-removed
  // bypass.
  describe("Batch 3D -- grounded-response validation now wired for the four original intents", () => {
    it.each(NEWLY_VALIDATED_CASES.map((c) => [c.intent, c]))(
      "%s: a validly grounded answer is returned normally",
      async (_intent, c) => {
        const { app } = loadApp({
          buildContextImpl: async () => c.context(),
          askLlmImpl: async () => ({ answer: c.legitAnswer, model: "mock-model", latencyMs: 5 }),
        });
        const token = signToken(`user-ground-pos-${c.intent}`);

        const res = await request(app)
          .post("/sia/ask")
          .set("Authorization", `Bearer ${token}`)
          .send({ question: c.question });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.intent).toBe(c.intent);
        expect(res.body.answer).toBe(c.legitAnswer);
      }
    );

    it.each(NEWLY_VALIDATED_CASES.map((c) => [c.intent, c]))(
      "%s: an invented monetary figure is rejected with the same generic 503 contract, and never leaks the invented figure",
      async (_intent, c) => {
        const { app, askLlmMock } = loadApp({
          buildContextImpl: async () => c.context(),
          askLlmImpl: async () => ({ answer: c.inventedAnswer, model: "mock-model", latencyMs: 5 }),
        });
        const token = signToken(`user-ground-neg-${c.intent}`);

        const res = await request(app)
          .post("/sia/ask")
          .set("Authorization", `Bearer ${token}`)
          .send({ question: c.question });

        expect(res.status).toBe(503);
        expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
        expect(JSON.stringify(res.body)).not.toContain("999999");
        expect(askLlmMock).toHaveBeenCalledTimes(1); // no retry
      }
    );

    it.each(NEWLY_VALIDATED_CASES.map((c) => [c.intent, c]))(
      "%s: a leaked identifier is rejected the same way",
      async (_intent, c) => {
        const { app } = loadApp({
          buildContextImpl: async () => c.context(),
          askLlmImpl: async () => ({
            answer: "See record 64f1a2b3c4d5e6f7a8b9c0d1 for details.",
            model: "mock-model",
            latencyMs: 5,
          }),
        });
        const token = signToken(`user-ground-leak-${c.intent}`);

        const res = await request(app)
          .post("/sia/ask")
          .set("Authorization", `Bearer ${token}`)
          .send({ question: c.question });

        expect(res.status).toBe(503);
        expect(JSON.stringify(res.body)).not.toContain("64f1a2b3c4d5e6f7a8b9c0d1");
      }
    );
  });
});

// ---------------------------------------------------------------------
// Batch 3D: idempotency-reservation interaction for a grounding rejection
// on each newly-validated intent -- proves the SAME failure path already
// proven for SPENDING_FORECAST_EXPLANATION in
// tests/sia.ask.idempotency.test.js's "failures leave the key safely
// retryable" suite now also covers the four original intents. A minimal,
// self-contained in-memory SiaRequest fake (create/findOne/deleteOne only
// -- the operations a reservation-then-release path actually exercises;
// markAnswerReady/markCompleted are never reached on a rejection) is used
// here rather than importing tests/sia.ask.idempotency.test.js's fixture,
// keeping this file's mocking self-contained per this repository's
// existing one-file-one-loadApp convention.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Semantic-accuracy remediation: proves (a) the risk/spending-change/
// health system prompts actually carry the new evidence-boundary
// instructions, via the SAME established pattern this file already uses
// (capturing askLlmMock.mock.calls[0][0].systemPrompt through a real
// request), and (b) the new responseValidator.js checks are genuinely
// wired into POST /sia/ask end-to-end -- same generic 503 contract, no
// persisted turn, no second provider call, reservation released for a
// legitimate retry.
// ---------------------------------------------------------------------
const riskForecastPressureContext = () => ({
  intent: "FINANCIAL_RISK_EXPLANATION",
  fields: {
    risk: {
      hasData: true,
      riskLevel: "high",
      signalCount: 1,
      signals: [
        {
          reasonCode: "FORECASTED_FINANCIAL_PRESSURE",
          severity: "high",
          evidence: { forecastedAmount: 6000, configuredBudget: 5000, ratio: 1.2 },
        },
      ],
    },
    summary: { totalSpent: 5000, budgetStatus: "AtRisk" },
  },
  sourceReportGeneratedAt: "2026-08-08T00:00:00.000Z",
});

describe("POST /sia/ask -- semantic-accuracy remediation: system prompts carry the evidence-boundary instructions", () => {
  it("the risk prompt instructs current-month (not next-month) pressure wording, no-persistence wording, no-decline wording, and no-'no financial risk' wording for a zero-signal result", async () => {
    const { app, askLlmMock } = loadApp({
      buildContextImpl: async () => riskForecastPressureContext(),
      askLlmImpl: async () => ({
        answer: "Projected spending for this month may reach or exceed the configured budget.",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-prompt-risk-1");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Do I have any financial risks right now?" });

    expect(res.status).toBe(200);
    const usedPrompt = askLlmMock.mock.calls[0][0].systemPrompt;
    // Requirement 1: all three evidence-boundary instructions present.
    expect(usedPrompt).toEqual(expect.stringContaining("never as a forecast or pressure for next month"));
    expect(usedPrompt).toEqual(
      expect.stringContaining("never as persistent, sustained, long-term, repeated, or multi-month growth")
    );
    expect(usedPrompt).toEqual(
      expect.stringContaining("never as declining, deteriorating, falling, or worsening over time")
    );
    expect(usedPrompt).toEqual(expect.stringContaining("never present this as proof that the user has no financial risk"));
  });

  it("the spending-change prompt prohibits unsupported persistence claims", async () => {
    const { app } = loadApp({
      buildContextImpl: async () => spendingChangeContext(),
      askLlmImpl: async ({ systemPrompt }) => ({
        answer: systemPrompt.includes("persistent, sustained, long-term, repeated, or multi-month trend")
          ? "Your spending is now $1200 this month, up from $900 last month."
          : "WRONG_PROMPT",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-prompt-spending-1");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why did my spending increase?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).not.toBe("WRONG_PROMPT");
  });

  it("the health prompt prohibits unsupported historical-decline claims", async () => {
    const { app } = loadApp({
      buildContextImpl: async () => healthContext(),
      askLlmImpl: async ({ systemPrompt }) => ({
        answer: systemPrompt.includes("never as declining, deteriorating, falling, or worsening over time")
          ? "Your financial health score is 75, reflecting Low overall risk."
          : "WRONG_PROMPT",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-prompt-health-1");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).not.toBe("WRONG_PROMPT");
  });
});

describe("POST /sia/ask -- semantic-accuracy remediation: validator checks are wired end-to-end", () => {
  it("rejects an overstated 'next month' risk answer with the same generic 503 contract, never leaking the reasonCode, and never calls the provider twice", async () => {
    const { app, askLlmMock } = loadApp({
      buildContextImpl: async () => riskForecastPressureContext(),
      askLlmImpl: async () => ({
        answer: "Your spending pressure for next month looks high.",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-semantic-reject-1");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Do I have any financial risks right now?" });

    // Requirement 14: only the established generic client response.
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    expect(JSON.stringify(res.body)).not.toContain("UNSUPPORTED_TEMPORAL_CLAIM");
    expect(JSON.stringify(res.body)).not.toContain("next month");
    // Requirement 15: no automatic second provider request for this single call.
    expect(askLlmMock).toHaveBeenCalledTimes(1);
  });

  it("an invalid provider answer (unsupported persistence claim) is never persisted, and idempotency/session behave exactly like every other grounding rejection", async () => {
    const { app, createSessionMock, appendTurnMock, requestFake, askLlmMock } = loadAppWithIdempotency({
      buildContextImpl: async () => spendingChangeContext(),
      askLlmImpl: async () => ({
        answer: "Your spending shows a persistent, sustained upward trend.",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-semantic-reject-2");
    const body = { question: "Why did my spending increase?", clientMessageId: "key-semantic-persistence" };

    const rejected = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(body);

    expect(rejected.status).toBe(503);
    expect(rejected.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    const rawBody = JSON.stringify(rejected.body);
    expect(rawBody).not.toContain("persistent");
    expect(rawBody).not.toContain("UNSUPPORTED_PERSISTENCE_CLAIM");

    // Requirement 13: never persisted -- no turn, no session.
    expect(appendTurnMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();

    // Reservation released, not poisoned -- and the existing zero-provider-
    // retry policy and idempotency/reservation cleanup are unchanged: a
    // legitimate retry under the identical key succeeds with exactly one
    // fresh provider call, never an automatic second call on the original
    // attempt (askLlmMock was called exactly once above).
    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(requestFake.__docs.length).toBe(0);

    askLlmMock.mockImplementationOnce(async () => ({
      answer: "Your spending increased compared with last month.",
      model: "mock-model",
      latencyMs: 5,
    }));
    const retried = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(body);
    expect(retried.status).toBe(200);
    expect(askLlmMock).toHaveBeenCalledTimes(2); // one rejected, one accepted -- never automatic
  });
});

describe("POST /sia/ask -- Batch 3D: grounding rejection + idempotency interaction for the four newly-validated intents", () => {
  // createMinimalSiaRequestFake/loadAppWithIdempotency are defined at
  // module scope above (semantic-accuracy remediation: hoisted so the new
  // "validator checks are wired end-to-end" describe block above can reuse
  // the identical harness rather than duplicating it) -- behavior
  // unchanged from the original in-describe definitions.

  it.each(NEWLY_VALIDATED_CASES.map((c) => [c.intent, c]))(
    "%s: a grounding rejection uses the public 503 contract, persists no turn, creates no session, releases the reservation for a legitimate retry, and leaks no validator/context internals",
    async (_intent, c) => {
      const { app, createSessionMock, appendTurnMock, requestFake, askLlmMock } = loadAppWithIdempotency({
        buildContextImpl: async () => c.context(),
        askLlmImpl: async () => ({ answer: c.inventedAnswer, model: "mock-model", latencyMs: 5 }),
      });
      const token = signToken(`user-ground-idem-${c.intent}`);
      const body = { question: c.question, clientMessageId: `key-ground-${c.intent}` };

      const rejected = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(body);

      // Public contract: identical to every other SIA failure, no
      // validator-specific status code, reasonCode, or field.
      expect(rejected.status).toBe(503);
      expect(rejected.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
      const rawBody = JSON.stringify(rejected.body);
      expect(rawBody).not.toContain("999999"); // the invented figure
      expect(rawBody).not.toContain("reasonCode");
      expect(rawBody).not.toContain("UNSUPPORTED_MONETARY_FIGURE");
      expect(rawBody).not.toContain("contextFields");

      // No persisted turn, no session created as a side effect.
      expect(appendTurnMock).not.toHaveBeenCalled();
      expect(createSessionMock).not.toHaveBeenCalled();

      // Reservation released, not poisoned -- no lingering record.
      expect(requestFake.__docs.length).toBe(0);

      // A legitimate retry with the identical key now succeeds under a
      // fresh, properly-owned reservation.
      askLlmMock.mockImplementationOnce(async () => ({ answer: c.legitAnswer, model: "mock-model", latencyMs: 5 }));
      const retried = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(body);
      expect(retried.status).toBe(200);
      expect(retried.body.answer).toBe(c.legitAnswer);
      expect(askLlmMock).toHaveBeenCalledTimes(2); // one rejected, one accepted
    }
  );
});
