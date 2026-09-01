"use strict";
const jwt = require("jsonwebtoken");
const request = require("supertest");
const JWT_SECRET = "sia-active-session-direct-test-secret";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0d1";
const SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0d2";

function loadApp() {
  jest.resetModules(); process.env.JWT_SECRET = JWT_SECRET;
  const findOwnedSession = jest.fn(async (_userId, sessionId) => ({ _id: sessionId, user: USER_ID }));
  const loadRecentTurns = jest.fn(async () => [{ role: "user", content: "Earlier question" }]);
  const appendTurn = jest.fn(async () => ({}));
  jest.doMock("../sia/config", () => ({ enabled: true, provider: "groq", model: "test", appTimeZone: "Asia/Kolkata" }));
  jest.doMock("../sia/readiness", () => ({ isSiaReady: () => true }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => true }));
  jest.doMock("../sia/financialSnapshotService", () => ({ buildFinancialSnapshot: jest.fn(async () => ({ ok: true, snapshot: { period: { label: "this month" }, analytics: {}, income: {} } })) }));
  const answerDirectly = jest.fn(async () => ({ ok: true, answer: "Your current answer." }));
  jest.doMock("../sia/directAnswerService", () => ({ answerDirectly }));
  jest.doMock("../sia/sessionService", () => ({ findOwnedSession, loadRecentTurns, appendTurn, createSession: jest.fn(), getOrCreateSession: jest.fn(), listSessions: jest.fn(), listMessages: jest.fn(), deleteSession: jest.fn() }));
  return { app: require("../app"), findOwnedSession, loadRecentTurns, appendTurn, answerDirectly };
}
function post(app, body) { return request(app).post("/sia/ask").set("Authorization", `Bearer ${jwt.sign({ _id: USER_ID }, JWT_SECRET)}`).send(body); }
afterEach(() => jest.resetModules());
describe("POST /sia/ask active session", () => {
  it("loads owned history, passes it to direct answering, and appends one grounded turn", async () => {
    const { app, findOwnedSession, loadRecentTurns, answerDirectly, appendTurn } = loadApp();
    const res = await post(app, { question: "How does this month compare to last month?", sessionId: SESSION_ID });
    expect(res.status).toBe(200);
    expect(findOwnedSession).toHaveBeenCalledWith(USER_ID, SESSION_ID);
    expect(loadRecentTurns).toHaveBeenCalledWith(SESSION_ID, USER_ID);
    expect(answerDirectly).toHaveBeenCalledWith(expect.objectContaining({ history: [{ role: "user", content: "Earlier question" }] }));
    expect(appendTurn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION_ID, grounding: res.body.grounding }));
  });
});
