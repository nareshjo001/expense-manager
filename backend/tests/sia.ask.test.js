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
      basedOn: [],
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
});
