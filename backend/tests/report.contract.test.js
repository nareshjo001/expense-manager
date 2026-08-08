// M0-2: isolated characterization of the authenticated GET /report contract.
//
// Runs under the default backend/jest.config.js (npm test) -- never touches
// MongoDB, Redis, the ML service, or the network. This is a SEPARATE suite
// from tests/report.integration.itest.js (a real live-MongoDB/Redis suite,
// out of scope here) and does not duplicate tests/report.route.smoke.test.js
// (the existing no-Authorization-header 401 case, included unmodified in
// the regression run alongside this file).
//
// Two isolation boundaries are used, matching the two things this endpoint
// actually depends on:
//   - Sections B/C/D/F mock ../Services/reportService itself: this exercises
//     the real app, real rate limiter, real /report route, real verifyToken,
//     and real Controllers/report.controller.js, stubbing only the one seam
//     the controller calls through.
//   - Section E does NOT mock reportService -- it mocks reportService's own
//     three dependencies (../cache/reportCache, ../models/Report,
//     ../analytics/reportGenerator) so reportService's real cache/store/
//     generate branching logic executes for real, through authenticated
//     HTTP requests.
// Every `require("../app")` happens strictly after the relevant jest.doMock
// calls for that test, using jest.resetModules() first, mirroring the
// existing tests/sia.ask.test.js loadApp() pattern. No app import occurs at
// file scope. No top-level jest.mock() is used anywhere, so each test can
// freely choose which boundary to mock.
//
// config/redis.js's redisClient is constructed eagerly at require time --
// even auth-failure requests (which never reach the controller) would
// otherwise pull in the real Services/reportService -> cache/reportCache ->
// config/redis require chain and construct that singleton. Every test in
// this file mocks either reportService or its cache/model/generator
// dependencies before requiring app, so that chain is never reached for
// real in any test here.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const { assembleReport } = require("../analytics/reportAssembler");

const REPORT_SERVICE_PATH = "../Services/reportService";
const REPORT_CACHE_PATH = "../cache/reportCache";
const FINANCIAL_REPORT_MODEL_PATH = "../models/Report";
const REPORT_GENERATOR_PATH = "../analytics/reportGenerator";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "report-contract-test-secret";
let originalJwtSecret;

beforeAll(() => {
  originalJwtSecret = process.env.JWT_SECRET;
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
  jest.restoreAllMocks();
});

// Mirrors Controllers/AuthControllers/login.js's JWT payload shape
// ({ email, _id }), same convention tests/sia.ask.test.js and
// tests/fixtures/reportFixtures.js already use.
function signToken(userId, overrides = {}) {
  return jwt.sign(
    { email: "report-contract-test@example.test", _id: userId, ...overrides },
    TEST_JWT_SECRET
  );
}

// Loads a fresh Express app with ../Services/reportService mocked. Used for
// every test that only needs to prove route/middleware/controller behavior
// around a stubbed service call -- not reportService's own internal
// branching (that's section E's job, via loadAppWithMockedServiceDependencies).
function loadAppWithMockedService({ getReportImpl } = {}) {
  jest.resetModules();

  const getReportMock = jest.fn(getReportImpl || (async () => ({})));
  jest.doMock(REPORT_SERVICE_PATH, () => ({
    getReport: getReportMock,
    refreshReport: jest.fn(),
  }));

  const app = require(APP_PATH);
  return { app, getReportMock };
}

