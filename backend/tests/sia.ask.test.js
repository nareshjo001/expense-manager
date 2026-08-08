// Route/controller tests for POST /sia/ask (backend/Controllers/SiaControllers/ask.js,
// backend/Routes/sia.routes.js).
//
// backend/sia/config.js, backend/sia/intentClassifier.js,
// backend/sia/contextBuilder.js, and backend/sia/llmService.js are all
// mocked per test via loadApp() below -- no real environment variable,
// MongoDB, Redis, ML service, or provider call is ever made. The only real,
// unmocked piece exercised end-to-end is authentication (Middlewares/Auth.js's
// verifyToken) via a locally-signed JWT, the same pattern
// tests/report.route.smoke.test.js already established for the sibling
// GET /report route -- verifyToken never queries the database, so this adds
// no MongoDB dependency.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-ask-test-secret";
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

afterEach(() => {
  jest.resetModules();
});

// M3-3: ask.js's real (unmocked) backend/sia/safeLogger.js writes one
// structured JSON line via console.log per provider attempt. A single
// suite-wide spy -- installed before every test in this file and restored
// after every test -- both keeps that expected operational output out of
// the Jest console (every earlier, pre-M3-3 test in this file never
// asserted on console.log and would otherwise now print it) and gives the
// M3-3 describe block below a single, already-installed spy to inspect via
// loggedRecords(). Individual tests that need the sink itself to fail
// reconfigure this same spy's implementation (consoleLogSpy.mockImplementation(...))
// rather than calling jest.spyOn again, so there is never more than one
// spy on console.log at a time.
let consoleLogSpy;

beforeEach(() => {
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  consoleLogSpy.mockRestore();
});

