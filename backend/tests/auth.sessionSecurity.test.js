const jwt = require("jsonwebtoken");

const SESSION_MODEL_PATH = "../models/RefreshSession";
const SESSION_SERVICE_PATH = "../Services/AuthServices/session.service";
const AUTH_MIDDLEWARE_PATH = "../Middlewares/Auth";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

function loadSessionService() {
  jest.resetModules();
  const sessions = [];
  const matches = (session, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === "expiresAt" && value.$gt) return session.expiresAt > value.$gt;
    return String(session[key]) === String(value);
  });
  const RefreshSession = {
    create: jest.fn(async (doc) => {
      const session = { ...doc, _id: `session-${sessions.length + 1}`, revokedAt: null };
      sessions.push(session);
      return session;
    }),
    findOne: jest.fn(async (filter) => sessions.find((session) => matches(session, filter)) || null),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const session = sessions.find((candidate) => matches(candidate, filter));
      if (!session) return null;
      Object.assign(session, update.$set || {});
      return session;
    }),
    updateOne: jest.fn(async (filter, update) => {
      const session = sessions.find((candidate) => matches(candidate, filter));
      if (session) Object.assign(session, update.$set || {});
      return { matchedCount: session ? 1 : 0 };
    }),
    updateMany: jest.fn(async (filter, update) => {
      sessions.filter((session) => matches(session, filter)).forEach((session) => Object.assign(session, update.$set || {}));
      return { modifiedCount: sessions.length };
    }),
  };
  jest.doMock(SESSION_MODEL_PATH, () => RefreshSession);
  return { service: require(SESSION_SERVICE_PATH), RefreshSession, sessions };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("AUTH-001 refresh session lifecycle", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "auth-session-test-secret";
    process.env.REFRESH_TOKEN_SECRET = "auth-session-refresh-test-secret";
    process.env.REFRESH_SESSION_DAYS = "30";
  });

  afterEach(() => {
    delete process.env.REFRESH_TOKEN_SECRET;
    delete process.env.REFRESH_SESSION_DAYS;
  });

  it("persists only HMAC hashes and sends browser-safe cookie options", async () => {
    const { service, RefreshSession } = loadSessionService();
    const created = await service.createSession(USER_ID, { headers: { "user-agent": "test browser" } });

    expect(RefreshSession.create).toHaveBeenCalledWith(expect.objectContaining({ userId: USER_ID }));
    expect(RefreshSession.create.mock.calls[0][0].tokenHash).not.toBe(created.refreshToken);
    expect(RefreshSession.create.mock.calls[0][0].csrfHash).not.toBe(created.csrfToken);
    expect(service.cookieOptions(true)).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(service.cookieOptions(false)).toMatchObject({ httpOnly: false, sameSite: "lax", path: "/" });
  });

  it("rotates an active session and rejects replay of the old refresh token", async () => {
    const { service } = loadSessionService();
    const first = await service.createSession(USER_ID, {});
    const rotated = await service.rotateSession(first.refreshToken, first.csrfToken, {});

    expect(rotated).toEqual(expect.objectContaining({ refreshToken: expect.any(String), csrfToken: expect.any(String) }));
    expect(rotated.refreshToken).not.toBe(first.refreshToken);
    await expect(service.rotateSession(first.refreshToken, first.csrfToken, {})).resolves.toBeNull();
  });

  it("rejects a mismatched CSRF token before rotating a refresh session", async () => {
    const { service } = loadSessionService();
    const first = await service.createSession(USER_ID, {});
    await expect(service.rotateSession(first.refreshToken, "wrong-csrf-token", {})).resolves.toBeNull();
  });
});

describe("AUTH-001 active-session access-token enforcement", () => {
  it("rejects a session-bound access token after server-side revocation", async () => {
    jest.resetModules();
    process.env.JWT_SECRET = "auth-session-test-secret";
    jest.doMock("../Services/AuthServices/session.service", () => ({ isSessionActive: jest.fn(async () => false) }));
    const verifyToken = require(AUTH_MIDDLEWARE_PATH);
    const token = jwt.sign({ _id: USER_ID, sid: "session-1" }, process.env.JWT_SECRET, { expiresIn: "15m" });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await verifyToken(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Invalid or expired token" });
  });
});

describe("AUTH-001 CSRF request validation", () => {
  it("rejects refresh requests whose cookie and header tokens differ", () => {
    jest.resetModules();
    jest.dontMock("../Services/AuthServices/session.service");
    const sessionCsrf = require("../Middlewares/sessionCsrf");
    const req = {
      headers: { cookie: "balensia_csrf=cookie-token" },
      get: jest.fn(() => "header-token"),
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    sessionCsrf(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "CSRF_REJECTED" }));
  });
});
