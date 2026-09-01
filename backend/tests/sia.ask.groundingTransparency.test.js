"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const JWT_SECRET = "sia-direct-grounding-persistence-test-secret";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0d1";
const SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0d2";

function loadApp() {
  jest.resetModules();
  process.env.JWT_SECRET = JWT_SECRET;

  const createSession = jest.fn(async () => ({ _id: SESSION_ID, user: USER_ID }));
  const findOwnedSession = jest.fn(async (_userId, sessionId) => ({ _id: sessionId, user: USER_ID }));
  const appendTurn = jest.fn(async () => ({ deduplicated: false }));
  jest.doMock("../sia/config", () => ({ enabled: true, provider: "groq", model: "test", appTimeZone: "Asia/Kolkata" }));
  jest.doMock("../sia/readiness", () => ({ isSiaReady: () => true }));
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => true }));
  jest.doMock("../sia/financialSnapshotService", () => ({
    buildFinancialSnapshot: jest.fn(async () => ({ ok: true, snapshot: { period: { label: "August 2026" }, analytics: {}, income: {} } })),
  }));
  jest.doMock("../sia/directAnswerService", () => ({ answerDirectly: jest.fn(async () => ({ ok: true, answer: "Your August result is ready." })) }));
  jest.doMock("../sia/sessionService", () => ({
    createSession,
    findOwnedSession,
    appendTurn,
    loadRecentTurns: jest.fn(async () => []),
    getOrCreateSession: jest.fn(),
    listSessions: jest.fn(async () => []),
    listMessages: jest.fn(async () => null),
    deleteSession: jest.fn(async () => false),
  }));

  return { app: require("../app"), createSession, findOwnedSession, appendTurn };
}

function post(app, body) {
  const token = jwt.sign({ _id: USER_ID, email: "sia-history@example.test" }, JWT_SECRET);
  return request(app).post("/sia/ask").set("Authorization", `Bearer ${token}`).send(body);
}

afterEach(() => jest.resetModules());

describe("POST /sia/ask direct-answer grounding persistence", () => {
  it("persists the exact response grounding for a new conversation", async () => {
    const { app, createSession, appendTurn } = loadApp();
    const res = await post(app, { question: "How does this month compare to last month?" });

    expect(res.status).toBe(200);
    expect(createSession).toHaveBeenCalledWith(USER_ID, "How does this month compare to last month?");
    expect(res.body.sessionId).toBe(SESSION_ID);
    expect(appendTurn).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: SESSION_ID,
      grounding: res.body.grounding,
      intent: null,
    }));
  });

  it("uses an owned existing session and persists the same grounding", async () => {
    const { app, createSession, findOwnedSession, appendTurn } = loadApp();
    const res = await post(app, { question: "What is my net cash flow this month?", sessionId: SESSION_ID });

    expect(res.status).toBe(200);
    expect(findOwnedSession).toHaveBeenCalledWith(USER_ID, SESSION_ID);
    expect(createSession).not.toHaveBeenCalled();
    expect(appendTurn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: SESSION_ID, grounding: res.body.grounding }));
  });
});