// Mirrors Controllers/AuthControllers/login.js's JWT payload shape
// ({ email, _id }), same as tests/fixtures/reportFixtures.js's
// signTestToken, reimplemented locally so this route-level test file has no
// dependency on the M0-2 integration fixtures module (which additionally
// requires mongoose models this test never needs).
function signToken(userId) {
  return jwt.sign({ email: "sia-ask-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

// Loads a fresh Express app with backend/sia/config, intentClassifier,
// contextBuilder, and llmService mocked. Mirrors the module-reset isolation
// style used by tests/sia.contextBuilder.test.js and tests/sia.llmService.test.js.
function loadApp({ configOverrides = {}, classifyIntentImpl, buildContextImpl, askLlmImpl } = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({
    enabled: false,
    provider: null,
    timeoutMs: 8000,
    ...configOverrides,
  }));

  const { classifyIntent: realClassifyIntent } = jest.requireActual("../sia/intentClassifier");
  const classifyIntentMock = jest.fn(classifyIntentImpl || realClassifyIntent);
  jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: classifyIntentMock }));

  const buildContextMock = jest.fn(
    buildContextImpl || (async () => ({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" }))
  );
  jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

  // Grab the REAL LlmProviderError class before mocking the module, so a
  // mocked rejection is a genuine instance of it, matching what the real
  // M1-3 stub actually throws.
  const { LlmProviderError: RealLlmProviderError } = jest.requireActual("../sia/llmService");
  const askLlmMock = jest.fn(
    askLlmImpl ||
      (async () => {
        throw new RealLlmProviderError("SIA has no LLM provider configured.", {
          code: "PROVIDER_NOT_CONFIGURED",
          provider: null,
        });
      })
  );
  jest.doMock("../sia/llmService", () => ({ askLlm: askLlmMock, LlmProviderError: RealLlmProviderError }));

  const app = require("../app");
  return {
    app,
    classifyIntentMock,
    buildContextMock,
    askLlmMock,
    LlmProviderError: RealLlmProviderError,
  };
}

const HEALTH_QUESTION = "Why is my financial health score low?";
const SPENDING_QUESTION = "Why did my spending increase?";
const BUDGET_QUESTION = "Explain my current budget status.";
const CATEGORY_QUESTION = "Which category am I spending the most on?";

function fakeHealthContext(overrides = {}) {
  return {
    intent: "HEALTH_EXPLANATION",
    fields: {
      financialHealth: { overall: 75, risk: { label: "Low", color: "green" } },
      summary: { healthScore: 75, riskLevel: "Low" },
    },
    sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

// Mirrors the exact SPENDING_CHANGE_EXPLANATION context shape confirmed in
// the committed backend/sia/contextBuilder.js: fields.trends (the full
// trendAnalyzer.js output) plus fields.summary.comparePastMonth /
// fields.summary.totalSpent -- no category-level breakdown field exists.
function fakeSpendingContext(overrides = {}) {
  return {
    intent: "SPENDING_CHANGE_EXPLANATION",
    fields: {
      trends: { monthlyTrend: [{ month: "2025-12", total: 900 }, { month: "2026-01", total: 1200 }] },
      summary: { comparePastMonth: { changePercent: 33.3, direction: "increase" }, totalSpent: 1200 },
    },
    sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

// Mirrors the exact BUDGET_STATUS_EXPLANATION context shape confirmed in
// the committed backend/sia/contextBuilder.js (M2-3A): a single
// fields.budget object carrying all fourteen budgetAnalyzer.js-derived
// fields at once (contextBuilder.js's own gates make them co-guaranteed --
// there is no scenario where only some of them are present in a valid
// context).
function fakeBudgetContext(overrides = {}) {
  return {
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
    sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

// Mirrors the exact CATEGORY_SPENDING_EXPLANATION context shape confirmed
// in the committed backend/sia/contextBuilder.js (M2-4A): a single
// fields.categories object carrying exactly six validated, defensively
// copied aggregates sourced from report.categories.monthly --
// topCategory, leastCategory, categoryDistribution, concentrationIndex,
// top3Concentration, and categoryGrowth. biggestJump/biggestDrop and the
// yearly branch are deliberately absent, matching M2-4A's own exclusions.
function fakeCategoryContext(overrides = {}) {
  return {
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
          {
            category: "Groceries",
            previous: 1000,
            current: 1234.56,
            change: 234.56,
            growthPercentage: 23.46,
            isNewCategory: false,
            trend: "up",
          },
          {
            category: "Books",
            previous: 0,
            current: 12.34,
            change: 12.34,
            growthPercentage: null,
            isNewCategory: true,
            trend: "up",
          },
        ],
      },
    },
    sourceReportGeneratedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

// The exact fixed no-data answer approved for this intent.
const CATEGORY_NO_DATA_ANSWER =
  "I don't have enough monthly category spending data to explain your category spending yet.";

describe("POST /sia/ask", () => {
  it(
    "returns 401 with the repository's real auth convention when no token is present",
    async () => {
      // This is the first test in the file to call loadApp(), which
      // jest.resetModules()s and then cold-requires the entire
      // backend/app.js dependency graph (every existing router/controller/
      // service, not just SIA's). That first cold require pays a one-time
      // disk-I/O cost that can exceed Jest's default 5000ms test timeout in
      // slower/CI-like environments, even though the request itself
      // resolves correctly once loading completes -- every other test in
      // this file also calls loadApp(), but benefits from the OS file
      // cache already being warm from this first call. A narrowly scoped
      // timeout here (not a suite-wide jest.setTimeout()) is the correct
      // fix for that one-time cost; it does not mask a hang or incorrect
      // behavior -- see the M2-1 HTTP-test-timeout diagnostic report.
      const { app } = loadApp();

      const res = await request(app).post("/sia/ask").send({ question: HEALTH_QUESTION });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: "Authorization token missing" });
    },
    30000
  );

  it("returns 503 when SIA is disabled, and calls neither the classifier, buildContext, nor askLlm", async () => {
    const { app, classifyIntentMock, buildContextMock, askLlmMock } = loadApp({
      configOverrides: { enabled: false },
    });
    const token = signToken("user-disabled");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    expect(classifyIntentMock).not.toHaveBeenCalled();
    expect(buildContextMock).not.toHaveBeenCalled();
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("returns 400 when question is missing", async () => {
    const { app } = loadApp({ configOverrides: { enabled: true } });
    const token = signToken("user-1");

    const res = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send({});

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "question is required" });
  });

  it("returns 400 when question is not a string", async () => {
    const { app } = loadApp({ configOverrides: { enabled: true } });
    const token = signToken("user-2");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: 12345 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "question is required" });
  });

  it("returns 400 when question is whitespace-only", async () => {
    const { app } = loadApp({ configOverrides: { enabled: true } });
    const token = signToken("user-3");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "   " });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "question is required" });
  });

  it("returns 422 for an unrecognized question and calls neither buildContext nor askLlm", async () => {
    const { app, buildContextMock, askLlmMock } = loadApp({ configOverrides: { enabled: true } });
    const token = signToken("user-4");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "How much did I spend?" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      message: "Question not recognized for the intents SIA currently supports.",
    });
    expect(buildContextMock).not.toHaveBeenCalled();
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("calls buildContext exactly once with the authenticated req.userId and HEALTH_EXPLANATION, ignoring a malicious body/query userId", async () => {
    const { app, buildContextMock } = loadApp({ configOverrides: { enabled: true } });
    const authenticatedUserId = "real-authenticated-user-id";
    const token = signToken(authenticatedUserId);

    await request(app)
      .post("/sia/ask?userId=attacker-supplied-query-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION, userId: "attacker-supplied-body-id" });

    expect(buildContextMock).toHaveBeenCalledTimes(1);
    expect(buildContextMock).toHaveBeenCalledWith(authenticatedUserId, "HEALTH_EXPLANATION");
    expect(buildContextMock.mock.calls[0][0]).not.toBe("attacker-supplied-query-id");
    expect(buildContextMock.mock.calls[0][0]).not.toBe("attacker-supplied-body-id");
  });

  it("calls askLlm exactly once with the fixed system prompt, the narrow context result, and the trimmed question", async () => {
    const fakeContext = fakeHealthContext();
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeContext,
      askLlmImpl: async () => ({ answer: "Mocked explanation.", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-5");

    await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: `  ${HEALTH_QUESTION}  ` });

    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(askLlmMock).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining("You are SIA"),
      context: fakeContext,
      question: HEALTH_QUESTION,
    });
  });

  it("returns the exact 200 public contract with the real grounding paths on a mocked LLM success", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeHealthContext(),
      askLlmImpl: async () => ({ answer: "Your score reflects Low risk.", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-6");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: "Your score reflects Low risk.",
      intent: "HEALTH_EXPLANATION",
      basedOn: ["financialHealth", "financialHealth.overall", "financialHealth.risk.label"],
    });
  });

  it("returns the exact fixed 200 no-data response and does not call askLlm", async () => {
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => ({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" }),
    });
    const token = signToken("user-7");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: "I do not have enough financial report data yet to explain your financial health score.",
      intent: "HEALTH_EXPLANATION",
      basedOn: ["none"],
    });
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("returns a generic 503 when askLlm rejects with LlmProviderError", async () => {
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeHealthContext(),
      askLlmImpl: async () => {
        throw new LlmProviderError("SIA has no implemented adapter for the configured LLM provider.", {
          code: "PROVIDER_NOT_IMPLEMENTED",
          provider: "openai",
        });
      },
    });
    const token = signToken("user-8");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 when buildContext unexpectedly rejects", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => {
        throw new Error("unexpected failure");
      },
    });
    const token = signToken("user-9");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("error responses never expose prompts, questions, context, provider details, stack traces, or financial markers", async () => {
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () =>
        fakeHealthContext({
          fields: {
            financialHealth: { overall: 42, risk: { label: "SENSITIVE_RISK_LABEL" } },
            summary: {},
          },
        }),
      askLlmImpl: async () => {
        throw new LlmProviderError("internal provider detail that must not leak", {
          code: "PROVIDER_NOT_IMPLEMENTED",
          provider: "SENSITIVE_PROVIDER_NAME",
        });
      },
    });
    const token = signToken("user-10");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: `SENSITIVE_QUESTION_MARKER ${HEALTH_QUESTION}` });

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("SENSITIVE_PROVIDER_NAME");
    expect(serialized).not.toContain("SENSITIVE_RISK_LABEL");
    expect(serialized).not.toContain("SENSITIVE_QUESTION_MARKER");
    expect(serialized).not.toContain("internal provider detail");
    expect(serialized).not.toContain("42");
    expect(Object.keys(res.body).sort()).toEqual(["message", "success"]);
  });

  it("public success responses contain no raw transaction arrays or userId", async () => {
    const authenticatedUserId = "user-should-not-leak-11";
    const token = signToken(authenticatedUserId);
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeHealthContext(),
      askLlmImpl: async () => ({ answer: "Explanation text.", model: "m", latencyMs: 1 }),
    });

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain(authenticatedUserId);
    expect(Object.keys(res.body).sort()).toEqual(["answer", "basedOn", "intent", "success"]);
  });

  it("does not mutate the request body", async () => {
    const { app } = loadApp({ configOverrides: { enabled: true } });
    const token = signToken("user-12");
    const requestBody = { question: HEALTH_QUESTION };
    const snapshot = JSON.parse(JSON.stringify(requestBody));

    await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(requestBody);

    expect(requestBody).toEqual(snapshot);
  });

  // -- M2-2: SPENDING_CHANGE_EXPLANATION -------------------------------------
  // Mirrors the HEALTH_EXPLANATION cases above one-for-one, using the exact
  // intent identifier already established by backend/sia/contextBuilder.js's
  // M1-2 implementation. Every HEALTH_EXPLANATION test above is untouched --
  // these are additive.

  it("calls buildContext exactly once with the authenticated req.userId and SPENDING_CHANGE_EXPLANATION, ignoring a malicious body/query userId", async () => {
    const { app, buildContextMock } = loadApp({ configOverrides: { enabled: true } });
    const authenticatedUserId = "real-authenticated-user-id-spending";
    const token = signToken(authenticatedUserId);

    await request(app)
      .post("/sia/ask?userId=attacker-supplied-query-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: SPENDING_QUESTION, userId: "attacker-supplied-body-id" });

    expect(buildContextMock).toHaveBeenCalledTimes(1);
    expect(buildContextMock).toHaveBeenCalledWith(authenticatedUserId, "SPENDING_CHANGE_EXPLANATION");
    expect(buildContextMock.mock.calls[0][0]).not.toBe("attacker-supplied-query-id");
    expect(buildContextMock.mock.calls[0][0]).not.toBe("attacker-supplied-body-id");
  });

  it("calls askLlm exactly once with the fixed spending system prompt, the narrow spending context result, and the trimmed question", async () => {
    const fakeContext = fakeSpendingContext();
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeContext,
      askLlmImpl: async () => ({ answer: "Mocked spending explanation.", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-13");

    await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: `  ${SPENDING_QUESTION}  ` });

    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(askLlmMock).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining("You are SIA"),
      context: fakeContext,
      question: SPENDING_QUESTION,
    });
    // The spending prompt must never be the exact health prompt string, and
    // must reflect the "contributed to" causal-language constraint.
    const usedPrompt = askLlmMock.mock.calls[0][0].systemPrompt;
    expect(usedPrompt).toEqual(expect.stringContaining("spending change"));
    expect(usedPrompt).not.toEqual(expect.stringContaining("financial-health result"));
  });

  it("returns the exact spending 200 public contract with the real grounding paths on a mocked LLM success", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeSpendingContext(),
      askLlmImpl: async () => ({
        answer: "Your spending increased, largely associated with higher totals this month.",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-14");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: SPENDING_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: "Your spending increased, largely associated with higher totals this month.",
      intent: "SPENDING_CHANGE_EXPLANATION",
      basedOn: ["trends", "trends.monthlyTrend", "summary.comparePastMonth", "summary.totalSpent"],
    });
  });

  it("returns the exact fixed spending 200 no-data response and does not call askLlm", async () => {
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => ({
        intent: "SPENDING_CHANGE_EXPLANATION",
        fields: null,
        reason: "no_data",
      }),
    });
    const token = signToken("user-15");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: SPENDING_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: "I do not have enough financial report data yet to explain how your spending changed.",
      intent: "SPENDING_CHANGE_EXPLANATION",
      basedOn: ["none"],
    });
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("returns 422 for an unrecognized spending-style question and calls neither buildContext nor askLlm", async () => {
    const { app, buildContextMock, askLlmMock } = loadApp({ configOverrides: { enabled: true } });
    const token = signToken("user-16");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Predict my spending next month." });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      message: "Question not recognized for the intents SIA currently supports.",
    });
    expect(buildContextMock).not.toHaveBeenCalled();
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("returns a generic 503 for spending when askLlm resolves with a blank answer", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeSpendingContext(),
      askLlmImpl: async () => ({ answer: "   ", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-17");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: SPENDING_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 for spending when askLlm resolves with a non-string answer", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeSpendingContext(),
      askLlmImpl: async () => ({ answer: null, model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-18");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: SPENDING_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 for spending when askLlm rejects with LlmProviderError", async () => {
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeSpendingContext(),
      askLlmImpl: async () => {
        throw new LlmProviderError("SIA has no implemented adapter for the configured LLM provider.", {
          code: "PROVIDER_NOT_IMPLEMENTED",
          provider: "openai",
        });
      },
    });
    const token = signToken("user-19");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: SPENDING_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 for spending when buildContext unexpectedly rejects", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => {
        throw new Error("unexpected spending failure");
      },
    });
    const token = signToken("user-20");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: SPENDING_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("spending error responses never expose prompts, questions, context, provider details, stack traces, or financial markers", async () => {
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () =>
        fakeSpendingContext({
          fields: {
            trends: { monthlyTrend: [{ month: "2026-01", total: 1200 }] },
            summary: { comparePastMonth: { changePercent: 999.9 }, totalSpent: 1200 },
          },
        }),
      askLlmImpl: async () => {
        throw new LlmProviderError("internal spending provider detail that must not leak", {
          code: "PROVIDER_NOT_IMPLEMENTED",
          provider: "SENSITIVE_SPENDING_PROVIDER_NAME",
        });
      },
    });
    const token = signToken("user-21");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: `SENSITIVE_SPENDING_QUESTION_MARKER ${SPENDING_QUESTION}` });

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("SENSITIVE_SPENDING_PROVIDER_NAME");
    expect(serialized).not.toContain("SENSITIVE_SPENDING_QUESTION_MARKER");
    expect(serialized).not.toContain("internal spending provider detail");
    expect(serialized).not.toContain("999.9");
    expect(serialized).not.toContain("1200");
    expect(Object.keys(res.body).sort()).toEqual(["message", "success"]);
  });

  it("public spending success responses contain no raw transaction arrays, full context object, or userId", async () => {
    const authenticatedUserId = "user-should-not-leak-spending-22";
    const token = signToken(authenticatedUserId);
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeSpendingContext(),
      askLlmImpl: async () => ({ answer: "Spending explanation text.", model: "m", latencyMs: 1 }),
    });

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: SPENDING_QUESTION });

    const serialized = JSON.stringify(res.body);
    // "monthlyTrend" and "comparePastMonth" are server-owned basedOn PATH
    // NAMES (backend/sia/responseFormatter.js's fixed allowlist), not raw
    // financial data -- trends.monthlyTrend is guaranteed present whenever
    // contextBuilder.js returns a valid SPENDING_CHANGE_EXPLANATION context
    // (trendAnalyzer.js's analyze() unconditionally includes monthlyTrend
    // in its return value, in both its noActivity and normal branches, and
    // reportGenerator.js stores that same object verbatim as report.trends
    // and derives summary.comparePastMonth from
    // trendReport.monthlyTrend.percentageChange in the same call -- so
    // contextBuilder.js's own isPresent(comparePastMonth) gate cannot pass
    // without trends.monthlyTrend already existing). Asserting those
    // substrings are absent from the response was therefore a contradiction
    // with the intentional, allowlisted basedOn contract, not a real leak
    // check. The real leak surface this test guards is the structured
    // context object itself (fields/context/sourceReportGeneratedAt) and
    // the authenticated userId -- neither of which the response may ever
    // contain.
    expect(res.body).not.toHaveProperty("context");
    expect(res.body).not.toHaveProperty("fields");
    expect(res.body).not.toHaveProperty("sourceReportGeneratedAt");
    expect(res.body).not.toHaveProperty("userId");
    expect(serialized).not.toContain(authenticatedUserId);
    // Only the server-owned, allowlisted path NAMES are ever returned --
    // never raw data values (e.g. the fixture's 900, 1200, 33.3 totals) and
    // never the fields object itself.
    expect(res.body.basedOn).toEqual([
      "trends",
      "trends.monthlyTrend",
      "summary.comparePastMonth",
      "summary.totalSpent",
    ]);
    expect(Object.keys(res.body).sort()).toEqual(["answer", "basedOn", "intent", "success"]);
  });

  it("does not mutate the request body or the buildContext-returned context object for a spending question", async () => {
    const fakeContext = fakeSpendingContext();
    const contextSnapshot = JSON.parse(JSON.stringify(fakeContext));
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeContext,
      askLlmImpl: async () => ({ answer: "Spending explanation text.", model: "m", latencyMs: 1 }),
    });
    const token = signToken("user-23");
    const requestBody = { question: SPENDING_QUESTION };
    const bodySnapshot = JSON.parse(JSON.stringify(requestBody));

    await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(requestBody);

    expect(requestBody).toEqual(bodySnapshot);
    expect(fakeContext).toEqual(contextSnapshot);
  });

  it("keeps health and spending prompts, contexts, and formatters isolated across back-to-back requests on the same app instance", async () => {
    const { app, askLlmMock, buildContextMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async (userId, intent) =>
        intent === "HEALTH_EXPLANATION" ? fakeHealthContext() : fakeSpendingContext(),
      askLlmImpl: async ({ systemPrompt }) => ({
        answer: systemPrompt.includes("spending change") ? "Spending answer." : "Health answer.",
        model: "mock-model",
        latencyMs: 1,
      }),
    });
    const token = signToken("user-24");

    const healthRes = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });
    const spendingRes = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: SPENDING_QUESTION });

    expect(healthRes.body).toEqual({
      success: true,
      answer: "Health answer.",
      intent: "HEALTH_EXPLANATION",
      basedOn: ["financialHealth", "financialHealth.overall", "financialHealth.risk.label"],
    });
    expect(spendingRes.body).toEqual({
      success: true,
      answer: "Spending answer.",
      intent: "SPENDING_CHANGE_EXPLANATION",
      basedOn: ["trends", "trends.monthlyTrend", "summary.comparePastMonth", "summary.totalSpent"],
    });

    expect(buildContextMock).toHaveBeenNthCalledWith(1, "user-24", "HEALTH_EXPLANATION");
    expect(buildContextMock).toHaveBeenNthCalledWith(2, "user-24", "SPENDING_CHANGE_EXPLANATION");
    expect(askLlmMock.mock.calls[0][0].systemPrompt).toEqual(expect.stringContaining("financial-health result"));
    expect(askLlmMock.mock.calls[1][0].systemPrompt).toEqual(expect.stringContaining("spending change"));
  });

  // -- M2-3: BUDGET_STATUS_EXPLANATION ----------------------------------------
  // Mirrors the HEALTH_EXPLANATION/SPENDING_CHANGE_EXPLANATION cases above
  // one-for-one, using the exact intent identifier already established by
  // backend/sia/contextBuilder.js's M2-3A implementation. Every
  // HEALTH_EXPLANATION/SPENDING_CHANGE_EXPLANATION test above is untouched
  // -- these are additive.

  it("calls buildContext exactly once with the authenticated req.userId and BUDGET_STATUS_EXPLANATION, ignoring a malicious body/query userId", async () => {
    const { app, buildContextMock } = loadApp({ configOverrides: { enabled: true } });
    const authenticatedUserId = "real-authenticated-user-id-budget";
    const token = signToken(authenticatedUserId);

    await request(app)
      .post("/sia/ask?userId=attacker-supplied-query-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: BUDGET_QUESTION, userId: "attacker-supplied-body-id" });

    expect(buildContextMock).toHaveBeenCalledTimes(1);
    expect(buildContextMock).toHaveBeenCalledWith(authenticatedUserId, "BUDGET_STATUS_EXPLANATION");
    expect(buildContextMock.mock.calls[0][0]).not.toBe("attacker-supplied-query-id");
    expect(buildContextMock.mock.calls[0][0]).not.toBe("attacker-supplied-body-id");
  });

  it("calls askLlm exactly once with the fixed budget system prompt, the narrow budget context result, and the trimmed question", async () => {
    const fakeContext = fakeBudgetContext();
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeContext,
      askLlmImpl: async () => ({ answer: "Mocked budget explanation.", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-25");

    await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: `  ${BUDGET_QUESTION}  ` });

    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(askLlmMock).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining("You are SIA"),
      context: fakeContext,
      question: BUDGET_QUESTION,
    });
    // The budget prompt must never be the health or spending prompt, and
    // must reflect this milestone's "do not present a projection as
    // certain" / "no affordability, investment, or debt advice" constraints.
    const usedPrompt = askLlmMock.mock.calls[0][0].systemPrompt;
    expect(usedPrompt).toEqual(expect.stringContaining("current budget status"));
    expect(usedPrompt).toEqual(expect.stringContaining("Do not give affordability, investment, debt"));
    expect(usedPrompt).not.toEqual(expect.stringContaining("financial-health result"));
    expect(usedPrompt).not.toEqual(expect.stringContaining("spending change"));
  });

  it("returns the exact budget 200 public contract with the real grounding path on a mocked LLM success", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeBudgetContext(),
      askLlmImpl: async () => ({
        answer: "You've used 64% of your budget, with ₹1800 remaining and a Warning status.",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-26");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: BUDGET_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: "You've used 64% of your budget, with ₹1800 remaining and a Warning status.",
      intent: "BUDGET_STATUS_EXPLANATION",
      basedOn: ["budgets"],
    });
    // "budgets" (plural) is the canonical report.budgets source path;
    // "budget" (singular) is only this context's own internal field name
    // and must never be returned as a basedOn path.
    expect(res.body.basedOn).not.toContain("budget");
  });

  it("returns the exact fixed budget 200 no-data response and does not call askLlm", async () => {
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => ({
        intent: "BUDGET_STATUS_EXPLANATION",
        fields: null,
        reason: "no_data",
      }),
    });
    const token = signToken("user-27");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: BUDGET_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: "I do not have enough financial report data yet to explain your budget status.",
      intent: "BUDGET_STATUS_EXPLANATION",
      basedOn: ["none"],
    });
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("returns 422 for an unrecognized budget-style question and calls neither buildContext nor askLlm", async () => {
    const { app, buildContextMock, askLlmMock } = loadApp({ configOverrides: { enabled: true } });
    const token = signToken("user-28");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "What is a budget?" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      message: "Question not recognized for the intents SIA currently supports.",
    });
    expect(buildContextMock).not.toHaveBeenCalled();
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("returns a generic 503 for budget when askLlm resolves with a missing answer", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeBudgetContext(),
      askLlmImpl: async () => ({ model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-29");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: BUDGET_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 for budget when askLlm resolves with a non-string answer", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeBudgetContext(),
      askLlmImpl: async () => ({ answer: null, model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-30");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: BUDGET_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 for budget when askLlm resolves with a blank answer", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeBudgetContext(),
      askLlmImpl: async () => ({ answer: "   ", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-31");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: BUDGET_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 for budget when askLlm rejects with LlmProviderError", async () => {
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeBudgetContext(),
      askLlmImpl: async () => {
        throw new LlmProviderError("SIA has no implemented adapter for the configured LLM provider.", {
          code: "PROVIDER_NOT_IMPLEMENTED",
          provider: "openai",
        });
      },
    });
    const token = signToken("user-32");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: BUDGET_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 for budget when buildContext unexpectedly rejects", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => {
        throw new Error("unexpected budget failure");
      },
    });
    const token = signToken("user-33");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: BUDGET_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("budget error responses never expose prompts, questions, context, provider details, stack traces, or financial values", async () => {
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () =>
        fakeBudgetContext({
          fields: {
            budget: {
              budget: 7777,
              spent: 6666,
              hasBudget: true,
              status: "SENSITIVE_STATUS_MARKER",
              isOverspent: false,
              exceededBy: 0,
              utilization: 85.5,
              remainingBudget: 1111,
              budgetLeft: 14.5,
              projectionStatus: "AtRisk",
              projectionReliable: true,
              projectedSpent: 7500,
              projectedOverspend: 0,
              projectedOverspendPercent: 0,
            },
          },
        }),
      askLlmImpl: async () => {
        throw new LlmProviderError("internal budget provider detail that must not leak", {
          code: "PROVIDER_NOT_IMPLEMENTED",
          provider: "SENSITIVE_BUDGET_PROVIDER_NAME",
        });
      },
    });
    const token = signToken("user-34");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: `SENSITIVE_BUDGET_QUESTION_MARKER ${BUDGET_QUESTION}` });

    const serialized = JSON.stringify(res.body);
    expect(res.body).not.toHaveProperty("context");
    expect(res.body).not.toHaveProperty("fields");
    expect(res.body).not.toHaveProperty("sourceReportGeneratedAt");
    expect(res.body).not.toHaveProperty("userId");
    expect(serialized).not.toContain("SENSITIVE_BUDGET_PROVIDER_NAME");
    expect(serialized).not.toContain("SENSITIVE_STATUS_MARKER");
    expect(serialized).not.toContain("SENSITIVE_BUDGET_QUESTION_MARKER");
    expect(serialized).not.toContain("internal budget provider detail");
    expect(serialized).not.toContain("7777");
    expect(serialized).not.toContain("6666");
    expect(serialized).not.toContain("85.5");
    expect(Object.keys(res.body).sort()).toEqual(["message", "success"]);
  });

  it("public budget success responses contain no context, fields, sourceReportGeneratedAt, userId, or raw data", async () => {
    const authenticatedUserId = "user-should-not-leak-budget-35";
    const token = signToken(authenticatedUserId);
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeBudgetContext(),
      askLlmImpl: async () => ({ answer: "Budget explanation text.", model: "m", latencyMs: 1 }),
    });

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: BUDGET_QUESTION });

    const serialized = JSON.stringify(res.body);
    // Structural leak checks -- not contradictory substring assertions
    // against the legitimate, server-owned basedOn path name "budgets".
    expect(res.body).not.toHaveProperty("context");
    expect(res.body).not.toHaveProperty("fields");
    expect(res.body).not.toHaveProperty("sourceReportGeneratedAt");
    expect(res.body).not.toHaveProperty("userId");
    expect(serialized).not.toContain(authenticatedUserId);
    // Raw context values (never the field names, which legitimately appear
    // nowhere in this fixture's basedOn path anyway) are absent.
    expect(serialized).not.toContain("5000"); // fixture's raw budget limit
    expect(serialized).not.toContain("3200"); // fixture's raw spent amount
    expect(res.body.basedOn).toEqual(["budgets"]);
    // "budgets" (plural, the canonical report.budgets source path) must be
    // used -- never the singular "budget", which is only this context's
    // own internal field name.
    expect(res.body.basedOn).not.toContain("budget");
    expect(Object.keys(res.body).sort()).toEqual(["answer", "basedOn", "intent", "success"]);
  });

  it("does not mutate the request body or the buildContext-returned context object for a budget question", async () => {
    const fakeContext = fakeBudgetContext();
    const contextSnapshot = JSON.parse(JSON.stringify(fakeContext));
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeContext,
      askLlmImpl: async () => ({ answer: "Budget explanation text.", model: "m", latencyMs: 1 }),
    });
    const token = signToken("user-36");
    const requestBody = { question: BUDGET_QUESTION };
    const bodySnapshot = JSON.parse(JSON.stringify(requestBody));

    await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(requestBody);

    expect(requestBody).toEqual(bodySnapshot);
    expect(fakeContext).toEqual(contextSnapshot);
  });

  it("keeps health, spending, and budget prompts, contexts, and formatters isolated across three back-to-back requests on the same app instance", async () => {
    const { app, askLlmMock, buildContextMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async (userId, intent) => {
        if (intent === "HEALTH_EXPLANATION") return fakeHealthContext();
        if (intent === "SPENDING_CHANGE_EXPLANATION") return fakeSpendingContext();
        return fakeBudgetContext();
      },
      askLlmImpl: async ({ systemPrompt }) => {
        let answer = "Health answer.";
        if (systemPrompt.includes("spending change")) answer = "Spending answer.";
        else if (systemPrompt.includes("current budget status")) answer = "Budget answer.";
        return { answer, model: "mock-model", latencyMs: 1 };
      },
    });
    const token = signToken("user-37");

    const healthRes = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });
    const spendingRes = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: SPENDING_QUESTION });
    const budgetRes = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: BUDGET_QUESTION });

    expect(healthRes.body).toEqual({
      success: true,
      answer: "Health answer.",
      intent: "HEALTH_EXPLANATION",
      basedOn: ["financialHealth", "financialHealth.overall", "financialHealth.risk.label"],
    });
    expect(spendingRes.body).toEqual({
      success: true,
      answer: "Spending answer.",
      intent: "SPENDING_CHANGE_EXPLANATION",
      basedOn: ["trends", "trends.monthlyTrend", "summary.comparePastMonth", "summary.totalSpent"],
    });
    expect(budgetRes.body).toEqual({
      success: true,
      answer: "Budget answer.",
      intent: "BUDGET_STATUS_EXPLANATION",
      basedOn: ["budgets"],
    });

    expect(buildContextMock).toHaveBeenNthCalledWith(1, "user-37", "HEALTH_EXPLANATION");
    expect(buildContextMock).toHaveBeenNthCalledWith(2, "user-37", "SPENDING_CHANGE_EXPLANATION");
    expect(buildContextMock).toHaveBeenNthCalledWith(3, "user-37", "BUDGET_STATUS_EXPLANATION");
    expect(askLlmMock.mock.calls[0][0].systemPrompt).toEqual(expect.stringContaining("financial-health result"));
    expect(askLlmMock.mock.calls[1][0].systemPrompt).toEqual(expect.stringContaining("spending change"));
    expect(askLlmMock.mock.calls[2][0].systemPrompt).toEqual(expect.stringContaining("current budget status"));
    // Each intent's context argument is exactly its own fixture, never a
    // different intent's context.
    expect(askLlmMock.mock.calls[0][0].context.intent).toBe("HEALTH_EXPLANATION");
    expect(askLlmMock.mock.calls[1][0].context.intent).toBe("SPENDING_CHANGE_EXPLANATION");
    expect(askLlmMock.mock.calls[2][0].context.intent).toBe("BUDGET_STATUS_EXPLANATION");
  });

  // -- M2-4B: CATEGORY_SPENDING_EXPLANATION -----------------------------------
  // Exposes the already-committed M2-4A category context through the same
  // POST /sia/ask pipeline. No new route, no controller-flow change --
  // only a new prompt, grounding path, and no-data message exist.

  it("calls buildContext exactly once with the authenticated req.userId and CATEGORY_SPENDING_EXPLANATION, ignoring a malicious body/query userId", async () => {
    const { app, buildContextMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeCategoryContext(),
    });

    const token = signToken("user-cat-1");

    await request(app)
      .post("/sia/ask?userId=attacker-query")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CATEGORY_QUESTION, userId: "attacker-body", user: "attacker-body-2" });

    expect(buildContextMock).toHaveBeenCalledTimes(1);
    expect(buildContextMock).toHaveBeenCalledWith("user-cat-1", "CATEGORY_SPENDING_EXPLANATION");
  });

  it("calls askLlm exactly once with the fixed category system prompt, the narrow category context result, and the trimmed question", async () => {
    const categoryContext = fakeCategoryContext();
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => categoryContext,
      askLlmImpl: async () => ({ answer: "Groceries is your largest category.", model: "test", latencyMs: 1 }),
    });

    const token = signToken("user-cat-2");

    await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: `   ${CATEGORY_QUESTION}   ` });

    expect(askLlmMock).toHaveBeenCalledTimes(1);
    const callArg = askLlmMock.mock.calls[0][0];
    expect(callArg.question).toBe(CATEGORY_QUESTION);
    expect(callArg.context).toBe(categoryContext);
    expect(typeof callArg.systemPrompt).toBe("string");
    expect(callArg.systemPrompt.length).toBeGreaterThan(0);
    // Scoped to the six M2-4A aggregates, and explicitly read-only.
    expect(callArg.systemPrompt).toEqual(expect.stringContaining("category spending"));
    expect(callArg.systemPrompt).toEqual(expect.stringContaining("read-only"));
    expect(callArg.systemPrompt).toEqual(expect.stringContaining("Treat the context as authoritative"));
  });

  it("returns the exact category 200 public contract with the real grounding path on a mocked LLM success", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeCategoryContext(),
      askLlmImpl: async () => ({ answer: "Groceries accounted for the largest share.", model: "test", latencyMs: 1 }),
    });

    const token = signToken("user-cat-3");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CATEGORY_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: "Groceries accounted for the largest share.",
      intent: "CATEGORY_SPENDING_EXPLANATION",
      basedOn: ["categories.monthly"],
    });
    // Specifically the monthly path -- not the bare parent, which would
    // wrongly imply the excluded yearly branch is grounded too.
    expect(res.body.basedOn).not.toContain("categories");
    expect(res.body.basedOn).not.toContain("categories.yearly");
  });

  it("returns the exact fixed category 200 no-data response and does not call askLlm", async () => {
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => ({
        intent: "CATEGORY_SPENDING_EXPLANATION",
        fields: null,
        reason: "no_data",
      }),
    });

    const token = signToken("user-cat-4");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CATEGORY_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: CATEGORY_NO_DATA_ANSWER,
      intent: "CATEGORY_SPENDING_EXPLANATION",
      basedOn: ["none"],
    });
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("returns 422 for an ambiguous cross-domain category question and calls neither buildContext nor askLlm", async () => {
    const ambiguousQuestions = [
      "Which category should I cut to stay under budget?",
      "Which category is hurting my financial health?",
      "Predict my highest spending category next month.",
      "Show my categories.",
      "Create a category.",
    ];

    for (const question of ambiguousQuestions) {
      const { app, buildContextMock, askLlmMock } = loadApp({
        configOverrides: { enabled: true },
      });

      const token = signToken("user-cat-5");

      const res = await request(app)
        .post("/sia/ask")
        .set("Authorization", `Bearer ${token}`)
        .send({ question });

      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        success: false,
        message: "Question not recognized for the intents SIA currently supports.",
      });
      expect(buildContextMock).not.toHaveBeenCalled();
      expect(askLlmMock).not.toHaveBeenCalled();
    }
  });

  it("returns a generic 503 for category when askLlm rejects with LlmProviderError", async () => {
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeCategoryContext(),
      askLlmImpl: async () => {
        throw new LlmProviderError("SIA has no LLM provider configured.", {
          code: "PROVIDER_NOT_CONFIGURED",
          provider: null,
        });
      },
    });

    const token = signToken("user-cat-6");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CATEGORY_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 for category when askLlm resolves with a blank, missing, or non-string answer", async () => {
    for (const badResult of [
      { answer: "   ", model: "test", latencyMs: 1 },
      { model: "test", latencyMs: 1 },
      { answer: 42, model: "test", latencyMs: 1 },
      null,
    ]) {
      const { app } = loadApp({
        configOverrides: { enabled: true },
        buildContextImpl: async () => fakeCategoryContext(),
        askLlmImpl: async () => badResult,
      });

      const token = signToken("user-cat-7");

      const res = await request(app)
        .post("/sia/ask")
        .set("Authorization", `Bearer ${token}`)
        .send({ question: CATEGORY_QUESTION });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    }
  });

  it("returns a generic 503 for category when buildContext unexpectedly rejects", async () => {
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => {
        throw new Error("reportService exploded with 4321 and user-cat-8");
      },
    });

    const token = signToken("user-cat-8");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CATEGORY_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("category error responses never expose prompts, questions, context, provider details, stack traces, or financial values", async () => {
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeCategoryContext(),
      askLlmImpl: async () => {
        throw new LlmProviderError("Provider acme-llm rejected the request.", {
          code: "PROVIDER_NOT_IMPLEMENTED",
          provider: "acme-llm",
        });
      },
    });

    const token = signToken("user-cat-9");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CATEGORY_QUESTION });

    const serialized = JSON.stringify(res.body);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    for (const leak of [
      "acme-llm",
      "PROVIDER_NOT_IMPLEMENTED",
      "Groceries",
      "categoryDistribution",
      "concentrationIndex",
      "1234.56",
      "user-cat-9",
      "stack",
      "SIA, BALENISA",
      CATEGORY_QUESTION,
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("public category success responses contain no context, fields, sourceReportGeneratedAt, userId, or raw data", async () => {
    const authenticatedUserId = "user-cat-should-not-leak-10";
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeCategoryContext(),
      askLlmImpl: async () => ({ answer: "Category answer.", model: "test", latencyMs: 1 }),
    });

    const token = signToken(authenticatedUserId);

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CATEGORY_QUESTION });

    const serialized = JSON.stringify(res.body);
    expect(Object.keys(res.body).sort()).toEqual(["answer", "basedOn", "intent", "success"]);
    expect(res.body).not.toHaveProperty("fields");
    expect(res.body).not.toHaveProperty("context");
    expect(res.body).not.toHaveProperty("sourceReportGeneratedAt");
    for (const leak of [
      authenticatedUserId,
      "sourceReportGeneratedAt",
      "categoryDistribution",
      "categoryGrowth",
      "concentrationIndex",
      "top3Concentration",
      "topCategory",
      "Groceries",
      "1234.56",
      "expenseAmount",
      "rawExpenses",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("does not mutate the request body or the buildContext-returned context object for a category question", async () => {
    const categoryContext = fakeCategoryContext();
    const contextSnapshot = JSON.parse(JSON.stringify(categoryContext));
    const { app, buildContextMock, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => categoryContext,
      askLlmImpl: async () => ({ answer: "Category answer.", model: "test", latencyMs: 1 }),
    });
    const token = signToken("user-cat-11");

    const body = { question: CATEGORY_QUESTION, extra: "keep-me" };
    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send(body);

    // The immutability assertions below are only meaningful if the request
    // actually reached the controller and exercised the full pipeline --
    // an authentication rejection would leave both objects untouched and
    // pass vacuously. These three assertions make that impossible.
    expect(res.status).toBe(200);
    expect(buildContextMock).toHaveBeenCalledTimes(1);
    expect(askLlmMock).toHaveBeenCalledTimes(1);

    expect(body).toEqual({ question: CATEGORY_QUESTION, extra: "keep-me" });
    expect(categoryContext).toEqual(contextSnapshot);
  });

  it("keeps all four intents' prompts, contexts, and formatters isolated across back-to-back requests on the same app instance", async () => {
    const contextsByIntent = {
      HEALTH_EXPLANATION: fakeHealthContext(),
      SPENDING_CHANGE_EXPLANATION: fakeSpendingContext(),
      BUDGET_STATUS_EXPLANATION: fakeBudgetContext(),
      CATEGORY_SPENDING_EXPLANATION: fakeCategoryContext(),
    };
    const answersByIntent = {
      HEALTH_EXPLANATION: "Health answer.",
      SPENDING_CHANGE_EXPLANATION: "Spending answer.",
      BUDGET_STATUS_EXPLANATION: "Budget answer.",
      CATEGORY_SPENDING_EXPLANATION: "Category answer.",
    };
    const { app, buildContextMock, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async (_userId, intent) => contextsByIntent[intent],
      askLlmImpl: async ({ context }) => ({
        answer: answersByIntent[context.intent],
        model: "test",
        latencyMs: 1,
      }),
    });

    const token = signToken("user-cat-12");
    const healthRes = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send({ question: HEALTH_QUESTION });
    const spendingRes = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send({ question: SPENDING_QUESTION });
    const budgetRes = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send({ question: BUDGET_QUESTION });
    const categoryRes = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send({ question: CATEGORY_QUESTION });

    expect(healthRes.body.intent).toBe("HEALTH_EXPLANATION");
    expect(spendingRes.body.intent).toBe("SPENDING_CHANGE_EXPLANATION");
    expect(budgetRes.body.intent).toBe("BUDGET_STATUS_EXPLANATION");
    expect(categoryRes.body).toEqual({
      success: true,
      answer: "Category answer.",
      intent: "CATEGORY_SPENDING_EXPLANATION",
      basedOn: ["categories.monthly"],
    });

    expect(buildContextMock).toHaveBeenNthCalledWith(4, "user-cat-12", "CATEGORY_SPENDING_EXPLANATION");
    expect(askLlmMock.mock.calls[3][0].systemPrompt).toEqual(expect.stringContaining("category spending"));
    expect(askLlmMock.mock.calls[3][0].context.intent).toBe("CATEGORY_SPENDING_EXPLANATION");
    // Each intent kept its own prompt -- no cross-contamination.
    expect(askLlmMock.mock.calls[0][0].systemPrompt).not.toBe(askLlmMock.mock.calls[3][0].systemPrompt);
    expect(askLlmMock.mock.calls[1][0].systemPrompt).not.toBe(askLlmMock.mock.calls[3][0].systemPrompt);
    expect(askLlmMock.mock.calls[2][0].systemPrompt).not.toBe(askLlmMock.mock.calls[3][0].systemPrompt);
  });
});

