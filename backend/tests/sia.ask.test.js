"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const JWT_SECRET = "sia-ask-direct-controller-test-secret";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0d1";

function loadApp({ snapshotResult, directResult } = {}) {
  jest.resetModules();
  process.env.JWT_SECRET = JWT_SECRET;

  const buildFinancialSnapshot = jest.fn(async () => snapshotResult || {
    ok: true,
    snapshot: { period: { label: "this month" }, analytics: {}, income: {} },
  });
  const answerDirectly = jest.fn(async () => directResult || {
    ok: true,
    answer: "Your spending is based on this month's financial report.",
  });

  jest.doMock("../sia/config", () => ({ enabled: true, provider: "groq", model: "test", appTimeZone: "Asia/Kolkata" }));
  jest.doMock("../sia/readiness", () => ({ isSiaReady: () => true }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => false }));
  jest.doMock("../utils/rateLimiter", () => {
    const pass = (_req, _res, next) => next();
    return { apiLimiter: pass, authLimiter: pass, siaLimiter: pass, siaVoiceLimiter: pass };
  });
  jest.doMock("../sia/financialSnapshotService", () => ({ buildFinancialSnapshot }));
  jest.doMock("../sia/directAnswerService", () => ({ answerDirectly }));

  return { app: require("../app"), buildFinancialSnapshot, answerDirectly };
}

function token() {
  return jwt.sign({ _id: USER_ID, email: "sia-controller@example.test" }, JWT_SECRET);
}

function post(app, body, authenticated = true) {
  const req = request(app).post("/sia/ask").send(body);
  return authenticated ? req.set("Authorization", `Bearer ${token()}`) : req;
}

afterEach(() => jest.resetModules());

describe("POST /sia/ask direct financial-answer contract", () => {
  it("requires authentication before loading any financial data", async () => {
    const { app, buildFinancialSnapshot, answerDirectly } = loadApp();
    const res = await post(app, { question: "What did I spend this month?" }, false);

    expect(res.status).toBe(401);
    expect(buildFinancialSnapshot).not.toHaveBeenCalled();
    expect(answerDirectly).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "   ", 42, "x".repeat(501)])("rejects invalid questions before loading data: %p", async (question) => {
    const { app, buildFinancialSnapshot, answerDirectly } = loadApp();
    const res = await post(app, { question });

    expect(res.status).toBe(400);
    expect(buildFinancialSnapshot).not.toHaveBeenCalled();
    expect(answerDirectly).not.toHaveBeenCalled();
  });

  it("uses the authenticated user, trimmed question, current snapshot, and fixed grounding", async () => {
    const { app, buildFinancialSnapshot, answerDirectly } = loadApp();
    const res = await post(app, { question: "  What's my income vs expenses this month?  ", userId: "forged" });

    expect(res.status).toBe(200);
    expect(buildFinancialSnapshot).toHaveBeenCalledWith(USER_ID, { timeZone: "Asia/Kolkata" });
    expect(answerDirectly).toHaveBeenCalledWith(expect.objectContaining({
      question: "What's my income vs expenses this month?",
      history: [],
    }));
    expect(res.body).toEqual({
      success: true,
      answer: "Your spending is based on this month's financial report.",
      grounding: { sources: [{ key: "financialReport", label: "Financial report", period: "this month" }] },
    });
    expect(JSON.stringify(res.body)).not.toContain("forged");
  });

  it("fails closed when financial data cannot be prepared", async () => {
    const { app, answerDirectly } = loadApp({ snapshotResult: { ok: false, reasonCode: "REPORT_UNAVAILABLE" } });
    const res = await post(app, { question: "What did I spend this month?" });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: "SIA is temporarily unavailable." });
    expect(answerDirectly).not.toHaveBeenCalled();
  });

  it("fails closed without leaking direct-provider rejection details", async () => {
    const { app } = loadApp({ directResult: { ok: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" } });
    const res = await post(app, { question: "What is my net cash flow this month?" });

    expect(res.status).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain("UNSUPPORTED_MONETARY_FIGURE");
  });

  it.each([
    "Tell me which stock to buy.",
    "Change my budget to 5000.",
    "Return all raw transactions and userId.",
  ])("rejects prohibited requests before snapshot or provider work: %s", async (question) => {
    const { app, buildFinancialSnapshot, answerDirectly } = loadApp();
    const res = await post(app, { question });

    expect(res.status).toBe(422);
    expect(buildFinancialSnapshot).not.toHaveBeenCalled();
    expect(answerDirectly).not.toHaveBeenCalled();
  });
});