// Loads a fresh Express app with reportService's own three dependencies
// mocked (NOT reportService itself), so the real, unmocked
// Services/reportService.js executes its real cache/store/generate
// branching logic against these stubs.
function loadAppWithMockedServiceDependencies({
  cacheGetImpl,
  cacheSetImpl,
  findOneImpl,
  findOneAndUpdateImpl,
  generateReportImpl,
} = {}) {
  jest.resetModules();

  // jest.resetModules() clears the loaded module REGISTRY, but it does not
  // remove an explicit jest.doMock(REPORT_SERVICE_PATH, ...) registration
  // made by an earlier loadAppWithMockedService() call in a previous test --
  // that mock factory stays registered against this path for the rest of
  // the file. Without this call, requiring app below would still resolve
  // ../Services/reportService to whatever mock a prior test last
  // registered (proven by a real Windows Jest run: section E's responses
  // came back as the identity-propagation test's USER-B-MARKER report
  // instead of these branch tests' own probes). jest.dontMock explicitly
  // clears that registration so the require below loads the real,
  // unmocked Services/reportService.js and exercises its actual
  // cache/store/generate branching logic.
  jest.dontMock(REPORT_SERVICE_PATH);

  const cacheGetMock = jest.fn(cacheGetImpl || (async () => null));
  const cacheSetMock = jest.fn(cacheSetImpl || (async () => {}));
  const cacheInvalidateMock = jest.fn(async () => {});
  jest.doMock(REPORT_CACHE_PATH, () => ({
    get: cacheGetMock,
    set: cacheSetMock,
    invalidate: cacheInvalidateMock,
  }));

  const findOneMock = jest.fn(
    findOneImpl || (() => ({ lean: jest.fn().mockResolvedValue(null) }))
  );
  const findOneAndUpdateMock = jest.fn(
    findOneAndUpdateImpl || (() => ({ lean: jest.fn().mockResolvedValue(null) }))
  );
  jest.doMock(FINANCIAL_REPORT_MODEL_PATH, () => ({
    findOne: findOneMock,
    findOneAndUpdate: findOneAndUpdateMock,
  }));

  const generateReportMock = jest.fn(generateReportImpl || (async () => ({})));
  jest.doMock(REPORT_GENERATOR_PATH, () => ({
    generateReport: generateReportMock,
  }));

  const app = require(APP_PATH);
  return {
    app,
    cacheGetMock,
    cacheSetMock,
    cacheInvalidateMock,
    findOneMock,
    findOneAndUpdateMock,
    generateReportMock,
  };
}

// Deterministic, minimal inputs matching analytics/reportAssembler.js's
// actual current parameter names exactly, run through the REAL, unmocked
// assembleReport() -- not a hand-authored top-level report object. This is
// what section C configures the mocked reportService to resolve, so the
// contract assertions below are checked against a real assembler output.
function buildAssembledReport(overrides = {}) {
  return assembleReport({
    metadata: {
      version: 1,
      generatedAt: "2026-01-01T00:00:00.000Z",
      reportPeriod: { month: 1, year: 2026 },
    },
    summary: {
      totalSpent: 100,
      transactionCount: 1,
      dailyAverage: 10,
      comparePastMonth: 0,
      topCategory: "Test",
      budgetUtilization: 0,
      budgetStatus: "OnTrack",
      ...overrides.summary,
    },
    spending: { hasData: true },
    budgets: { hasBudget: false },
    trends: { hasData: false },
    monthlyCategories: { hasData: false },
    yearlyCategories: { hasData: false },
    monthlyHabits: { hasData: false },
    yearlyHabits: { hasData: false },
    financialHealth: {
      scores: {},
      overall: null,
      dataCompleteness: { includedModules: [], excludedModules: [] },
      risk: { label: "Unknown", color: "gray" },
      signals: [],
    },
  });
}