// M3-1: question max-length validation and the dedicated SIA rate limiter.
// Still uses loadApp() (real Routes/sia.routes.js + Middlewares/Auth.js +
// utils/rateLimiter.js's real siaLimiter, mocked sia/* modules), so every
// app instance here is created fresh via jest.resetModules() -- each test
// gets its own, empty siaLimiter store. No real MongoDB, Redis, or OpenAI
// call is possible: buildContext/askLlm remain mocked, and the 429/401
// tests below never get far enough to reach them anyway.
describe("POST /sia/ask -- M3-1 input validation and rate limiting", () => {
  it("returns 400 when question is null", async () => {
    const { app } = loadApp({ configOverrides: { enabled: true } });
    const token = signToken("m3-1-null");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: null });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "question is required" });
  });

  it("returns 400 when question is an empty string", async () => {
    const { app } = loadApp({ configOverrides: { enabled: true } });
    const token = signToken("m3-1-empty-string");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "question is required" });
  });

  it("returns 400 and rejects a question longer than 500 characters, calling neither the classifier, buildContext, nor askLlm", async () => {
    const { app, classifyIntentMock, buildContextMock, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
    });
    const token = signToken("m3-1-oversized");
    const oversizedQuestion = "a".repeat(501);

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: oversizedQuestion });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "question must be 500 characters or fewer" });
    expect(classifyIntentMock).not.toHaveBeenCalled();
    expect(buildContextMock).not.toHaveBeenCalled();
    expect(askLlmMock).not.toHaveBeenCalled();
    // The rejected question is never echoed back.
    expect(JSON.stringify(res.body)).not.toContain(oversizedQuestion);
  });

  it("accepts a question of exactly 500 characters and passes the classifier the trimmed value, not the padded raw value", async () => {
    const exactly500 = "b".repeat(500);
    const { app, classifyIntentMock } = loadApp({
      configOverrides: { enabled: true },
      classifyIntentImpl: () => null,
    });
    const token = signToken("m3-1-exact-500");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: `  ${exactly500}  ` });

    // Reaches classification (proving the length check passed) and is then
    // reported as unrecognized -- 422, not 400.
    expect(res.status).toBe(422);
    expect(classifyIntentMock).toHaveBeenCalledWith(exactly500);
  });

  it("trims surrounding whitespace before the 500-char check, so padded-but-500-after-trim questions are accepted", async () => {
    const { app } = loadApp({ configOverrides: { enabled: true }, classifyIntentImpl: () => null });
    const token = signToken("m3-1-trim-before-check");
    const paddedButValid = `   ${"c".repeat(500)}   `;

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: paddedButValid });

    expect(res.status).not.toBe(400);
  });

  it("an unauthenticated request returns the existing 401 and never reaches the SIA limiter, classifier, buildContext, or askLlm", async () => {
    const { app, classifyIntentMock, buildContextMock, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
    });

    const res = await request(app).post("/sia/ask").send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(401);
    expect(classifyIntentMock).not.toHaveBeenCalled();
    expect(buildContextMock).not.toHaveBeenCalled();
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it(
    "allows the first 20 authenticated requests from one user and returns 429 with sanitized headers/body on the 21st",
    async () => {
      const { app } = loadApp({ configOverrides: { enabled: false } });
      const token = signToken("m3-1-quota-single-user");
      const sensitiveQuestion = "SENSITIVE_QUESTION_MARKER";

      const responses = [];
      for (let i = 0; i < 21; i += 1) {
        // Sequential by design: express-rate-limit's in-memory store counts
        // per request, so requests must be awaited one at a time to get a
        // deterministic 20-then-429 boundary.
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app)
          .post("/sia/ask")
          .set("Authorization", `Bearer ${token}`)
          .send({ question: sensitiveQuestion });
        responses.push(res);
      }

      const firstTwenty = responses.slice(0, 20);
      const twentyFirst = responses[20];

      expect(firstTwenty.every((res) => res.status !== 429)).toBe(true);
      expect(twentyFirst.status).toBe(429);
      expect(twentyFirst.body).toEqual({
        success: false,
        message: "Too many requests. Please try again later.",
      });
      // standardHeaders: true / legacyHeaders: false -- the same convention
      // as the existing apiLimiter/authLimiter in utils/rateLimiter.js.
      expect(twentyFirst.headers).toHaveProperty("ratelimit-limit");
      expect(twentyFirst.headers).not.toHaveProperty("x-ratelimit-limit");
      // Never leaks the question or the authenticated userId.
      expect(JSON.stringify(twentyFirst.body)).not.toContain(sensitiveQuestion);
      expect(JSON.stringify(twentyFirst.body)).not.toContain("m3-1-quota-single-user");
    },
    20000
  );

  it(
    "gives two different authenticated users independent 20-request quotas",
    async () => {
      const { app } = loadApp({ configOverrides: { enabled: false } });
      const tokenA = signToken("m3-1-user-a");
      const tokenB = signToken("m3-1-user-b");

      for (let i = 0; i < 20; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const res = await request(app)
          .post("/sia/ask")
          .set("Authorization", `Bearer ${tokenA}`)
          .send({ question: "q" });
        expect(res.status).not.toBe(429);
      }

      // User A has now exhausted their quota; user B's independent quota is
      // untouched.
      const userBRes = await request(app)
        .post("/sia/ask")
        .set("Authorization", `Bearer ${tokenB}`)
        .send({ question: "q" });
      expect(userBRes.status).not.toBe(429);

      const userANextRes = await request(app)
        .post("/sia/ask")
        .set("Authorization", `Bearer ${tokenA}`)
        .send({ question: "q" });
      expect(userANextRes.status).toBe(429);
    },
    20000
  );
});

