"use strict";
const jwt = require("jsonwebtoken");
const request = require("supertest");
const JWT_SECRET = "sia-direct-provenance-test-secret";

function loadApp() {
  jest.resetModules(); process.env.JWT_SECRET = JWT_SECRET;
  const snapshot = { period: { label: "August 2026" }, analytics: { summary: { totalSpent: 4250 } }, income: { currentMonthTotal: 10000 } };
  const buildFinancialSnapshot = jest.fn(async () => ({ ok: true, snapshot }));
  const answerDirectly = jest.fn(async () => ({ ok: true, answer: "Income exceeds spending." }));
  jest.doMock("../sia/config", () => ({ enabled: true, provider: "groq", model: "test", appTimeZone: "Asia/Kolkata" }));
  jest.doMock("../sia/readiness", () => ({ isSiaReady: () => true }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => false }));
  jest.doMock("../sia/financialSnapshotService", () => ({ buildFinancialSnapshot }));
  jest.doMock("../sia/directAnswerService", () => ({ answerDirectly }));
  return { app: require("../app"), snapshot, answerDirectly };
}
afterEach(() => jest.resetModules());
describe("SIA direct-answer provenance", () => {
  it("passes the exact server-built financial report to direct answering and reports only its period as provenance", async () => {
    const { app, snapshot, answerDirectly } = loadApp();
    const token = jwt.sign({ _id: "64f1a2b3c4d5e6f7a8b9c0d1" }, JWT_SECRET);
    const res = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send({ question: "What's my income vs expenses this month?" });
    expect(res.status).toBe(200);
    expect(answerDirectly).toHaveBeenCalledWith(expect.objectContaining({ snapshot }));
    expect(res.body.grounding).toEqual({ sources: [{ key: "financialReport", label: "Financial report", period: "August 2026" }] });
  });
});
