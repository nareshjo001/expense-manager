// DAT-002-T02 -- canonical email and month representations.
//
// Investigation before writing this file found the picture is more nuanced
// than "email is never normalized": Middlewares/AuthValidation.js's Joi
// schemas (Services/AuthServices/validation.service.js) already
// `.trim().lowercase()` the email field and replace `req.body` with the
// validated value, and Routes/auth.routes.js wires every one of
// login/signup/verify-otp/resend-otp/forgot-password/reset-password behind
// that validation middleware -- so the real HTTP path was already
// normalized before reaching any of these controllers. The residual gaps
// this task closes are: (1) the schema/data-model itself had no canonical
// definition -- `userSchema.email` had no `lowercase`/`trim`, so any write
// path that does not go through that specific Joi middleware (a script, a
// future route, or -- as these tests exercise directly -- calling a
// controller function without Express in front of it) had no defense at
// all; (2) each controller now normalizes its own copy of `email` too, so
// it stays correct even if invoked directly. Budget.month has no such
// existing validation layer at all; DAT-002-T01's inventory found (and
// this file, plus a real Node check, verifies) the actual persisted
// convention is "MMM YYYY", not "YYYY-MM" as the pre-T01 feature doc had
// assumed.
"use strict";

const {
  MONTH_ABBREVIATIONS,
  MONTH_KEY_PATTERN,
  buildMonthKeyFromParts,
  getMonthKey: sharedGetMonthKey,
  parseMonthKey,
} = require("../utils/monthKeyNormalization");

describe("utils/monthKeyNormalization -- the single canonical definition", () => {
  test("buildMonthKeyFromParts builds the exact 'MMM YYYY' key for every month", () => {
    for (let m = 1; m <= 12; m += 1) {
      expect(buildMonthKeyFromParts(2026, m)).toBe(`${MONTH_ABBREVIATIONS[m - 1]} 2026`);
    }
  });

  test("buildMonthKeyFromParts returns null for an out-of-range month or a non-integer year", () => {
    expect(buildMonthKeyFromParts(2026, 0)).toBeNull();
    expect(buildMonthKeyFromParts(2026, 13)).toBeNull();
    expect(buildMonthKeyFromParts(2026.5, 1)).toBeNull();
    expect(buildMonthKeyFromParts(undefined, 1)).toBeNull();
  });

  test("getMonthKey(date) matches what Date.prototype.toLocaleString('default', {month:'short',year:'numeric'}) itself produces -- verified live, not assumed, since this is the exact behavior-preservation claim the refactor depends on", () => {
    const cases = [
      new Date(2025, 0, 1),
      new Date(2025, 5, 15),
      new Date(2025, 11, 31),
      new Date(2026, 1, 28),
      new Date(2026, 8, 21),
    ];
    for (const date of cases) {
      const viaLocale = date.toLocaleString("default", { month: "short", year: "numeric" });
      expect(sharedGetMonthKey(date)).toBe(viaLocale);
    }
  });

  test("parseMonthKey round-trips every buildMonthKeyFromParts output", () => {
    for (let m = 1; m <= 12; m += 1) {
      const key = buildMonthKeyFromParts(2026, m);
      expect(parseMonthKey(key)).toEqual({ year: 2026, monthIndex0Based: m - 1 });
    }
  });

  test.each([
    ["garbage", "no space/year shape"],
    ["Jan2026", "missing separating space"],
    ["Xyz 2026", "unrecognized month abbreviation"],
    ["January 2026", "full month name, not a 3-letter abbreviation"],
    ["", "empty string"],
    [null, "null"],
    [undefined, "undefined"],
    [12345, "non-string input"],
  ])("parseMonthKey returns null for %j (%s)", (input) => {
    expect(parseMonthKey(input)).toBeNull();
  });

  test("parseMonthKey is case-insensitive on the month letters but only resolves a real abbreviation -- same tolerance the pre-existing getMonthAnchorFromKey parser had", () => {
    expect(parseMonthKey("jan 2026")).toBeNull(); // lowercase "jan" is not in MONTH_ABBREVIATIONS
    expect(parseMonthKey("JAN 2026")).toBeNull();
    expect(parseMonthKey("Jan 2026")).toEqual({ year: 2026, monthIndex0Based: 0 });
  });

  test("MONTH_KEY_PATTERN is the exact regex parseMonthKey uses internally (no second, driftable definition)", () => {
    expect(MONTH_KEY_PATTERN.test("Jan 2026")).toBe(true);
    expect(MONTH_KEY_PATTERN.test("garbage")).toBe(false);
  });
});

