const express = require("express");
const request = require("supertest");

const originalJwtSecret = process.env.JWT_SECRET;

const makeReq = (body) => ({
  body,
  ip: "203.0.113.10",
  get: jest.fn(() => "request-auth-002"),
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const responseBody = (res) => res.json.mock.calls[0][0];

beforeEach(() => {
  jest.spyOn(console, "info").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("AUTH-002 shared request validation", () => {
  test("canonicalizes email and strips surrounding name whitespace", () => {
    const { signupValidation } = require("../Middlewares/AuthValidation");
    const req = makeReq({
      fullName: "  Alice Example  ",
      email: "  Alice@Example.COM ",
      password: "password123",
    });
    const res = makeRes();
    const next = jest.fn();

    signupValidation(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.body).toEqual({
      fullName: "Alice Example",
      email: "alice@example.com",
      password: "password123",
    });
  });

  test("rejects unexpected authentication fields", () => {
    const { emailOnlyValidation } = require("../Middlewares/AuthValidation");
    const req = makeReq({ email: "alice@example.com", userId: "another-user" });
    const res = makeRes();

    emailOnlyValidation(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(responseBody(res).code).toBe("AUTH_VALIDATION_ERROR");
  });

  test.each([
    { email: "alice@example.com", password: "short", resetToken: "a".repeat(43) },
    { email: "alice@example.com", password: "password123", resetToken: "not-a-token" },
    { email: "alice@example.com", password: "password123" },
  ])("rejects an invalid reset request: %j", (body) => {
    const { resetPasswordValidation } = require("../Middlewares/AuthValidation");
    const req = makeReq(body);
    const res = makeRes();

    resetPasswordValidation(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("rejects passwords that exceed bcrypt's 72-byte boundary", () => {
    const { resetPasswordValidation } = require("../Middlewares/AuthValidation");
    const req = makeReq({
      email: "alice@example.com",
      password: "é".repeat(40),
      resetToken: "a".repeat(43),
    });
    const res = makeRes();

    resetPasswordValidation(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(responseBody(res).message).toContain("72 UTF-8 bytes");
  });
});

describe("AUTH-002 enumeration-resistant login and recovery", () => {
  const loadLogin = ({ user, passwordMatches }) => {
    const UserModel = { findOne: jest.fn(async () => user) };
    const comparePasswordOrDummy = jest.fn(async () => passwordMatches);
    jest.doMock("../config/Schemas", () => ({ UserModel }));
    jest.doMock("../Services/AuthServices/password.service", () => ({ comparePasswordOrDummy }));
    jest.doMock("../Services/AuthServices/token.service", () => ({ issueAccessToken: jest.fn(() => "token") }));
    return { login: require("../Controllers/AuthControllers/login").login, comparePasswordOrDummy };
  };

  test("returns the same response for an unknown account and a wrong password", async () => {
    const unknown = loadLogin({ user: null, passwordMatches: false });
    const unknownRes = makeRes();
    await unknown.login(makeReq({ email: "unknown@example.com", password: "password123" }), unknownRes);

    jest.resetModules();
    const wrong = loadLogin({
      user: { email: "known@example.com", password: "hash", isVerified: true },
      passwordMatches: false,
    });
    const wrongRes = makeRes();
    await wrong.login(makeReq({ email: "known@example.com", password: "password123" }), wrongRes);

    expect(unknownRes.status).toHaveBeenCalledWith(401);
    expect(wrongRes.status).toHaveBeenCalledWith(401);
    expect(responseBody(unknownRes)).toEqual(responseBody(wrongRes));
    expect(unknown.comparePasswordOrDummy).toHaveBeenCalledWith("password123", undefined);
  });

  const loadForgotPassword = ({ user, sendFails = false }) => {
    const UserModel = {
      findOne: jest.fn(async () => user),
      updateOne: jest.fn(async () => ({ acknowledged: true })),
    };
    const sendOTPEmail = sendFails
      ? jest.fn(async () => { throw new Error("mail unavailable"); })
      : jest.fn(async () => {});
    jest.doMock("../config/Schemas", () => ({ UserModel }));
    jest.doMock("../Services/AuthServices/email.service", () => ({ sendOTPEmail }));
    return {
      forgotPassword: require("../Controllers/AuthControllers/forgotPassword").forgotPassword,
      sendOTPEmail,
      UserModel,
    };
  };

  test("returns the same accepted response for unknown and unverified accounts", async () => {
    const unknown = loadForgotPassword({ user: null });
    const unknownRes = makeRes();
    await unknown.forgotPassword(makeReq({ email: "unknown@example.com" }), unknownRes);

    jest.resetModules();
    const unverified = loadForgotPassword({ user: { isVerified: false } });
    const unverifiedRes = makeRes();
    await unverified.forgotPassword(makeReq({ email: "known@example.com" }), unverifiedRes);

    expect(unknownRes.status).toHaveBeenCalledWith(202);
    expect(unverifiedRes.status).toHaveBeenCalledWith(202);
    expect(responseBody(unknownRes)).toEqual(responseBody(unverifiedRes));
    expect(unknown.sendOTPEmail).not.toHaveBeenCalled();
    expect(unverified.sendOTPEmail).not.toHaveBeenCalled();
  });

  test("issues a reset OTP without changing the generic response", async () => {
    const user = {
      _id: "user-1",
      isVerified: true,
      lastOtpSent: null,
      passwordResetExpiry: new Date(Date.now() + 60_000),
      save: jest.fn(async () => {}),
    };
    const loaded = loadForgotPassword({ user });
    const res = makeRes();

    await loaded.forgotPassword(makeReq({ email: "known@example.com" }), res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(user.isPasswordReset).toBe(true);
    expect(user.otp).toMatch(/^[a-f0-9]{64}$/);
    expect(user.passwordResetExpiry).toBeUndefined();
    expect(loaded.sendOTPEmail).toHaveBeenCalledWith("known@example.com", expect.stringMatching(/^\d{6}$/), "reset");
  });

  test("clears reset authorization when email delivery fails", async () => {
    const user = {
      _id: "user-1",
      isVerified: true,
      lastOtpSent: null,
      save: jest.fn(async () => {}),
    };
    const loaded = loadForgotPassword({ user, sendFails: true });
    const res = makeRes();

    await loaded.forgotPassword(makeReq({ email: "known@example.com" }), res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(loaded.UserModel.updateOne).toHaveBeenCalledWith(
      { _id: "user-1", otp: user.otp },
      expect.objectContaining({ $set: { isPasswordReset: false } })
    );
  });

  test("resend returns the same accepted response for unknown and verified accounts", async () => {
    const loadResend = (user) => {
      const UserModel = { findOne: jest.fn(async () => user), updateOne: jest.fn() };
      const sendOTPEmail = jest.fn();
      jest.doMock("../config/Schemas", () => ({ UserModel }));
      jest.doMock("../Services/AuthServices/email.service", () => ({ sendOTPEmail }));
      return {
        resendOTP: require("../Controllers/AuthControllers/resendOTP").resendOTP,
        sendOTPEmail,
      };
    };

    const unknown = loadResend(null);
    const unknownRes = makeRes();
    await unknown.resendOTP(makeReq({ email: "unknown@example.com" }), unknownRes);

    jest.resetModules();
    const verified = loadResend({ isVerified: true });
    const verifiedRes = makeRes();
    await verified.resendOTP(makeReq({ email: "known@example.com" }), verifiedRes);

    expect(unknownRes.status).toHaveBeenCalledWith(202);
    expect(verifiedRes.status).toHaveBeenCalledWith(202);
    expect(responseBody(unknownRes)).toEqual(responseBody(verifiedRes));
    expect(unknown.sendOTPEmail).not.toHaveBeenCalled();
    expect(verified.sendOTPEmail).not.toHaveBeenCalled();
  });
});

describe("AUTH-002 one-time OTP and reset authorization", () => {
  test("returns one reset token and stores only its hash", async () => {
    const { hashOTP } = require("../Services/AuthServices/otp.service");
    const otpHash = hashOTP("123456");
    const user = {
      _id: "user-1",
      email: "alice@example.com",
      otp: otpHash,
      otpExpiry: new Date(Date.now() + 60_000),
      isVerified: true,
      isPasswordReset: true,
    };
    const UserModel = {
      findOne: jest.fn(async () => user),
      findOneAndUpdate: jest.fn(async () => ({ _id: "user-1" })),
    };
    jest.doMock("../config/Schemas", () => ({ UserModel }));
    const { verifyOTP } = require("../Controllers/AuthControllers/verifyOTP");
    const res = makeRes();

    await verifyOTP(makeReq({ email: "alice@example.com", otp: "123456" }), res);

    const body = responseBody(res);
    const update = UserModel.findOneAndUpdate.mock.calls[0][1];
    expect(res.status).toHaveBeenCalledWith(200);
    expect(body.resetToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(update.$set.otp).toMatch(/^[a-f0-9]{64}$/);
    expect(update.$set.otp).not.toBe(body.resetToken);
    expect(update.$unset).toHaveProperty("otpExpiry");
  });

  test("returns the same failure for unknown, incorrect and expired OTP states", async () => {
    const cases = [
      null,
      { otp: "a".repeat(64), otpExpiry: new Date(Date.now() + 60_000), isVerified: true, isPasswordReset: true },
      { otp: "a".repeat(64), otpExpiry: new Date(Date.now() - 60_000), isVerified: true, isPasswordReset: true },
    ];
    const bodies = [];

    for (const user of cases) {
      jest.resetModules();
      const UserModel = { findOne: jest.fn(async () => user), findOneAndUpdate: jest.fn() };
      jest.doMock("../config/Schemas", () => ({ UserModel }));
      const { verifyOTP } = require("../Controllers/AuthControllers/verifyOTP");
      const res = makeRes();
      await verifyOTP(makeReq({ email: "alice@example.com", otp: "123456" }), res);
      expect(res.status).toHaveBeenCalledWith(400);
      bodies.push(responseBody(res));
    }

    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[2]).toEqual(bodies[0]);
  });

  test("atomically consumes a reset token so replay fails", async () => {
    const UserModel = {
      findOneAndUpdate: jest
        .fn()
        .mockResolvedValueOnce({ _id: "user-1" })
        .mockResolvedValueOnce(null),
    };
    const hashPassword = jest.fn(async () => "new-password-hash");
    jest.doMock("../config/Schemas", () => ({ UserModel }));
    jest.doMock("../Services/AuthServices/password.service", () => ({ hashPassword }));
    jest.doMock("../Services/AuthServices/session.service", () => ({ revokeAllSessions: jest.fn(async () => {}) }));
    const { resetPassword } = require("../Controllers/AuthControllers/resetPassword");
    const body = {
      email: "alice@example.com",
      password: "new-password-123",
      resetToken: "a".repeat(43),
    };
    const firstRes = makeRes();
    const replayRes = makeRes();

    await resetPassword(makeReq(body), firstRes);
    await resetPassword(makeReq(body), replayRes);

    expect(firstRes.status).toHaveBeenCalledWith(200);
    expect(replayRes.status).toHaveBeenCalledWith(403);
    expect(UserModel.findOneAndUpdate.mock.calls[0][0]).toEqual(expect.objectContaining({
      email: "alice@example.com",
      isPasswordReset: true,
      otp: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(UserModel.findOneAndUpdate.mock.calls[0][1].$unset).toHaveProperty("otp");
  });
});

describe("AUTH-002 rate limits and audit privacy", () => {
  test("limits verification attempts per normalized identity", async () => {
    jest.resetModules();
    const { otpVerifyLimiter } = require("../utils/rateLimiter");
    const app = express();
    app.use(express.json());
    app.post("/verify", otpVerifyLimiter, (req, res) => res.status(204).end());

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await request(app).post("/verify").send({ email: " Alice@Example.COM " });
      expect(response.status).toBe(204);
    }

    const blocked = await request(app).post("/verify").send({ email: "alice@example.com" });
    const otherIdentity = await request(app).post("/verify").send({ email: "other@example.com" });

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("AUTH_RATE_LIMITED");
    expect(otherIdentity.status).toBe(204);
  });

  test("emits correlatable audit events without raw email or IP", () => {
    process.env.JWT_SECRET = "audit-test-secret";
    const info = jest.spyOn(console, "info").mockImplementation(() => {});
    const { emitAuthAuditEvent } = require("../Services/AuthServices/security.service");

    emitAuthAuditEvent({
      event: "password_reset_requested",
      outcome: "accepted",
      email: "alice@example.com",
      req: makeReq({}),
    });

    const serialized = info.mock.calls[0][0];
    const event = JSON.parse(serialized);
    expect(serialized).not.toContain("alice@example.com");
    expect(serialized).not.toContain("203.0.113.10");
    expect(event.identityHash).toMatch(/^[a-f0-9]{24}$/);
    expect(event.ipHash).toMatch(/^[a-f0-9]{24}$/);
    expect(event.featureId).toBe("AUTH-002");
  });
});
