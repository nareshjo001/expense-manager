"use strict";
const jwt = require("jsonwebtoken");
const request = require("supertest");
const JWT_SECRET = "sia-readiness-direct-test-secret";

function loadApp(ready) {
  jest.resetModules();
  process.env.JWT_SECRET = JWT_SECRET;
  const snapshot = jest.fn(async () => ({ ok: true, snapshot: { period: { label: "this month" }, analytics: {}, income: {} } }));
  const answer = jest.fn(async () => ({ ok: true, answer: "Ready." }));
  jest.doMock("../sia/config", () => ({ enabled: true, provider: "groq", model: "test", appTimeZone: "Asia/Kolkata" }));
  jest.doMock("../sia/readiness", () => ({ isSiaReady: () => ready }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => false }));
  jest.doMock("../sia/financialSnapshotService", () => ({ buildFinancialSnapshot: snapshot }));
  jest.doMock("../sia/directAnswerService", () => ({ answerDirectly: answer }));
  return { app: require("../app"), snapshot, answer };
}
function post(app) {
  return request(app).post("/sia/ask").set("Authorization", `Bearer ${jwt.sign({ _id: "64f1a2b3c4d5e6f7a8b9c0d1" }, JWT_SECRET)}`).send({ question: "What did I spend this month?" });
}
afterEach(() => jest.resetModules());
describe("POST /sia/ask readiness gate", () => {
  it("fails closed before snapshot or provider work when SIA is not ready", async () => {
    const { app, snapshot, answer } = loadApp(false);
    const res = await post(app);
    expect(res.status).toBe(503);
    expect(snapshot).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });
  it("uses the direct answer workflow when ready", async () => {
    const { app, snapshot, answer } = loadApp(true);
    const res = await post(app);
    expect(res.status).toBe(200);
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(answer).toHaveBeenCalledTimes(1);
  });
});
