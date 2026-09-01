"use strict";
const jwt = require("jsonwebtoken");
const request = require("supertest");
const JWT_SECRET = "sia-summary-direct-test-secret";

function loadApp() {
  jest.resetModules(); process.env.JWT_SECRET = JWT_SECRET;
  const snapshot = jest.fn(async () => ({ ok: true, snapshot: { period: { label: "this month" }, analytics: { summary: { totalSpent: 4321.55 } }, income: {} } }));
  const answer = jest.fn(async () => ({ ok: true, answer: "You spent ₹4,321.55 this month." }));
  jest.doMock("../sia/config", () => ({ enabled: true, provider: "groq", model: "test", appTimeZone: "Asia/Kolkata" }));
  jest.doMock("../sia/readiness", () => ({ isSiaReady: () => true }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => false }));
  jest.doMock("../sia/financialSnapshotService", () => ({ buildFinancialSnapshot: snapshot }));
  jest.doMock("../sia/directAnswerService", () => ({ answerDirectly: answer }));
  return { app: require("../app"), snapshot, answer };
}
afterEach(() => jest.resetModules());
describe("POST /sia/ask current-spending question", () => {
  it("sends the natural-language question and current financial report directly to SIA", async () => {
    const { app, snapshot, answer } = loadApp();
    const token = jwt.sign({ _id: "64f1a2b3c4d5e6f7a8b9c0d1" }, JWT_SECRET);
    const res = await request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send({ question: "How much did I spend this month?" });
    expect(res.status).toBe(200);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ question: "How much did I spend this month?", snapshot: expect.objectContaining({ analytics: expect.any(Object) }) }));
    expect(res.body.answer).toBe("You spent ₹4,321.55 this month.");
  });
});