// M3-2: timeout/provider-failure graceful degradation. ask.js's single
// generic try/catch (established in M2-1) already treats every rejected
// buildContext/askLlm call identically -- these tests prove that guarantee
// specifically for the real, distinct M1-3 OpenAI failure codes (timeout,
// network, HTTP, malformed/incomplete response, empty output), not just a
// generic LlmProviderError, and confirm no retry happens at the controller
// layer either. No production code changed for this milestone: the
// controller's catch block never branches on err.code, so no partial or
// code-specific response is possible.
describe("POST /sia/ask -- M3-2 timeout and graceful degradation", () => {
  it.each([
    ["PROVIDER_TIMEOUT", "SIA's request to the LLM provider timed out."],
    ["PROVIDER_NETWORK_ERROR", "SIA could not reach the LLM provider."],
    ["PROVIDER_HTTP_ERROR", "The LLM provider returned an error response."],
    ["PROVIDER_MALFORMED_RESPONSE", "The LLM provider returned a malformed response."],
    ["PROVIDER_RESPONSE_INCOMPLETE", "The LLM provider did not return a completed response."],
    ["PROVIDER_EMPTY_OUTPUT", "The LLM provider returned no usable answer text."],
  ])(
    "degrades to the exact same generic 503 contract for %s, calling askLlm exactly once (no retry)",
    async (code, internalMessage) => {
      const { app, askLlmMock, LlmProviderError } = loadApp({
        configOverrides: { enabled: true },
        buildContextImpl: async () => fakeHealthContext(),
        askLlmImpl: async () => {
          throw new LlmProviderError(internalMessage, { code, provider: "openai" });
        },
      });
      const token = signToken(`m3-2-${code.toLowerCase()}`);

      const res = await request(app)
        .post("/sia/ask")
        .set("Authorization", `Bearer ${token}`)
        .send({ question: HEALTH_QUESTION });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
      expect(askLlmMock).toHaveBeenCalledTimes(1);
      // The internal, code-specific provider message is never leaked to the client.
      expect(JSON.stringify(res.body)).not.toContain(internalMessage);
      expect(JSON.stringify(res.body)).not.toContain(code);
    }
  );

  it("returns exactly one HTTP response and no partial answer when askLlm times out", async () => {
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeHealthContext(),
      askLlmImpl: async () => {
        throw new LlmProviderError("SIA's request to the LLM provider timed out.", {
          code: "PROVIDER_TIMEOUT",
          provider: "openai",
        });
      },
    });
    const token = signToken("m3-2-single-response");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(503);
    expect(Object.keys(res.body).sort()).toEqual(["message", "success"]);
    expect(res.body.answer).toBeUndefined();
    expect(res.body.intent).toBeUndefined();
    expect(res.body.basedOn).toBeUndefined();
  });
});

