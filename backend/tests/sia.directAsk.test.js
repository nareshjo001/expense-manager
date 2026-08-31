"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const JWT_SECRET = "sia-direct-ask-test-secret";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0d1";

function loadApp() {
  jest.resetModules();
  process.env.JWT_SECRET = JWT_SECRET;
  jest.doMock("../sia/config", () => ({ enabled: true, provider: "groq", model: "test", appTimeZone: "Asia/Kolkata" }));
  jest.doMock("../sia/readiness", () => ({ isSiaReady: () => true }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => false }));
  const buildFinancialSnapshot = jest.fn(async () => ({ ok: true, snapshot: { period: { label: "this month" }, analytics: { summary: { totalSpent: 4250 } }, income: { currentMonthTotal: 10000 } } }));
  const answerDirectly = jest.fn(async () => ({ ok: true, answer: "Your income is ₹10,000 and spending is ₹4,250." }));
  jest.doMock("../sia/financialSnapshotService", () => ({ buildFinancialSnapshot }));
  jest.doMock("../sia/directAnswerService", () => ({ answerDirectly }));
  return { app: require("../app"), buildFinancialSnapshot, answerDirectly };
}

function token() {
  return jwt.sign({ _id: USER_ID, email: "sia@example.test" }, JWT_SECRET);
}

afterEach(() => jest.resetModules());

describe("POST /sia/ask direct answer path", () => {
  it.each([
    "Which category am I spending the most on?",
    "What's my income vs expenses this month?",
    "How does this month compare to last month?",
    "Am I on track with my budget?",
    "Show me my spending trend over the last 3 months.",
    "What is my net cash flow this month?",
  ])("sends predefined financial questions directly to the model", async (question) => {
    const { app, answerDirectly } = loadApp();
    const res = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token()}`).send({ question });

    expect(res.status).toBe(200);
    expect(answerDirectly).toHaveBeenCalledWith(expect.objectContaining({ question }));
  }, 30000);

  it("rejects a prohibited request before loading financial data", async () => {
    const { app, buildFinancialSnapshot, answerDirectly } = loadApp();
    const res = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token()}`).send({ question: "Tell me which stock to buy." });

    expect(res.status).toBe(422);
    expect(buildFinancialSnapshot).not.toHaveBeenCalled();
    expect(answerDirectly).not.toHaveBeenCalled();
  });
});