describe("config/Schemas.js -- budgetSchema.month canonical validator", () => {
  const mongoose = require("mongoose");
  const { BudgetModel } = require("../config/Schemas");

  test("accepts every real 'MMM YYYY' key with no validation error", () => {
    for (let m = 1; m <= 12; m += 1) {
      const doc = new BudgetModel({
        userId: new mongoose.Types.ObjectId(),
        month: buildMonthKeyFromParts(2026, m),
        budget: 100,
        spent: 0,
      });
      expect(doc.validateSync()).toBeUndefined();
    }
  });

  test.each(["garbage", "2026-01", "Jan26", "Xyz 2026"])(
    "rejects a malformed month key: %j",
    (badMonth) => {
      const doc = new BudgetModel({
        userId: new mongoose.Types.ObjectId(),
        month: badMonth,
        budget: 100,
        spent: 0,
      });
      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.month).toBeDefined();
    }
  );
});

describe("config/Schemas.js -- userSchema.email canonical representation", () => {
  const { UserModel } = require("../config/Schemas");

  test("lowercases and trims email on document construction, before any save", () => {
    const user = new UserModel({
      fullName: "Test User",
      email: "  Foo@Example.COM  ",
      password: "hashed",
    });
    expect(user.email).toBe("foo@example.com");
  });

  test("already-canonical email is left unchanged", () => {
    const user = new UserModel({
      fullName: "Test User",
      email: "already@canonical.com",
      password: "hashed",
    });
    expect(user.email).toBe("already@canonical.com");
  });
});

describe("Services/BudgetServices/budget.service.js -- getMonthKey/getMonthAnchorFromKey delegate to the shared util, same contract as before", () => {
  const { getMonthKey, getMonthAnchorFromKey } = require("../Services/BudgetServices/budget.service");

  test("getMonthKey(date) matches buildMonthKeyFromParts for the same year/month", () => {
    const date = new Date(2026, 3, 15); // April 2026
    expect(getMonthKey(date)).toBe(buildMonthKeyFromParts(2026, 4));
    expect(getMonthKey(date)).toBe("Apr 2026");
  });

  test("getMonthAnchorFromKey('Jan 2026') returns the first instant of that month", () => {
    const anchor = getMonthAnchorFromKey("Jan 2026");
    expect(anchor).toEqual(new Date(2026, 0, 1));
  });

  test("getMonthAnchorFromKey returns null for a malformed key -- same as before this refactor", () => {
    expect(getMonthAnchorFromKey("not-a-month-key")).toBeNull();
    expect(getMonthAnchorFromKey(null)).toBeNull();
  });
});

describe("sia/financialQueryService.js -- monthKeyFromZonedYearMonth delegates to the shared util", () => {
  const { monthKeyFromZonedYearMonth } = require("../sia/financialQueryService");

  test("produces the exact same 'MMM YYYY' key the shared builder does", () => {
    expect(monthKeyFromZonedYearMonth(2026, 9)).toBe(buildMonthKeyFromParts(2026, 9));
    expect(monthKeyFromZonedYearMonth(2026, 9)).toBe("Sep 2026");
  });
});

