// Route/controller tests for the Batch 2 SIA session endpoints:
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const TEST_JWT_SECRET = "sia-sessions-test-secret";
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

afterEach(() => {
  jest.resetModules();
});

function signToken(userId) {
  return jwt.sign({ email: "sia-sessions-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

function loadApp({ listSessionsImpl, listMessagesImpl, deleteSessionImpl } = {}) {
  jest.resetModules();

  const listSessionsMock = jest.fn(listSessionsImpl || (async () => []));
  const listMessagesMock = jest.fn(listMessagesImpl || (async () => null));
  const deleteSessionMock = jest.fn(deleteSessionImpl || (async () => false));

  jest.doMock("../sia/sessionService", () => ({
    listSessions: listSessionsMock,
    listMessages: listMessagesMock,
    deleteSession: deleteSessionMock,
    getOrCreateSession: jest.fn(),
    appendTurn: jest.fn(),
    loadRecentTurns: jest.fn(async () => []),
  }));

  const app = require("../app");
  return { app, listSessionsMock, listMessagesMock, deleteSessionMock };
}

const VALID_ID = "64f1a2b3c4d5e6f7a8b9c0d1";

describe("GET /sia/sessions", () => {
  it("returns 401 for an unauthenticated request without calling sessionService", async () => {
    const { app, listSessionsMock } = loadApp();
    const res = await request(app).get("/sia/sessions");
    expect(res.status).toBe(401);
    expect(listSessionsMock).not.toHaveBeenCalled();
  });

  it("lists only the authenticated caller's own sessions, using req.userId and never a client-supplied one", async () => {
    const { app, listSessionsMock } = loadApp({
      listSessionsImpl: async () => [
        { _id: VALID_ID, title: null, messageCount: 4, lastMessageAt: new Date("2026-08-08T00:00:00.000Z"), createdAt: new Date(), updatedAt: new Date() },
      ],
    });
    const token = signToken("user-1");

    const res = await request(app)
      .get("/sia/sessions?userId=someone-else")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sessions).toEqual([
      expect.objectContaining({ sessionId: VALID_ID, messageCount: 4 }),
    ]);
    expect(listSessionsMock).toHaveBeenCalledWith("user-1", { limit: undefined });
  });
});

describe("GET /sia/sessions/:sessionId/messages", () => {
  it("returns a non-disclosing 404 for a session that does not belong to this user", async () => {
    const { app, listMessagesMock } = loadApp({ listMessagesImpl: async () => null });
    const token = signToken("user-1");

    const res = await request(app)
      .get(`/sia/sessions/${VALID_ID}/messages`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, message: "Session not found." });
    expect(listMessagesMock).toHaveBeenCalledWith(VALID_ID, "user-1", { limit: undefined, before: undefined });
  });

  it("returns the identical 404 body for a nonexistent session id as for a foreign-owned one (non-disclosing)", async () => {
    const { app: app1 } = loadApp({ listMessagesImpl: async () => null });
    const token = signToken("user-1");
    const res1 = await request(app1).get(`/sia/sessions/${VALID_ID}/messages`).set("Authorization", `Bearer ${token}`);

    const { app: app2 } = loadApp({ listMessagesImpl: async () => null });
    const res2 = await request(app2).get(`/sia/sessions/000000000000000000000000/messages`).set("Authorization", `Bearer ${token}`);

    expect(res1.status).toBe(res2.status);
    expect(res1.body).toEqual(res2.body);
  });

  it("returns bounded, ownership-scoped messages for an owned session", async () => {
    const { app, listMessagesMock } = loadApp({
      listMessagesImpl: async () => ({
        session: { _id: VALID_ID },
        messages: [{ role: "user", content: "Hi", intent: "HEALTH_EXPLANATION", createdAt: new Date() }],
      }),
    });
    const token = signToken("user-1");

    const res = await request(app)
      .get(`/sia/sessions/${VALID_ID}/messages?limit=5`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(VALID_ID);
    expect(res.body.messages).toHaveLength(1);
    expect(listMessagesMock).toHaveBeenCalledWith(VALID_ID, "user-1", { limit: "5", before: undefined });
  });
});

describe("DELETE /sia/sessions/:sessionId", () => {
  it("returns a non-disclosing 404 for a session that does not belong to this user", async () => {
    const { app, deleteSessionMock } = loadApp({ deleteSessionImpl: async () => false });
    const token = signToken("user-1");

    const res = await request(app)
      .delete(`/sia/sessions/${VALID_ID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(deleteSessionMock).toHaveBeenCalledWith(VALID_ID, "user-1");
  });

  it("deletes an owned session and returns 200 -- financial write actions remain out of scope of this endpoint entirely", async () => {
    const { app } = loadApp({ deleteSessionImpl: async () => true });
    const token = signToken("user-1");

    const res = await request(app)
      .delete(`/sia/sessions/${VALID_ID}`)
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "Session deleted." });
  });
});
