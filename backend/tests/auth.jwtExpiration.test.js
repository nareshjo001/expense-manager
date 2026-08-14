// Remediation Workstream E -- JWT expiration.
//
// Root cause: Controllers/AuthControllers/login.js called
// `jwt.sign({ email, _id }, process.env.JWT_SECRET)` with no `expiresIn` --
// an issued token had no `exp` claim and never expired. Fixed by
// centralizing issuance through Services/AuthServices/token.service.js's
// issueAccessToken(), which applies a bounded, configurable (JWT_EXPIRES_IN)
// expiration to every token.
"use strict";

const jwt = require("jsonwebtoken");

const TOKEN_SERVICE_PATH = "../Services/AuthServices/token.service";
const LOGIN_PATH = "../Controllers/AuthControllers/login";
const SCHEMAS_PATH = "../config/Schemas";
const PASSWORD_SERVICE_PATH = "../Services/AuthServices/password.service";
const AUTH_MIDDLEWARE_PATH = "../Middlewares/Auth";

const TEST_JWT_SECRET = "jwt-expiration-test-secret";
let originalJwtSecret;
let originalJwtExpiresIn;

beforeAll(() => {
  originalJwtSecret = process.env.JWT_SECRET;
  originalJwtExpiresIn = process.env.JWT_EXPIRES_IN;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
  if (originalJwtExpiresIn === undefined) delete process.env.JWT_EXPIRES_IN;
  else process.env.JWT_EXPIRES_IN = originalJwtExpiresIn;
});

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  delete process.env.JWT_EXPIRES_IN;
});

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe("Remediation Workstream E: token.service.js", () => {
  it("1. issues a token containing both iat and exp", () => {
    jest.resetModules();
    process.env.JWT_EXPIRES_IN = "15m";
    const { issueAccessToken } = require(TOKEN_SERVICE_PATH);

    const token = issueAccessToken({ email: "a@b.com", _id: "user-1" });
    const decoded = jwt.decode(token);

    expect(decoded.iat).toBeDefined();
    expect(decoded.exp).toBeDefined();
    expect(decoded.exp).toBeGreaterThan(decoded.iat);
  });

  it("2. the configured expiration is applied consistently (15m -> exp - iat === 900s)", () => {
    jest.resetModules();
    process.env.JWT_EXPIRES_IN = "15m";
    const { issueAccessToken } = require(TOKEN_SERVICE_PATH);

    const token = issueAccessToken({ email: "a@b.com", _id: "user-1" });
    const decoded = jwt.decode(token);

    expect(decoded.exp - decoded.iat).toBe(15 * 60);
  });

  it("uses the documented bounded default when JWT_EXPIRES_IN is unset", () => {
    jest.resetModules();
    delete process.env.JWT_EXPIRES_IN;
    const { issueAccessToken, DEFAULT_EXPIRES_IN } = require(TOKEN_SERVICE_PATH);

    const token = issueAccessToken({ email: "a@b.com", _id: "user-1" });
    const decoded = jwt.decode(token);

    expect(decoded.exp).toBeDefined();
    expect(DEFAULT_EXPIRES_IN).toBe("15m");
  });

  it("7. a non-positive numeric JWT_EXPIRES_IN fails closed (throws, never issues a token)", () => {
    jest.resetModules();
    process.env.JWT_EXPIRES_IN = "0";
    const { issueAccessToken } = require(TOKEN_SERVICE_PATH);

    expect(() => issueAccessToken({ email: "a@b.com", _id: "user-1" })).toThrow();
  });

  it("7b. a negative numeric JWT_EXPIRES_IN fails closed", () => {
    jest.resetModules();
    process.env.JWT_EXPIRES_IN = "-5";
    const { issueAccessToken } = require(TOKEN_SERVICE_PATH);

    expect(() => issueAccessToken({ email: "a@b.com", _id: "user-1" })).toThrow();
  });

  it("7c. an unparseable string JWT_EXPIRES_IN fails closed via jsonwebtoken's own validation", () => {
    jest.resetModules();
    process.env.JWT_EXPIRES_IN = "not-a-duration";
    const { issueAccessToken } = require(TOKEN_SERVICE_PATH);

    expect(() => issueAccessToken({ email: "a@b.com", _id: "user-1" })).toThrow();
  });
});