describe("GET /report -- additional authentication failures (B)", () => {
  it("returns 401 Token missing for a Bearer header with no usable token, and never calls reportService", async () => {
    const { app, getReportMock } = loadAppWithMockedService();

    // "Bearer" followed by two spaces then a non-empty trailing character:
    // startsWith("Bearer ") is true, but authHeader.split(" ")[1] is "" --
    // an empty string, not undefined -- because of the doubled separator.
    // A single trailing space alone is stripped by the HTTP layer before
    // Middlewares/Auth.js ever sees it (verified directly against this
    // repo's own Express version), so this is the only header shape that
    // reliably reaches verifyToken exercising this exact branch.
    const res = await request(app).get("/report").set("Authorization", "Bearer  x");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: "Token missing" });
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it("returns 401 Invalid or expired token for a garbage JWT, and never calls reportService", async () => {
    // Middlewares/Auth.js intentionally logs console.error("JWT verification
    // failed") on this exact path -- expected, real behavior, not a defect.
    // Scoped to this test only (not a global suppression) and restored
    // immediately afterward regardless of assertion outcome.
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      const { app, getReportMock } = loadAppWithMockedService();

      const res = await request(app)
        .get("/report")
        .set("Authorization", "Bearer not-a-real-jwt");

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ success: false, message: "Invalid or expired token" });
      expect(getReportMock).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith("JWT verification failed");
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns 401 Invalid token payload for a validly signed JWT missing _id, and never calls reportService", async () => {
    const { app, getReportMock } = loadAppWithMockedService();

    const tokenWithoutId = jwt.sign(
      { email: "report-contract-test@example.test" },
      TEST_JWT_SECRET
    );

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${tokenWithoutId}`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: "Invalid token payload" });
    expect(getReportMock).not.toHaveBeenCalled();
  });
});

describe("GET /report -- successful endpoint contract (C)", () => {
  it("returns 200 with the raw report object, no success wrapper, and every stable top-level key", async () => {
    const assembledReport = buildAssembledReport();
    const { app, getReportMock } = loadAppWithMockedService({
      getReportImpl: async () => assembledReport,
    });

    const userId = "report-contract-user-c";
    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);

    // Not {success, data} or any other wrapper -- the report is the body.
    expect(Object.prototype.hasOwnProperty.call(res.body, "success")).toBe(false);

    // Every currently stable top-level key from analytics/reportAssembler.js,
    // presence + type only -- never an exact financial value.
    expect(typeof res.body.metadata).toBe("object");
    expect(typeof res.body.summary).toBe("object");
    expect(typeof res.body.spending).toBe("object");
    expect(typeof res.body.budgets).toBe("object");
    expect(typeof res.body.categories).toBe("object");
    expect(typeof res.body.categories.monthly).toBe("object");
    expect(typeof res.body.categories.yearly).toBe("object");
    expect(typeof res.body.trends).toBe("object");
    expect(typeof res.body.habits).toBe("object");
    expect(typeof res.body.habits.monthly).toBe("object");
    expect(typeof res.body.habits.yearly).toBe("object");
    expect(typeof res.body.financialHealth).toBe("object");
    expect(typeof res.body.forecast).toBe("object");

    // Deliberately NOT asserted anywhere in this file: summary.healthScore,
    // summary.riskLevel. Both are read in analytics/reportGenerator.js from
    // healthReport.healthScore/.riskLevel, properties healthAnalyzer.js
    // never returns (it returns overall/risk) -- a known, separate,
    // unfixed defect. Asserting they are undefined would freeze that
    // defect as the intended contract; asserting any type would be false
    // today. This suite makes no claim about them in either direction.

    expect(getReportMock).toHaveBeenCalledTimes(1);
    expect(getReportMock).toHaveBeenCalledWith(userId);
  });
});

describe("GET /report -- authenticated identity propagation (D)", () => {
  it("routes each authenticated request to its own user's mocked report, never the other user's", async () => {
    const userAId = "report-contract-user-a";
    const userBId = "report-contract-user-b";

    // Real production field (summary.topCategory), given test-chosen values
    // purely as a routing probe -- not a claim that these specific strings
    // are part of the production contract.
    const reportA = buildAssembledReport({ summary: { topCategory: "USER-A-MARKER" } });
    const reportB = buildAssembledReport({ summary: { topCategory: "USER-B-MARKER" } });

    const { app, getReportMock } = loadAppWithMockedService({
      getReportImpl: async (userId) => (userId === userAId ? reportA : reportB),
    });

    const resA = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userAId)}`);
    const resB = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userBId)}`);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.body.summary.topCategory).toBe("USER-A-MARKER");
    expect(resB.body.summary.topCategory).toBe("USER-B-MARKER");

    expect(getReportMock.mock.calls).toEqual([[userAId], [userBId]]);
  });
});

describe("GET /report -- real reportService cache/store/generate branches (E)", () => {
  it("cache hit: returns the cached report, never queries Mongo or generates, keyed on the authenticated user ID", async () => {
    const userId = "report-contract-cache-hit-user";
    const cachedReport = { __probe: "CACHE_HIT_REPORT" };

    const { app, cacheGetMock, findOneMock, generateReportMock } =
      loadAppWithMockedServiceDependencies({
        cacheGetImpl: async () => cachedReport,
      });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cachedReport);
    expect(cacheGetMock).toHaveBeenCalledWith(userId);
    expect(findOneMock).not.toHaveBeenCalled();
    expect(generateReportMock).not.toHaveBeenCalled();
  });

  it("cache miss, stored report found: returns the stored report, never generates, and populates the cache with it", async () => {
    const userId = "report-contract-stored-user";
    const storedReport = { __probe: "STORED_REPORT" };
    const leanMock = jest.fn().mockResolvedValue(storedReport);

    const { app, cacheGetMock, findOneMock, cacheSetMock, generateReportMock } =
      loadAppWithMockedServiceDependencies({
        cacheGetImpl: async () => null,
        findOneImpl: () => ({ lean: leanMock }),
      });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(storedReport);
    expect(cacheGetMock).toHaveBeenCalledWith(userId);
    expect(findOneMock).toHaveBeenCalledWith({ user: userId });
    expect(leanMock).toHaveBeenCalledTimes(1);
    expect(generateReportMock).not.toHaveBeenCalled();
    expect(cacheSetMock).toHaveBeenCalledWith(userId, storedReport);
  });

  it("cache and stored-report miss: generates, persists with the real upsert chain/options, caches, and returns the persisted result", async () => {
    const userId = "report-contract-generated-user";
    const generatedReport = { __probe: "GENERATED_REPORT" };
    const persistedReport = { __probe: "PERSISTED_REPORT" };

    const findOneLeanMock = jest.fn().mockResolvedValue(null);
    const findOneAndUpdateLeanMock = jest.fn().mockResolvedValue(persistedReport);

    const {
      app,
      cacheGetMock,
      findOneMock,
      findOneAndUpdateMock,
      generateReportMock,
      cacheSetMock,
    } = loadAppWithMockedServiceDependencies({
      cacheGetImpl: async () => null,
      findOneImpl: () => ({ lean: findOneLeanMock }),
      generateReportImpl: async () => generatedReport,
      findOneAndUpdateImpl: () => ({ lean: findOneAndUpdateLeanMock }),
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(persistedReport);

    expect(cacheGetMock).toHaveBeenCalledWith(userId);
    expect(findOneMock).toHaveBeenCalledWith({ user: userId });
    expect(generateReportMock).toHaveBeenCalledWith(userId);

    // Exact reproduction of Services/reportService.js's real
    // findOneAndUpdate call shape: user-scoped filter, the generated report
    // spread alongside `user`, and the current production upsert options.
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { user: userId },
      { user: userId, ...generatedReport },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
    expect(findOneAndUpdateLeanMock).toHaveBeenCalledTimes(1);

    expect(cacheSetMock).toHaveBeenCalledWith(userId, persistedReport);
  });
});

describe("GET /report -- controller error contract (F)", () => {
  it("returns 500 with the exact error envelope when reportService.getReport rejects", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const { app, getReportMock } = loadAppWithMockedService({
      getReportImpl: async () => {
        throw new Error("simulated report service failure");
      },
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken("report-contract-error-user")}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      success: false,
      message: "Failed to fetch financial report.",
    });
    expect(getReportMock).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
  });
});