// M3-3: safe structured logging around the askLlm() call site. loadApp()
// leaves backend/sia/safeLogger.js real (unmocked) so these tests observe
// the actual console.log output, not a mock's call arguments. The
// suite-wide consoleLogSpy (installed/restored by the file-level
// beforeEach/afterEach above) is reused here rather than re-spied.
describe("POST /sia/ask -- M3-3 safe structured logging", () => {
  function loggedRecords() {
    return consoleLogSpy.mock.calls
      .map(([line]) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((record) => record && record.scope === "sia");
  }

  it("logs exactly one provider_request_completed record on a successful answer, and the 200 response is unchanged", async () => {
    const { app } = loadApp({
      // provider must be explicitly mocked as "openai" here: loadApp()'s
      // base config mock defaults provider to null, and the controller logs
      // config.provider verbatim (the normalized configured provider), so
      // an incomplete mock would wrongly assert on a null provider instead
      // of exercising the real "openai" logging contract.
      configOverrides: { enabled: true, provider: "openai" },
      buildContextImpl: async () => fakeHealthContext(),
      askLlmImpl: async () => ({ answer: "Your score reflects Low risk.", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("m3-3-success");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const records = loggedRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      scope: "sia",
      level: "info",
      event: "provider_request_completed",
      provider: "openai",
    });
    expect(typeof records[0].timestamp).toBe("string");
    expect(typeof records[0].latencyMs).toBe("number");
    expect(records[0].latencyMs).toBeGreaterThanOrEqual(0);
    expect(records[0].errorCode).toBeNull();
  });

  it.each([
    ["PROVIDER_TIMEOUT", "SIA's request to the LLM provider timed out."],
    ["PROVIDER_NETWORK_ERROR", "SIA could not reach the LLM provider."],
    ["PROVIDER_HTTP_ERROR", "The LLM provider returned an error response."],
  ])(
    "logs exactly one provider_request_failed record with only the normalized code %s, and the 503 response is unchanged",
    async (code, internalMessage) => {
      const { app, LlmProviderError } = loadApp({
        configOverrides: { enabled: true, provider: "openai" },
        buildContextImpl: async () => fakeHealthContext(),
        askLlmImpl: async () => {
          throw new LlmProviderError(internalMessage, { code, provider: "openai" });
        },
      });
      const token = signToken(`m3-3-${code.toLowerCase()}`);

      const res = await request(app)
        .post("/sia/ask")
        .set("Authorization", `Bearer ${token}`)
        .send({ question: HEALTH_QUESTION });

      expect(res.status).toBe(503);
      expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });

      const records = loggedRecords();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        scope: "sia",
        level: "error",
        event: "provider_request_failed",
        provider: "openai",
        errorCode: code,
      });
      expect(typeof records[0].latencyMs).toBe("number");

      // The internal message, stack, and raw error are never logged.
      const serializedLog = JSON.stringify(records[0]);
      expect(serializedLog).not.toContain(internalMessage);
      expect(serializedLog).not.toContain("Error");
      expect(serializedLog).not.toContain("stack");
    }
  );

  it("logs no financial context, question, answer, userId, or provider message in any emitted record", async () => {
    const sensitiveContext = fakeHealthContext({
      fields: { financialHealth: { overall: 12, risk: { label: "SENSITIVE_RISK_MARKER", color: "red" } } },
    });
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => sensitiveContext,
      askLlmImpl: async () => ({ answer: "SENSITIVE_ANSWER_MARKER", model: "mock-model", latencyMs: 3 }),
    });
    const token = signToken("m3-3-no-leak-user-id-marker");
    const sensitiveQuestion = "SENSITIVE_QUESTION_MARKER";

    await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: sensitiveQuestion });

    const allLoggedLines = consoleLogSpy.mock.calls.map(([line]) => line).join("\n");
    expect(allLoggedLines).not.toContain(sensitiveQuestion);
    expect(allLoggedLines).not.toContain("SENSITIVE_ANSWER_MARKER");
    expect(allLoggedLines).not.toContain("SENSITIVE_RISK_MARKER");
    expect(allLoggedLines).not.toContain("m3-3-no-leak-user-id-marker");
    expect(allLoggedLines).not.toContain("mock-model");
  });

  it("a console.log/sink failure never alters the successful API response", async () => {
    // Reconfigures the already-installed suite-wide spy rather than
    // creating a second, nested spy on console.log.
    consoleLogSpy.mockImplementation(() => {
      throw new Error("sink failure");
    });
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeHealthContext(),
      askLlmImpl: async () => ({ answer: "Your score reflects Low risk.", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("m3-3-sink-failure-success");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.answer).toBe("Your score reflects Low risk.");
  });

  it("a console.log/sink failure never alters the degraded 503 response", async () => {
    // Reconfigures the already-installed suite-wide spy rather than
    // creating a second, nested spy on console.log.
    consoleLogSpy.mockImplementation(() => {
      throw new Error("sink failure");
    });
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeHealthContext(),
      askLlmImpl: async () => {
        throw new LlmProviderError("SIA's request to the LLM provider timed out.", {
          code: "PROVIDER_TIMEOUT",
          provider: "openai",
        });
      },
    });
    const token = signToken("m3-3-sink-failure-degraded");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("does not log any SIA event for a disabled-feature (503), invalid-input (400), or unsupported-intent (422) request", async () => {
    const { app: disabledApp } = loadApp({ configOverrides: { enabled: false } });
    const disabledRes = await request(disabledApp)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${signToken("m3-3-disabled")}`)
      .send({ question: HEALTH_QUESTION });
    expect(disabledRes.status).toBe(503);

    const { app: invalidApp } = loadApp({ configOverrides: { enabled: true } });
    const invalidRes = await request(invalidApp)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${signToken("m3-3-invalid")}`)
      .send({ question: "   " });
    expect(invalidRes.status).toBe(400);

    const { app: unsupportedApp } = loadApp({ configOverrides: { enabled: true } });
    const unsupportedRes = await request(unsupportedApp)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${signToken("m3-3-unsupported")}`)
      .send({ question: "How much did I spend?" });
    expect(unsupportedRes.status).toBe(422);

    expect(loggedRecords()).toHaveLength(0);
  });

  it("does not log any SIA event for a no-data (200) response", async () => {
    // Reuses the exact mock arrangement and expected response contract from
    // the already-established "returns the exact fixed 200 no-data
    // response and does not call askLlm" test above: formatNoDataResponse()
    // returns success: true with a fixed canned explanation, not
    // success: false -- there is no error here, just insufficient report
    // data. This test only adds the M3-3 zero-logging assertion on top of
    // that unchanged, already-passing contract.
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => ({ intent: "HEALTH_EXPLANATION", fields: null, reason: "no_data" }),
    });
    const token = signToken("m3-3-no-data");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: "I do not have enough financial report data yet to explain your financial health score.",
      intent: "HEALTH_EXPLANATION",
      basedOn: ["none"],
    });
    expect(askLlmMock).not.toHaveBeenCalled();
    expect(loggedRecords()).toHaveLength(0);
  });
});

// M3-4: grounding metadata provenance. backend/sia/responseFormatter.js's
// formatExplanationResponse(intent, answer) only ever reads two arguments --
// the server-classified intent (from classifyIntent, computed before
// buildContext/askLlm are even called) and the LLM's plain answer string --
// and looks basedOn up from its own fixed, server-owned
// GROUNDING_PATHS_BY_INTENT map. It never reads llmResult.intent or
// llmResult.basedOn. No existing test proves this against an adversarial or
// malformed provider result, so this is the one material coverage gap for
// M3-4: nothing currently demonstrates that a provider response cannot
// inject or override the response's grounding metadata.
describe("POST /sia/ask -- M3-4 grounding metadata provenance", () => {
  it("ignores an intent/basedOn injected by a (mocked) provider result -- intent and basedOn always come from the server, never the LLM", async () => {
    const { app, classifyIntentMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeHealthContext(),
      // A malicious or malformed provider result cannot legitimately return
      // `intent`/`basedOn` (askLlm's real success shape is only
      // {answer, model, latencyMs}) -- this simulates one anyway to prove
      // the controller/formatter never reads those fields even if present.
      askLlmImpl: async () => ({
        answer: "Your score reflects Low risk.",
        model: "mock-model",
        latencyMs: 5,
        intent: "SPENDING_CHANGE_EXPLANATION",
        basedOn: ["provider_injected_fake_path"],
      }),
    });
    const token = signToken("m3-4-no-provider-override");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: HEALTH_QUESTION });

    expect(res.status).toBe(200);
    // intent came from the deterministic server-side classifier (called
    // with the trimmed question, before buildContext/askLlm run), not the
    // provider result.
    expect(classifyIntentMock).toHaveBeenCalledWith(HEALTH_QUESTION);
    expect(res.body).toEqual({
      success: true,
      answer: "Your score reflects Low risk.",
      intent: "HEALTH_EXPLANATION",
      basedOn: ["financialHealth", "financialHealth.overall", "financialHealth.risk.label"],
    });
    expect(res.body.intent).not.toBe("SPENDING_CHANGE_EXPLANATION");
    expect(res.body.basedOn).not.toContain("provider_injected_fake_path");
  });
});