describe("Remediation Workstream E: login.js issuance", () => {
  function loadLogin({ user, passwordMatches = true }) {
    jest.resetModules();
    jest.doMock(SCHEMAS_PATH, () => ({
      UserModel: { findOne: jest.fn(async () => user) },
    }));
    jest.doMock(PASSWORD_SERVICE_PATH, () => ({
      comparePassword: jest.fn(async () => passwordMatches),
    }));
    const { login } = require(LOGIN_PATH);
    return { login };
  }

  it("8. login response contract is otherwise unchanged (still returns token/email/firstname)", async () => {
    process.env.JWT_EXPIRES_IN = "15m";
    const { login } = loadLogin({
      user: { _id: "user-1", email: "a@b.com", fullName: "Alice", password: "hashed", isVerified: true },
    });

    const req = { body: { email: "a@b.com", password: "password123" } };
    const res = mockRes();
    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.token).toEqual(expect.any(String));
    expect(body.email).toBe("a@b.com");
    expect(body.firstname).toBe("Alice");

    const decoded = jwt.decode(body.token);
    expect(decoded.exp).toBeDefined();
    expect(decoded._id).toBe("user-1");
    expect(decoded.email).toBe("a@b.com");
  });

  it("11. no secret/config value appears in the login response or a thrown error's message", async () => {
    process.env.JWT_EXPIRES_IN = "0"; // forces token.service.js to throw
    const { login } = loadLogin({
      user: { _id: "user-1", email: "a@b.com", fullName: "Alice", password: "hashed", isVerified: true },
    });

    const req = { body: { email: "a@b.com", password: "password123" } };
    const res = mockRes();
    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = res.json.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toMatch(/JWT_SECRET|jwt-expiration-test-secret/);
  });
});

describe("Remediation Workstream E: Auth.js verification of an expired token", () => {
  function loadMiddleware() {
    jest.resetModules();
    return require(AUTH_MIDDLEWARE_PATH);
  }

  it("3. an expired token returns the same generic 401 contract as any other invalid token", () => {
    const verifyToken = loadMiddleware();
    const expiredToken = jwt.sign({ _id: "user-1" }, TEST_JWT_SECRET, { expiresIn: -10 });

    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    const res = mockRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Invalid or expired token",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("4. a malformed token returns the identical generic 401 contract", () => {
    const verifyToken = loadMiddleware();

    const req = { headers: { authorization: "Bearer not-a-real-jwt" } };
    const res = mockRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Invalid or expired token",
    });
  });

  it("5. a valid, unexpired token still authenticates and sets req.userId", () => {
    const verifyToken = loadMiddleware();
    const validToken = jwt.sign({ _id: "user-1" }, TEST_JWT_SECRET, { expiresIn: "15m" });

    const req = { headers: { authorization: `Bearer ${validToken}` } };
    const res = mockRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe("user-1");
    expect(res.status).not.toHaveBeenCalled();
  });

  it("6. user identity cannot be overridden by request data -- req.userId comes only from the verified token", () => {
    const verifyToken = loadMiddleware();
    const validToken = jwt.sign({ _id: "user-1" }, TEST_JWT_SECRET, { expiresIn: "15m" });

    const req = {
      headers: { authorization: `Bearer ${validToken}` },
      body: { userId: "attacker-controlled-id" },
    };
    const res = mockRes();
    const next = jest.fn();

    verifyToken(req, res, next);

    expect(req.userId).toBe("user-1");
  });
});
