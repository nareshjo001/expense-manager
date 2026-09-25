"use strict";

// SIA-001-T06 -- route-level proof for the three new endpoints (GET/PUT
// /sia/preferences, DELETE /sia/history) and for POST /sia/ask's new
// SIA_DISABLED_BY_USER enforcement gate. Loads the real Express app via
// supertest, same convention as sia.ask.directAnswerFallback.test.js.

const jwt = require("jsonwebtoken");
const request = require("supertest");

const JWT_SECRET = "sia-preference-routes-test-secret";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0cc";

function token() {
  return jwt.sign({ _id: USER_ID, email: "sia-preference-routes@example.test" }, JWT_SECRET);
}

function loadApp({ preferenceImpl, sessionServiceImpl, sessionStoreAvailable = true } = {}) {
  jest.resetModules();
  process.env.JWT_SECRET = JWT_SECRET;
  if (preferenceImpl) {
    jest.doMock("../sia/siaPreferenceService", () => preferenceImpl);
  }
  if (sessionServiceImpl) {
    jest.doMock("../sia/sessionService", () => ({
      ...jest.requireActual("../sia/sessionService"),
      ...sessionServiceImpl,
    }));
  }
  jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => sessionStoreAvailable }));
  return require("../app");
}

afterEach(() => jest.resetModules());

describe("GET/PUT /sia/preferences", () => {
  it("GET returns enabled:true for a user with no saved preference", async () => {
    const app = loadApp({
      preferenceImpl: {
        getPreference: jest.fn(async () => ({ enabled: true })),
        isEnabledForUser: jest.fn(async () => true),
        setEnabled: jest.fn(),
      },
    });
    const res = await request(app).get("/sia/preferences").set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { enabled: true } });
  }, 60000);

  it("PUT persists a valid boolean and returns the saved preference", async () => {
    const setEnabled = jest.fn(async (userId, enabled) => ({ ok: true, preference: { enabled } }));
    const app = loadApp({
      preferenceImpl: { getPreference: jest.fn(), isEnabledForUser: jest.fn(), setEnabled },
    });
    const res = await request(app)
      .put("/sia/preferences")
      .set("Authorization", `Bearer ${token()}`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: "SIA preference saved", data: { enabled: false } });
    expect(setEnabled).toHaveBeenCalledWith(USER_ID, false);
  }, 60000);

  it("PUT rejects a non-boolean enabled value with 400", async () => {
    const app = loadApp({
      preferenceImpl: {
        getPreference: jest.fn(),
        isEnabledForUser: jest.fn(),
        setEnabled: jest.fn(async () => ({ ok: false, reason: "invalid_enabled" })),
      },
    });
    const res = await request(app)
      .put("/sia/preferences")
      .set("Authorization", `Bearer ${token()}`)
      .send({ enabled: "yes" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  }, 60000);
});

describe("DELETE /sia/history", () => {
  it("deletes the caller's own SIA history, scoped by userId", async () => {
    const deleteAllSessions = jest.fn(async () => ({ sessionsDeleted: 2, messagesDeleted: 9 }));
    const app = loadApp({ sessionServiceImpl: { deleteAllSessions } });
    const res = await request(app).delete("/sia/history").set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: "SIA history deleted.",
      data: { sessionsDeleted: 2, messagesDeleted: 9 },
    });
    expect(deleteAllSessions).toHaveBeenCalledWith(USER_ID);
  }, 60000);

  it("fails closed (503) when the session store is unavailable, without touching sessionService", async () => {
    const deleteAllSessions = jest.fn();
    const app = loadApp({ sessionServiceImpl: { deleteAllSessions }, sessionStoreAvailable: false });
    const res = await request(app).delete("/sia/history").set("Authorization", `Bearer ${token()}`);

    expect(res.status).toBe(503);
    expect(deleteAllSessions).not.toHaveBeenCalled();
  }, 60000);
});

describe("POST /sia/ask -- SIA_DISABLED_BY_USER gate", () => {
  it("returns 403 SIA_DISABLED_BY_USER before any validation or provider work when the user disabled SIA", async () => {
    jest.resetModules();
    process.env.JWT_SECRET = JWT_SECRET;
    jest.doMock("../sia/readiness", () => ({ isSiaReady: () => true }));
    jest.doMock("../sia/siaPreferenceService", () => ({
      isEnabledForUser: jest.fn(async () => false),
      getPreference: jest.fn(),
      setEnabled: jest.fn(),
    }));
    const answerDirectly = jest.fn();
    jest.doMock("../sia/directAnswerService", () => ({ answerDirectly }));
    const app = require("../app");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token()}`)
      .send({ question: "What is my net cash flow this month?" });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ success: false, code: "SIA_DISABLED_BY_USER" });
    expect(answerDirectly).not.toHaveBeenCalled();
  }, 60000);

  it("proceeds normally when the user has not disabled SIA (default enabled)", async () => {
    jest.resetModules();
    process.env.JWT_SECRET = JWT_SECRET;
    jest.doMock("../sia/readiness", () => ({ isSiaReady: () => true }));
    jest.doMock("../sia/siaPreferenceService", () => ({
      isEnabledForUser: jest.fn(async () => true),
      getPreference: jest.fn(),
      setEnabled: jest.fn(),
    }));
    jest.doMock("../sia/sessionStoreAvailability", () => ({ isSessionStoreAvailable: () => false }));
    jest.doMock("../sia/financialSnapshotService", () => ({
      buildFinancialSnapshot: jest.fn(async () => ({
        ok: true,
        snapshot: { period: { label: "this month" }, analytics: { summary: {} }, income: {} },
      })),
    }));
    const answerDirectly = jest.fn(async () => ({ ok: true, answer: "All good." }));
    jest.doMock("../sia/directAnswerService", () => ({ answerDirectly }));
    const app = require("../app");

    const res = await request(app)
      .post("/sia/ask")
      .set("Authorization", `Bearer ${token()}`)
      .send({ question: "What is my net cash flow this month?" });

    expect(res.status).toBe(200);
    expect(answerDirectly).toHaveBeenCalled();
  }, 60000);
});
