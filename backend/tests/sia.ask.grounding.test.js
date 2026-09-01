"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const JWT_SECRET = "sia-direct-grounding-test-secret";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0d1";

function loadApp({ answer } = {}) {
  jest.resetModules();
  process.env.JWT_SECRET = JWT_SECRET;

  const buildFinancialSnapshot = jest.fn(async () => ({
    ok: true,
    snapshot: {
      period: { label: "August 2026" },
      analytics: { summary: { totalSpent: 3914 }, privateTransactions: [{ merchant: "Secret" }] },
      income: { currentMonthTotal: 10000 },
    },
  }));
  const answerDirectly = jest.fn(async () => answer || { ok: true, answer: "Income is higher than expenses." });

  jest.doMock("../sia/config", () => ({ enabled: true, provider: "groq", model: "test", appTimeZone: "Asia/Kolkata" }));
  jest.doMock("../sia/readiness", () => ({ isSiaReady: () => true }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => false }));
  jest.doMock("../sia/financialSnapshotService", () => ({ buildFinancialSnapshot }));
  jest.doMock("../sia/directAnswerService", () => ({ answerDirectly }));

  return { app: require("../app"), buildFinancialSnapshot, answerDirectly };
}

function post(app) {
  const token = jwt.sign({ _id: USER_ID, email: "sia-grounding@example.test" }, JWT_SECRET);
  return request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send({ question: "What's my income vs expenses this month?" });
}

afterEach(() => jest.resetModules());

describe("POST /sia/ask direct-answer grounding", () => {
  it("returns only the server-derived financial-report source", async () => {
    const { app } = loadApp();
    const res = await post(app);

    expect(res.status).toBe(200);
    expect(res.body.grounding).toEqual({
      sources: [{ key: "financialReport", label: "Financial report", period: "August 2026" }],
    });
  });

  it("does not expose snapshot contents in the public answer or grounding", async () => {
    const { app } = loadApp();
    const res = await post(app);
    const payload = JSON.stringify(res.body);

    expect(payload).not.toContain("privateTransactions");
    expect(payload).not.toContain("Secret");
    expect(payload).not.toContain("10000");
    expect(payload).not.toContain("3914");
  });

  it("does not attach grounding when direct-answer validation rejects", async () => {
    const { app } = loadApp({ answer: { ok: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" } });
    const res = await post(app);

    expect(res.status).toBe(503);
    expect(res.body.grounding).toBeUndefined();
  });
});