describe("AuthControllers -- normalize email before querying/writing UserModel, even called directly (bypassing the Joi validation middleware Routes/auth.routes.js normally puts in front of every one of these)", () => {
  const SCHEMAS_PATH = "../config/Schemas";
  const MIXED_CASE_EMAIL = "  MixedCase@Example.COM  ";
  const CANONICAL_EMAIL = "mixedcase@example.com";

  const makeRes = () => {
    const res = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
  };

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, "info").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("login: UserModel.findOne is called with the normalized email", async () => {
    const findOneMock = jest.fn(async () => null);
    jest.doMock(SCHEMAS_PATH, () => ({ UserModel: { findOne: findOneMock } }));
    jest.doMock("../Services/AuthServices/password.service", () => ({
      comparePasswordOrDummy: jest.fn(async () => false),
    }));
    const { login } = require("../Controllers/AuthControllers/login");

    const req = { body: { email: MIXED_CASE_EMAIL, password: "x" }, ip: "203.0.113.1", get: jest.fn() };
    const res = makeRes();
    await login(req, res);

    expect(findOneMock).toHaveBeenCalledWith({ email: CANONICAL_EMAIL });
  });

  test("signup: both the existence-check query and the new document use the normalized email", async () => {
    const findOneMock = jest.fn(async () => null);
    const savedDocs = [];
    function FakeUserModel(fields) {
      Object.assign(this, fields);
      this.save = jest.fn(async () => savedDocs.push(this));
    }
    FakeUserModel.findOne = findOneMock;
    jest.doMock(SCHEMAS_PATH, () => ({ UserModel: FakeUserModel }));
    jest.doMock("../Services/AuthServices/email.service", () => ({ sendOTPEmail: jest.fn(async () => {}) }));
    jest.doMock("../Services/AuthServices/password.service", () => ({ hashPassword: jest.fn(async () => "hashed") }));
    const { signup } = require("../Controllers/AuthControllers/signup");

    const req = { body: { fullName: "Test", email: MIXED_CASE_EMAIL, password: "x" }, ip: "203.0.113.1", get: jest.fn() };
    const res = makeRes();
    await signup(req, res);

    expect(findOneMock).toHaveBeenCalledWith({ email: CANONICAL_EMAIL });
    expect(savedDocs).toHaveLength(1);
    expect(savedDocs[0].email).toBe(CANONICAL_EMAIL);
  });

  test("forgotPassword: UserModel.findOne is called with the normalized email", async () => {
    const findOneMock = jest.fn(async () => null);
    jest.doMock(SCHEMAS_PATH, () => ({ UserModel: { findOne: findOneMock } }));
    const { forgotPassword } = require("../Controllers/AuthControllers/forgotPassword");

    const req = { body: { email: MIXED_CASE_EMAIL }, ip: "203.0.113.1", get: jest.fn() };
    const res = makeRes();
    await forgotPassword(req, res);

    expect(findOneMock).toHaveBeenCalledWith({ email: CANONICAL_EMAIL });
  });

  test("resendOTP: UserModel.findOne is called with the normalized email", async () => {
    const findOneMock = jest.fn(async () => null);
    jest.doMock(SCHEMAS_PATH, () => ({ UserModel: { findOne: findOneMock } }));
    const { resendOTP } = require("../Controllers/AuthControllers/resendOTP");

    const req = { body: { email: MIXED_CASE_EMAIL }, ip: "203.0.113.1", get: jest.fn() };
    const res = makeRes();
    await resendOTP(req, res);

    expect(findOneMock).toHaveBeenCalledWith({ email: CANONICAL_EMAIL });
  });

  test("verifyOTP: UserModel.findOne is called with the normalized email", async () => {
    const findOneMock = jest.fn(async () => null);
    jest.doMock(SCHEMAS_PATH, () => ({ UserModel: { findOne: findOneMock } }));
    const { verifyOTP } = require("../Controllers/AuthControllers/verifyOTP");

    const req = { body: { email: MIXED_CASE_EMAIL, otp: "123456" }, ip: "203.0.113.1", get: jest.fn() };
    const res = makeRes();
    await verifyOTP(req, res);

    expect(findOneMock).toHaveBeenCalledWith({ email: CANONICAL_EMAIL });
  });

  test("resetPassword: UserModel.findOneAndUpdate is called with the normalized email in its filter", async () => {
    const findOneAndUpdateMock = jest.fn(async () => null);
    jest.doMock(SCHEMAS_PATH, () => ({ UserModel: { findOneAndUpdate: findOneAndUpdateMock } }));
    jest.doMock("../Services/AuthServices/password.service", () => ({ hashPassword: jest.fn(async () => "hashed") }));
    const { resetPassword } = require("../Controllers/AuthControllers/resetPassword");

    const req = {
      body: { email: MIXED_CASE_EMAIL, password: "newpassword", resetToken: "a".repeat(43) },
      ip: "203.0.113.1",
      get: jest.fn(),
    };
    const res = makeRes();
    await resetPassword(req, res);

    const filterArg = findOneAndUpdateMock.mock.calls[0][0];
    expect(filterArg.email).toBe(CANONICAL_EMAIL);
  });
});
