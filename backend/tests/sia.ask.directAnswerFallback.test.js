"use strict";

// SIA-001-T03/T05 -- proves handleDirectAnswer() in ask.js (a) records
// sia_ask metrics via recordOperation() and (b) routes every failure path
// through fallbackMessages.js's category lookup instead of a single flat
// UNAVAILABLE_RESPONSE, so provider-transient failures, oversized-context
// rejections and validator rejections are distinguishable to the client
// without leaking provider/code detail (SIA-001-T01's non-disclosure
// posture, preserved).

const jwt = require("jsonwebtoken");
const request = require("supertest");

const JWT_SECRET = "sia-direct-answer-fallback-test-secret";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0d1";

function token() {
  return jwt.sign({ _id: USER_ID, email: "sia-fallback@example.test" }, JWT_SECRET);
}

function loadApp({ answerDirectlyImpl }) {
  jest.resetModules();
  process.env.JWT_SECRET = JWT_SECRET;
  jest.doMock("../sia/config", () => ({ enabled: true, provider: "groq", model: "test", appTimeZone: "Asia/Kolkata" }));
  jest.doMock("../sia/readiness", () => ({ isSiaReady: () => true }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => false }));
  jest.doMock("../sia/financialSnapshotService", () => ({
    buildFinancialSnapshot: jest.fn(async () => ({
      ok: true,
      snapshot: { period: { label: "this month" }, analytics: { summary: { totalSpent: 4250 } }, income: { currentMonthTotal: 10000 } },
    })),
  }));
  jest.doMock("../sia/directAnswerService", () => ({ answerDirectly: jest.fn(answerDirectlyImpl) }));
  const recordOperation = jest.fn();
  jest.doMock("../utils/metrics", () => ({
    ...jest.requireActual("../utils/metrics"),
    recordOperation,
  }));
  const app = require("../app");
  return { app, recordOperation };
}

async function askQuestion(app) {
  return request(app)
    .post("/sia/ask")
    .set("Authorization", `Bearer ${token()}`)
    .send({ question: "What is my net cash flow this month?" });
}

afterEach(() => jest.resetModules());

describe("POST /sia/ask direct-answer path -- metrics + fallback categories", () => {
  it("records a successful sia_ask operation and returns 200", async () => {
    const { app, recordOperation } = loadApp({
      answerDirectlyImpl: async () => ({ ok: true, answer: "Your net cash flow is positive this month." }),
    });
    const res = await askQuestion(app);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const directAnswerCalls = recordOperation.mock.calls.filter(([arg]) => arg.operation === "direct_answer");
    expect(directAnswerCalls).toHaveLength(1);
    expect(directAnswerCalls[0][0]).toMatchObject({ scope: "sia_ask", operation: "direct_answer", outcome: "success" });
    expect(typeof directAnswerCalls[0][0].durationMs).toBe("number");

    const validationCalls = recordOperation.mock.calls.filter(([arg]) => arg.operation === "answer_validation");
    expect(validationCalls).toHaveLength(1);
    expect(validationCalls[0][0]).toMatchObject({ scope: "sia_ask", operation: "answer_validation", outcome: "success" });
  }, 60000);

  it("returns ANSWER_UNAVAILABLE (503) and records failure when the validator rejects the draft answer", async () => {
    const { app, recordOperation } = loadApp({
      answerDirectlyImpl: async () => ({ ok: false, reasonCode: "RAW_DATA_LEAKAGE" }),
    });
    const res = await askQuestion(app);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: "ANSWER_UNAVAILABLE" });
    expect(res.body.message).not.toMatch(/leakage|RAW_DATA/i);

    const directAnswerCalls = recordOperation.mock.calls.filter(([arg]) => arg.operation === "direct_answer");
    expect(directAnswerCalls[0][0]).toMatchObject({ outcome: "failure" });
    const validationCalls = recordOperation.mock.calls.filter(([arg]) => arg.operation === "answer_validation");
    expect(validationCalls[0][0]).toMatchObject({ outcome: "failure" });
  }, 30000);

  it("returns RETRY_SHORTLY (503) for a transient provider error without leaking the provider or code", async () => {
    const llmService = require("../sia/llmService");
    const { app, recordOperation } = loadApp({
      answerDirectlyImpl: async () => {
        throw new llmService.LlmProviderError("upstream timed out", { code: "PROVIDER_TIMEOUT", provider: "groq" });
      },
    });
    const res = await askQuestion(app);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: "RETRY_SHORTLY" });
    expect(JSON.stringify(res.body)).not.toMatch(/groq|PROVIDER_TIMEOUT/);

    const directAnswerCalls = recordOperation.mock.calls.filter(([arg]) => arg.operation === "direct_answer");
    expect(directAnswerCalls[0][0]).toMatchObject({ outcome: "failure" });
  }, 30000);

  it("returns QUESTION_TOO_COMPLEX (422) when the provider call is rejected for exceeding the context budget", async () => {
    const llmService = require("../sia/llmService");
    const { app } = loadApp({
      answerDirectlyImpl: async () => {
        throw new llmService.LlmProviderError("context too large", { code: "CONTEXT_BUDGET_EXCEEDED" });
      },
    });
    const res = await askQuestion(app);

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, code: "QUESTION_TOO_COMPLEX" });
  }, 30000);

  it("falls back to the generic UNAVAILABLE (503) category for an unrecognized/non-provider error", async () => {
    const { app } = loadApp({
      answerDirectlyImpl: async () => {
        throw new Error("something structural broke");
      },
    });
    const res = await askQuestion(app);

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: "UNAVAILABLE" });
    expect(JSON.stringify(res.body)).not.toMatch(/structural broke/);
  }, 30000);
});
