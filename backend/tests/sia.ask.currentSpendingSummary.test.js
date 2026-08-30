// Route/controller tests for POST /sia/ask -- CURRENT_SPENDING_SUMMARY.
//
// Mirrors tests/sia.ask.test.js's loadApp() isolation pattern exactly:
// backend/sia/config, intentClassifier, contextBuilder, and llmService are
// all mocked per test -- no real environment variable, MongoDB, Redis, ML
// service, or provider call is ever made.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-ask-current-spending-summary-test-secret";
const originalJwtSecret = process.env.JWT_SECRET;
const FAKE_CREDENTIAL = "test-credential-value-not-a-real-key";
const originalOpenAiKey = process.env.OPENAI_API_KEY;

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

afterEach(() => {
  jest.resetModules();
});

let consoleLogSpy;
beforeEach(() => {
  consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  consoleLogSpy.mockRestore();
});

function signToken(userId) {
  return jwt.sign({ email: "sia-ask-current-spending-summary-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

// Workstream-1-fix addition: routeQuestionImpl/financialQueryServiceImpl
// mock the semantic-router/financial-query boundaries DIRECTLY, mirroring
// tests/sia.ask.test.js's loadApp() -- see that file's own comment for the
// full rationale (askLlmMock must represent ONLY answer-generation calls,
// never the router's internal provider call too).
function loadApp({
  configOverrides = {},
  classifyIntentImpl,
  buildContextImpl,
  askLlmImpl,
  routeQuestionImpl,
  financialQueryServiceImpl = {},
} = {}) {
  jest.resetModules();

  jest.doMock("../sia/config", () => ({
    enabled: false,
    provider: "openai",
    model: "sia-test-model",
    timeoutMs: 8000,
    ...configOverrides,
  }));

  const { classifyIntent: realClassifyIntent } = jest.requireActual("../sia/intentClassifier");
  const classifyIntentMock = jest.fn(classifyIntentImpl || realClassifyIntent);
  jest.doMock("../sia/intentClassifier", () => ({ classifyIntent: classifyIntentMock }));

  const buildContextMock = jest.fn(
    buildContextImpl || (async () => ({ intent: "CURRENT_SPENDING_SUMMARY", fields: null, reason: "no_data" }))
  );
  jest.doMock("../sia/contextBuilder", () => ({ buildContext: buildContextMock }));

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

  const routeQuestionMock = jest.fn(
    routeQuestionImpl || (async () => ({ ok: false, reason: "TEST_ROUTER_NOT_CONFIGURED" }))
  );
  jest.doMock("../sia/semanticRouter", () => {
    const actual = jest.requireActual("../sia/semanticRouter");
    return { ...actual, routeQuestion: routeQuestionMock };
  });

  const realFinancialQueryService = jest.requireActual("../sia/financialQueryService");
  const financialQueryServiceMock = {};
  for (const key of Object.keys(realFinancialQueryService)) {
    financialQueryServiceMock[key] =
      typeof realFinancialQueryService[key] === "function"
        ? jest.fn(financialQueryServiceImpl[key] || (async () => ({ hasData: false, reasonCode: "TEST_NOT_CONFIGURED" })))
        : realFinancialQueryService[key];
  }
  jest.doMock("../sia/financialQueryService", () => financialQueryServiceMock);

  const app = require("../app");
  return {
    app,
    classifyIntentMock,
    buildContextMock,
    askLlmMock,
    routeQuestionMock,
    financialQueryServiceMock,
    LlmProviderError: RealLlmProviderError,
  };
}

const CURRENT_SPENDING_SUMMARY_QUESTION = "What is my current month's total spent ?";

function fakeCurrentSpendingSummaryContext(overrides = {}) {
  return {
    intent: "CURRENT_SPENDING_SUMMARY",
    fields: { summary: { totalSpent: 4321.55 } },
    sourceReportGeneratedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("POST /sia/ask -- CURRENT_SPENDING_SUMMARY", () => {
  it("classifies the exact production question and returns 200 with the real intent on a mocked LLM success", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeCurrentSpendingSummaryContext(),
      askLlmImpl: async () => ({
        answer: "Your total spending so far this month is $4321.55.",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-css-1");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CURRENT_SPENDING_SUMMARY_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: "Your total spending so far this month is $4321.55.",
      intent: "CURRENT_SPENDING_SUMMARY",
      basedOn: ["summary.totalSpent"],
      grounding: { sources: [{ key: "summary", label: "Financial summary" }] },
    });
  });

  it("calls askLlm exactly once with the fixed current-spending-summary system prompt and the narrow context result", async () => {
    const fakeContext = fakeCurrentSpendingSummaryContext();
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeContext,
      askLlmImpl: async () => ({ answer: "Mocked total answer.", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-css-2");

    await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: `  ${CURRENT_SPENDING_SUMMARY_QUESTION}  ` });

    expect(askLlmMock).toHaveBeenCalledTimes(1);
    expect(askLlmMock).toHaveBeenCalledWith({
      systemPrompt: expect.stringContaining("You are SIA"),
      context: fakeContext,
      question: CURRENT_SPENDING_SUMMARY_QUESTION,
      history: [],
    });
    const usedPrompt = askLlmMock.mock.calls[0][0].systemPrompt;
    expect(usedPrompt).toEqual(expect.stringContaining("current month's total spending"));
    expect(usedPrompt).toEqual(expect.stringContaining("Do not give financial, tax, legal, or investment advice"));
    expect(usedPrompt).not.toEqual(expect.stringContaining("financial-health result"));
    expect(usedPrompt).not.toEqual(expect.stringContaining("spending change"));
  });

  it("returns the exact fixed no-data 200 response using the existing shared no-data contract, and never calls askLlm", async () => {
    const { app, askLlmMock } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => ({ intent: "CURRENT_SPENDING_SUMMARY", fields: null, reason: "no_data" }),
    });
    const token = signToken("user-css-3");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CURRENT_SPENDING_SUMMARY_QUESTION });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      answer: "I do not have enough financial report data yet to tell you your current month's total spending.",
      intent: "CURRENT_SPENDING_SUMMARY",
      basedOn: ["none"],
    });
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("returns 422 for a truly unsupported question and never calls buildContext or askLlm", async () => {
    const { app, buildContextMock, askLlmMock } = loadApp({ configOverrides: { enabled: true } });
    const token = signToken("user-css-4");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "What's the weather today?" });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      success: false,
      message: "Question not recognized for the intents SIA currently supports.",
    });
    expect(buildContextMock).not.toHaveBeenCalled();
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  // Advice and list-style questions in this family are clearly prohibited
  // pre-router (see sia/prohibitedPhrases.js) -- each must 422 with ZERO
  // provider calls of any kind, proven against both askLlmMock (answer
  // calls) and routeQuestionMock (router calls) independently.
  //
  // Workstream-1-fix: "How much did I spend last month?" and "What was my
  // total spending in August?" were REMOVED from this list -- under the
  // semantic-router architecture they are no longer the old flat
  // generic-unsupported case (that was pre-semantic-router behavior).
  // "last month" is a fully-resolvable period, so that question is now a
  // genuine semantic-supported EXPENSE_TOTAL lookup; "August" without a
  // year is genuinely ambiguous, so that question now gets a bounded
  // clarification. Both have their own dedicated tests below, each with
  // the router boundary mocked directly (never a live provider).
  it.each([
    ["How much should I spend this month?"],
    ["How much can I spend this month?"],
    ["List my total transactions this month."],
    ["Give me a list of my total spending this month."],
  ])(
    "returns 422 for the unsupported question %j and never calls the router, buildContext, or askLlm",
    async (question) => {
      const { app, buildContextMock, askLlmMock, routeQuestionMock } = loadApp({ configOverrides: { enabled: true } });
      const token = signToken("user-css-5");

      const res = await request(app)
        .post("/sia/ask")
        .set("Authorization", `Bearer ${token}`)
        .send({ question });

      expect(res.status).toBe(422);
      expect(routeQuestionMock).not.toHaveBeenCalled();
      expect(buildContextMock).not.toHaveBeenCalled();
      expect(askLlmMock).not.toHaveBeenCalled();
    }
  );

  it("returns a semantic-supported deterministic EXPENSE_TOTAL answer for a resolvable-period question (1 router call, 0 answer calls)", async () => {
    const { formatInr } = require("../sia/semanticPipeline");
    const { app, buildContextMock, askLlmMock, routeQuestionMock } = loadApp({
      configOverrides: { enabled: true },
      routeQuestionImpl: async () => ({
        ok: true,
        plan: {
          version: 1,
          outcome: "supported",
          metrics: ["EXPENSE_TOTAL"],
          operation: "LOOKUP",
          period: { type: "PREVIOUS_MONTH" },
          grouping: "NONE",
          responseMode: "DETERMINISTIC",
        },
      }),
      financialQueryServiceImpl: {
        getExpenseTotal: async () => ({ hasData: true, value: 1234.56, count: 7 }),
      },
    });
    const token = signToken("user-css-lastmonth");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "How much did I spend last month?" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.answer).toBe(`You spent ${formatInr(1234.56)} last month.`);
    expect(routeQuestionMock).toHaveBeenCalledTimes(1);
    // Deterministic answer -- rendered in backend code from the
    // financialQueryService result, never a provider/answer-generation call.
    expect(askLlmMock).not.toHaveBeenCalled();
    // Never routed through the CURRENT_SPENDING_SUMMARY explanation-intent
    // pipeline (buildContext is that pipeline's own boundary) -- this
    // question is answered entirely via the semantic-lookup path instead.
    expect(buildContextMock).not.toHaveBeenCalled();
  });

  // Regression baseline for the reported category-total defect. These
  // questions must not use CURRENT_SPENDING_SUMMARY because that context
  // contains only the overall total. The expected route is the existing
  // semantic lookup path, which can request CATEGORY_TOTAL for Food.
  // This test is intentionally red until Module 1 tightens the classifier
  // boundary.
  it.each([
    "Can you my current month total spending on food?",
    "How much did I spend on Food this month?",
  ])(
    "routes the category-total question %j through semantic CATEGORY_TOTAL lookup",
    async (question) => {
      const { formatInr } = require("../sia/semanticPipeline");
      const { app, buildContextMock, askLlmMock, routeQuestionMock, financialQueryServiceMock } = loadApp({
        configOverrides: { enabled: true },
        routeQuestionImpl: async () => ({
          ok: true,
          plan: {
            version: 1,
            outcome: "supported",
            metrics: ["CATEGORY_TOTAL"],
            operation: "LOOKUP",
            period: { type: "CURRENT_MONTH" },
            grouping: "NONE",
            categoryFilter: "Food",
            responseMode: "DETERMINISTIC",
          },
        }),
        financialQueryServiceImpl: {
          getCategoryTotal: async () => ({ hasData: true, value: 765.43, count: 4 }),
        },
      });
      const token = signToken("user-css-category-total");

      const res = await request(app)
        .post("/sia/ask")
        .set("Authorization", `Bearer ${token}`)
        .send({ question });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.answer).toBe(`You spent ${formatInr(765.43)} on Food this month.`);
      expect(routeQuestionMock).toHaveBeenCalledTimes(1);
      expect(financialQueryServiceMock.getCategoryTotal).toHaveBeenCalledTimes(1);
      expect(buildContextMock).not.toHaveBeenCalled();
      expect(askLlmMock).not.toHaveBeenCalled();
    }
  );

  it("returns a bounded clarification for a named-month-without-year question (1 router call, 0 answer calls)", async () => {
    const clarificationPlan = {
      version: 1,
      outcome: "clarification",
      clarification: {
        reason: "MISSING_YEAR",
        prompt: "Which August do you mean?",
        options: [
          { id: "2026-08", label: "August 2026" },
          { id: "2025-08", label: "August 2025" },
        ],
      },
    };
    const { app, buildContextMock, askLlmMock, routeQuestionMock } = loadApp({
      configOverrides: { enabled: true },
      routeQuestionImpl: async () => ({ ok: true, plan: clarificationPlan }),
    });
    const token = signToken("user-css-august");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "What was my total spending in August?" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      clarification: {
        prompt: "Which August do you mean?",
        options: [
          { id: "2026-08", label: "August 2026" },
          { id: "2025-08", label: "August 2025" },
        ],
      },
    });
    expect(routeQuestionMock).toHaveBeenCalledTimes(1);
    expect(buildContextMock).not.toHaveBeenCalled();
    expect(askLlmMock).not.toHaveBeenCalled();
  });

  it("returns a generic 503 when askLlm resolves with a blank answer", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeCurrentSpendingSummaryContext(),
      askLlmImpl: async () => ({ answer: "   ", model: "mock-model", latencyMs: 5 }),
    });
    const token = signToken("user-css-6");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CURRENT_SPENDING_SUMMARY_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 when askLlm rejects with LlmProviderError", async () => {
    const { app, LlmProviderError } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeCurrentSpendingSummaryContext(),
      askLlmImpl: async () => {
        throw new LlmProviderError("Provider timed out.", { code: "TIMEOUT", provider: "openai" });
      },
    });
    const token = signToken("user-css-7");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CURRENT_SPENDING_SUMMARY_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });

  it("returns a generic 503 when the grounded-answer validator rejects the answer (e.g. an unsupported comparison claim), and never leaks the reason to the client", async () => {
    const { app } = loadApp({
      configOverrides: { enabled: true },
      buildContextImpl: async () => fakeCurrentSpendingSummaryContext(),
      askLlmImpl: async () => ({
        answer: "You've spent $4321.55 this month, which is higher than last month.",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-css-8");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: CURRENT_SPENDING_SUMMARY_QUESTION });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
  });
});
