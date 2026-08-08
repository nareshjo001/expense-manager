// Batch 2 architecture closure: proves grounded-response validation is
// actually wired into POST /sia/ask for the three new intents -- not just
// unit-tested in isolation (see tests/sia.responseValidator.test.js).
// Mirrors tests/sia.ask.test.js's exact loadApp() isolation pattern.
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

  it("does not run grounded-response validation for the four original intents (unaffected wiring)", async () => {
    const { app } = loadApp({
      buildContextImpl: async () => ({
        intent: "HEALTH_EXPLANATION",
        fields: { financialHealth: { overall: 75, risk: { label: "Low", color: "green" } } },
        sourceReportGeneratedAt: "2026-08-08T00:00:00.000Z",
      }),
      // Content that WOULD fail grounding checks for a validated intent
      // (invented figure, leaked id) must still pass through untouched for
      // an original intent.
      askLlmImpl: async () => ({
        answer: "Your health score is fine, unrelated figure $99999, id 64f1a2b3c4d5e6f7a8b9c0d1.",
        model: "mock-model",
        latencyMs: 5,
      }),
    });
    const token = signToken("user-ground-4");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token}`)
      .send({ question: "Why is my financial health score low?" });

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain("99999");
  });
});
