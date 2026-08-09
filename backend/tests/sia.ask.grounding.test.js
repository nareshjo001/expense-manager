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

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
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

  jest.doMock("../sia/config", () => ({ enabled: true, provider: "openai", timeoutMs: 8000 }));

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
describe("POST /sia/ask -- Batch 3D: grounding rejection + idempotency interaction for the four newly-validated intents", () => {
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

    jest.doMock("../sia/config", () => ({ enabled: true, provider: "openai", timeoutMs: 8000 }));

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
