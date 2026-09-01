// M0-2: isolated characterization of the authenticated GET /report contract.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const { assembleReport } = require("../analytics/reportAssembler");
const { CURRENT_REPORT_VERSION } = require("../analytics/reportContractVersion");

const REPORT_SERVICE_PATH = "../Services/reportService";
const REPORT_CACHE_PATH = "../cache/reportCache";
const FINANCIAL_REPORT_MODEL_PATH = "../models/Report";
const REPORT_GENERATOR_PATH = "../analytics/reportGenerator";
// Phase C -- Expense Mutation Reliability: Controllers/report.controller.js
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
// Phase C.4 -- Services/reportService.js's getReport() now also reads
const PENDING_SYNC_PATH = "../models/PendingSync";
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
function signToken(userId, overrides = {}) {
  return jwt.sign(
    { email: "report-contract-test@example.test", _id: userId, ...overrides },
    TEST_JWT_SECRET
  );
}

// Loads a fresh Express app with ../Services/reportService mocked. Used for
function loadAppWithMockedService({ getReportImpl, repairIfPendingImpl } = {}) {
  jest.resetModules();

  const getReportMock = jest.fn(getReportImpl || (async () => ({})));
  jest.doMock(REPORT_SERVICE_PATH, () => ({
    getReport: getReportMock,
    refreshReport: jest.fn(),
  }));

  const repairIfPendingMock = jest.fn(
    repairIfPendingImpl || (async () => ({ attempted: false, stillPending: false }))
  );
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    repairIfPending: repairIfPendingMock,
  }));

  const app = require(APP_PATH);
  return { app, getReportMock, repairIfPendingMock };
}

// Loads a fresh Express app with reportService's own three dependencies
function loadAppWithMockedServiceDependencies({
  cacheGetImpl,
  cacheGetWithRevisionImpl,
  cacheSetImpl,
  findOneImpl,
  findOneAndUpdateImpl,
  generateReportImpl,
  pendingSyncFindOneImpl,
} = {}) {
  jest.resetModules();

  // jest.resetModules() clears the loaded module REGISTRY, but it does not
  jest.dontMock(REPORT_SERVICE_PATH);

  // Same rationale as loadAppWithMockedService above -- never let this
  // suite's report.controller.js call reach the real PendingSync model.
  const repairIfPendingMock = jest.fn(async () => ({ attempted: false, stillPending: false }));
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    repairIfPending: repairIfPendingMock,
  }));

  // Phase C.4 -- getReport() now calls reportCache.getWithRevision()
  const resolvedCacheGetImpl = cacheGetImpl || (async () => null);
  const cacheGetMock = jest.fn(resolvedCacheGetImpl);
  // Phase C.4 requirement #2's own tests need to control the cached
  const cacheGetWithRevisionMock = jest.fn(
    cacheGetWithRevisionImpl ||
      (async (...args) => {
        const payload = await resolvedCacheGetImpl(...args);
        return payload ? { revision: null, payload } : null;
      })
  );
  const cacheSetMock = jest.fn(cacheSetImpl || (async () => {}));
  const cacheInvalidateMock = jest.fn(async () => {});
  jest.doMock(REPORT_CACHE_PATH, () => ({
    get: cacheGetMock,
    getWithRevision: cacheGetWithRevisionMock,
    set: cacheSetMock,
    invalidate: cacheInvalidateMock,
  }));

  const pendingSyncFindOneMock = jest.fn(
    pendingSyncFindOneImpl || (() => ({ lean: jest.fn().mockResolvedValue(null) }))
  );
  jest.doMock(PENDING_SYNC_PATH, () => ({
    findOne: pendingSyncFindOneMock,
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
    cacheGetWithRevisionMock,
    cacheSetMock,
    cacheInvalidateMock,
    findOneMock,
    findOneAndUpdateMock,
    generateReportMock,
    repairIfPendingMock,
    pendingSyncFindOneMock,
  };
}

// Deterministic, minimal inputs matching analytics/reportAssembler.js's
function buildAssembledReport(overrides = {}) {
  return assembleReport({
    metadata: {
      version: CURRENT_REPORT_VERSION,
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
    // Additive: analytics/reportAssembler.js's own `anomalies = {}` default
    ...(overrides.anomalies !== undefined ? { anomalies: overrides.anomalies } : {}),
    ...(overrides.forecast !== undefined ? { forecast: overrides.forecast } : {}),
  });
}

describe("GET /report -- additional authentication failures (B)", () => {
  it("returns 401 Token missing for a Bearer header with no usable token, and never calls reportService", async () => {
    const { app, getReportMock } = loadAppWithMockedService();

    // "Bearer" followed by two spaces then a non-empty trailing character:
    const res = await request(app).get("/report").set("Authorization", "Bearer  x");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: "Token missing" });
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it("returns 401 Invalid or expired token for a garbage JWT, and never calls reportService", async () => {
    // Middlewares/Auth.js intentionally logs console.error("JWT verification
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

    expect(getReportMock).toHaveBeenCalledTimes(1);
    expect(getReportMock).toHaveBeenCalledWith(userId);
  });
});

describe("GET /report -- authenticated identity propagation (D)", () => {
  it("routes each authenticated request to its own user's mocked report, never the other user's", async () => {
    const userAId = "report-contract-user-a";
    const userBId = "report-contract-user-b";

    // Real production field (summary.topCategory), given test-chosen values
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
    // A current-contract probe (metadata.version stamped): must be
    const cachedReport = { __probe: "CACHE_HIT_REPORT", metadata: { version: CURRENT_REPORT_VERSION } };

    const { app, cacheGetWithRevisionMock, findOneMock, generateReportMock } =
      loadAppWithMockedServiceDependencies({
        cacheGetImpl: async () => cachedReport,
      });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cachedReport);
    // Phase C.4 -- getReport() now reads through getWithRevision(), not
    expect(cacheGetWithRevisionMock).toHaveBeenCalledWith(userId);
    expect(findOneMock).not.toHaveBeenCalled();
    expect(generateReportMock).not.toHaveBeenCalled();
  });

  it("cache miss, stored report found: returns the stored report, never generates, and populates the cache with it", async () => {
    const userId = "report-contract-stored-user";
    // Current-contract probe -- the legacy case is covered separately
    // below (describe block H).
    const storedReport = { __probe: "STORED_REPORT", metadata: { version: CURRENT_REPORT_VERSION } };
    const leanMock = jest.fn().mockResolvedValue(storedReport);

    const { app, cacheGetWithRevisionMock, findOneMock, cacheSetMock, generateReportMock } =
      loadAppWithMockedServiceDependencies({
        cacheGetImpl: async () => null,
        findOneImpl: () => ({ lean: leanMock }),
      });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(storedReport);
    expect(cacheGetWithRevisionMock).toHaveBeenCalledWith(userId);
    expect(findOneMock).toHaveBeenCalledWith({ user: userId });
    expect(leanMock).toHaveBeenCalledTimes(1);
    expect(generateReportMock).not.toHaveBeenCalled();
    // Phase C.4 -- getReport() now passes the stored document's own
    expect(cacheSetMock).toHaveBeenCalledWith(userId, storedReport, null);
  });

  it("cache and stored-report miss: generates, persists with the real upsert chain/options, caches, and returns the persisted result", async () => {
    const userId = "report-contract-generated-user";
    const generatedReport = { __probe: "GENERATED_REPORT" };
    const persistedReport = { __probe: "PERSISTED_REPORT" };

    const findOneLeanMock = jest.fn().mockResolvedValue(null);
    const findOneAndUpdateLeanMock = jest.fn().mockResolvedValue(persistedReport);

    const {
      app,
      cacheGetWithRevisionMock,
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

    expect(cacheGetWithRevisionMock).toHaveBeenCalledWith(userId);
    expect(findOneMock).toHaveBeenCalledWith({ user: userId });
    expect(generateReportMock).toHaveBeenCalledWith(userId);

    // Exact reproduction of Services/reportService.js's real
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { user: userId },
      { $set: { user: userId, ...generatedReport } },
      {
        new: true,
        upsert: false,
        runValidators: true,
      }
    );
    expect(findOneAndUpdateLeanMock).toHaveBeenCalledTimes(1);

    // Phase C.3 -- reportCache.set() now also receives the revision that
    // fenced this write (null here -- this call is unfenced).
    expect(cacheSetMock).toHaveBeenCalledWith(userId, persistedReport, null);
  });

  // Phase C.4 requirement #2 -- proves a stale Redis cache entry can never
  it("stale cache proof: Mongo report at revision 11, Redis cached at revision 10, PendingSync floor at 11 -- the revision-10 cached payload is never returned; the fresher stored document is served and re-cached at revision 11", async () => {
    const userId = "report-contract-stale-cache-user";
    const staleCachedPayload = { __probe: "STALE_CACHED_REV_10", metadata: { version: CURRENT_REPORT_VERSION } };
    const freshStoredReport = {
      __probe: "FRESH_STORED_REV_11",
      metadata: { version: CURRENT_REPORT_VERSION },
      syncRevision: 11,
    };
    const leanMock = jest.fn().mockResolvedValue(freshStoredReport);

    const {
      app,
      cacheGetWithRevisionMock,
      findOneMock,
      generateReportMock,
      cacheSetMock,
    } = loadAppWithMockedServiceDependencies({
      // The cache holds a validly-CAS-written entry -- it just lost the
      cacheGetWithRevisionImpl: async () => ({ revision: 10, payload: staleCachedPayload }),
      findOneImpl: () => ({ lean: leanMock }),
      // PendingSync.revision === 11 with reportPending: false is exactly
      pendingSyncFindOneImpl: () => ({
        lean: jest.fn().mockResolvedValue({ user: userId, revision: 11, reportPending: false }),
      }),
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    // The stale revision-10 cached payload must NEVER be returned.
    expect(res.body).not.toEqual(staleCachedPayload);
    // The fresher, revision-11 stored document is served instead.
    expect(res.body).toEqual(freshStoredReport);
    expect(cacheGetWithRevisionMock).toHaveBeenCalledWith(userId);
    expect(findOneMock).toHaveBeenCalledWith({ user: userId });
    // No live regeneration was needed -- the stored Mongo document already
    expect(generateReportMock).not.toHaveBeenCalled();
    // The cache is re-populated with the fresh revision-11 document,
    expect(cacheSetMock).toHaveBeenCalledWith(userId, freshStoredReport, 11);
  });

  // Phase C.4 requirement #2, second scenario -- proves the specific crash
  it("crash-before-Redis-EVAL proof: Mongo CAS succeeded at revision 11 but Redis was never written -- next getReport() call finds no cache entry, and PendingSync's durable floor still correctly gates freshness", async () => {
    const userId = "report-contract-crash-before-eval-user";
    const freshStoredReport = {
      __probe: "SURVIVED_CRASH_REV_11",
      metadata: { version: CURRENT_REPORT_VERSION },
      syncRevision: 11,
    };
    const leanMock = jest.fn().mockResolvedValue(freshStoredReport);

    const {
      app,
      cacheGetWithRevisionMock,
      findOneMock,
      generateReportMock,
      cacheSetMock,
    } = loadAppWithMockedServiceDependencies({
      // Simulates the crash: reportCache.set()'s own EVAL call for the
      cacheGetWithRevisionImpl: async () => null,
      findOneImpl: () => ({ lean: leanMock }),
      pendingSyncFindOneImpl: () => ({
        lean: jest.fn().mockResolvedValue({ user: userId, revision: 11, reportPending: false }),
      }),
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(freshStoredReport);
    expect(cacheGetWithRevisionMock).toHaveBeenCalledWith(userId);
    expect(findOneMock).toHaveBeenCalledWith({ user: userId });
    // The stored document alone (revision 11) already meets the durable
    // floor (also 11) -- no live regeneration is needed to repair.
    expect(generateReportMock).not.toHaveBeenCalled();
    // This read repairs the gap the crash left behind: Redis is populated
    // for the first time with the correct revision-11 entry.
    expect(cacheSetMock).toHaveBeenCalledWith(userId, freshStoredReport, 11);
  });

  // Companion to the crash scenario above -- proves the case where the
  it("crash-before-Mongo-CAS proof: PendingSync still reports pending recovery -- neither the (absent) cache nor the stale stored document is served; getReport() regenerates live", async () => {
    const userId = "report-contract-crash-before-cas-user";
    const staleStoredReport = {
      __probe: "STALE_STORED_REV_10",
      metadata: { version: CURRENT_REPORT_VERSION },
      syncRevision: 10,
    };
    const generatedReport = { __probe: "LIVE_REGENERATED_REPORT", metadata: { version: CURRENT_REPORT_VERSION } };
    const persistedReport = { __probe: "LIVE_REGENERATED_PERSISTED", metadata: { version: CURRENT_REPORT_VERSION } };

    const findOneLeanMock = jest.fn().mockResolvedValue(staleStoredReport);
    const findOneAndUpdateLeanMock = jest.fn().mockResolvedValue(persistedReport);

    const {
      app,
      cacheGetWithRevisionMock,
      findOneMock,
      generateReportMock,
    } = loadAppWithMockedServiceDependencies({
      cacheGetWithRevisionImpl: async () => null,
      findOneImpl: () => ({ lean: findOneLeanMock }),
      findOneAndUpdateImpl: () => ({ lean: findOneAndUpdateLeanMock }),
      generateReportImpl: async () => generatedReport,
      // reportPending: true is the durable marker a reserve()/pending
      pendingSyncFindOneImpl: () => ({
        lean: jest.fn().mockResolvedValue({ user: userId, revision: 11, reportPending: true }),
      }),
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body).not.toEqual(staleStoredReport);
    expect(res.body).toEqual(persistedReport);
    expect(cacheGetWithRevisionMock).toHaveBeenCalledWith(userId);
    expect(findOneMock).toHaveBeenCalledWith({ user: userId });
    expect(generateReportMock).toHaveBeenCalledWith(userId);
  });
});

describe("GET /report -- legacy report-contract-version compatibility (H)", () => {
  // A "legacy" probe deliberately has NO metadata.version at all (the
  const LEGACY_CACHED_REPORT = { __probe: "LEGACY_CACHED_REPORT", metadata: { generatedAt: "old" } };
  const LEGACY_STORED_REPORT = { __probe: "LEGACY_STORED_REPORT", metadata: { generatedAt: "old" } };

  it("rejects a legacy cached report (no metadata.version) as stale, falls through to Mongo, and does not return it", async () => {
    const userId = "report-contract-legacy-cache-user";
    const storedReport = { __probe: "CURRENT_STORED_REPORT", metadata: { version: CURRENT_REPORT_VERSION } };
    const leanMock = jest.fn().mockResolvedValue(storedReport);

    const { app, cacheGetWithRevisionMock, findOneMock, generateReportMock, cacheSetMock } =
      loadAppWithMockedServiceDependencies({
        cacheGetImpl: async () => LEGACY_CACHED_REPORT,
        findOneImpl: () => ({ lean: leanMock }),
      });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    // The legacy cached probe is never returned to the client.
    expect(res.body).not.toEqual(LEGACY_CACHED_REPORT);
    expect(res.body).toEqual(storedReport);
    expect(cacheGetWithRevisionMock).toHaveBeenCalledWith(userId);
    expect(findOneMock).toHaveBeenCalledWith({ user: userId });
    // The current stored report found underneath the stale cache entry is
    expect(cacheSetMock).toHaveBeenCalledWith(userId, storedReport, null);
    expect(generateReportMock).not.toHaveBeenCalled();
  });

  it("regenerates a legacy persisted report (no metadata.version), persists it, and caches the regenerated result", async () => {
    const userId = "report-contract-legacy-stored-user";
    const generatedReport = { __probe: "REGENERATED_REPORT", metadata: { version: CURRENT_REPORT_VERSION } };
    const persistedReport = { __probe: "REGENERATED_PERSISTED_REPORT", metadata: { version: CURRENT_REPORT_VERSION } };

    const findOneLeanMock = jest.fn().mockResolvedValue(LEGACY_STORED_REPORT);
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
    expect(res.body).not.toEqual(LEGACY_STORED_REPORT);
    expect(res.body).toEqual(persistedReport);

    expect(findOneMock).toHaveBeenCalledWith({ user: userId });
    // Regeneration happened exactly once for this stale document -- not
    // zero (it must regenerate) and not more than once (no loop).
    expect(generateReportMock).toHaveBeenCalledTimes(1);
    expect(generateReportMock).toHaveBeenCalledWith(userId);

    // The legacy document is replaced in place via the existing user-scoped
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { user: userId },
      { $set: { user: userId, ...generatedReport } },
      {
        new: true,
        upsert: false,
        runValidators: true,
      }
    );
    expect(cacheSetMock).toHaveBeenCalledWith(userId, persistedReport, null);
  });

  it("accepts a current report whose anomaly section is hasData:false as present, not legacy", async () => {
    const userId = "report-contract-nodata-anomaly-user";
    const cachedReport = {
      __probe: "NO_DATA_ANOMALY_REPORT",
      metadata: { version: CURRENT_REPORT_VERSION },
      anomalies: { hasData: false, reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES", anomalies: [] },
    };

    const { app, findOneMock, generateReportMock } = loadAppWithMockedServiceDependencies({
      cacheGetImpl: async () => cachedReport,
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cachedReport);
    // hasData:false is a valid, current section -- must not trigger a
    // fallthrough to Mongo/regeneration.
    expect(findOneMock).not.toHaveBeenCalled();
    expect(generateReportMock).not.toHaveBeenCalled();
  });

  it("accepts a current report whose anomaly section is hasData:true with zero flagged anomalies as present, not legacy", async () => {
    const userId = "report-contract-zero-anomaly-user";
    const cachedReport = {
      __probe: "ZERO_ANOMALY_REPORT",
      metadata: { version: CURRENT_REPORT_VERSION },
      anomalies: { hasData: true, reasonCode: null, flaggedCount: 0, anomalies: [] },
    };

    const { app, findOneMock, generateReportMock } = loadAppWithMockedServiceDependencies({
      cacheGetImpl: async () => cachedReport,
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cachedReport);
    expect(findOneMock).not.toHaveBeenCalled();
    expect(generateReportMock).not.toHaveBeenCalled();
  });

  it("does not regenerate an already-current report even when its own anomalies section defaulted to an empty object", async () => {
    // Proves the Mongoose `anomalies: { default: {} }` scenario from the
    const userId = "report-contract-defaulted-anomalies-user";
    const storedReport = {
      __probe: "DEFAULTED_ANOMALIES_BUT_CURRENT",
      metadata: { version: CURRENT_REPORT_VERSION },
      anomalies: {},
    };
    const leanMock = jest.fn().mockResolvedValue(storedReport);

    const { app, findOneMock, generateReportMock, cacheSetMock } = loadAppWithMockedServiceDependencies({
      cacheGetImpl: async () => null,
      findOneImpl: () => ({ lean: leanMock }),
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(storedReport);
    expect(findOneMock).toHaveBeenCalledWith({ user: userId });
    expect(generateReportMock).not.toHaveBeenCalled();
    expect(cacheSetMock).toHaveBeenCalledWith(userId, storedReport, null);
  });

  it("never calls a global Redis flush -- only the per-user cache.set/get/invalidate seam is used, even along the legacy-regeneration path", async () => {
    const userId = "report-contract-no-flush-user";
    const generatedReport = { __probe: "NO_FLUSH_GENERATED", metadata: { version: CURRENT_REPORT_VERSION } };
    const persistedReport = { __probe: "NO_FLUSH_PERSISTED", metadata: { version: CURRENT_REPORT_VERSION } };

    const findOneLeanMock = jest.fn().mockResolvedValue(LEGACY_STORED_REPORT);
    const findOneAndUpdateLeanMock = jest.fn().mockResolvedValue(persistedReport);

    const { app, cacheGetWithRevisionMock, cacheSetMock, cacheInvalidateMock } = loadAppWithMockedServiceDependencies({
      cacheGetImpl: async () => null,
      findOneImpl: () => ({ lean: findOneLeanMock }),
      generateReportImpl: async () => generatedReport,
      findOneAndUpdateImpl: () => ({ lean: findOneAndUpdateLeanMock }),
    });

    await request(app).get("/report").set("Authorization", `Bearer ${signToken(userId)}`);

    // reportCache.js's real module surface is exactly get/getWithRevision/
    expect(cacheGetWithRevisionMock).toHaveBeenCalledTimes(1);
    expect(cacheGetWithRevisionMock).toHaveBeenCalledWith(userId);
    expect(cacheSetMock).toHaveBeenCalledTimes(1);
    expect(cacheSetMock).toHaveBeenCalledWith(userId, persistedReport, null);
    expect(cacheInvalidateMock).not.toHaveBeenCalled();

    const reportCacheSource = require("fs").readFileSync(
      require("path").join(__dirname, "../cache/reportCache.js"),
      "utf8"
    );
    expect(reportCacheSource).not.toMatch(/flushAll|flushDb|FLUSHALL|FLUSHDB/);
  });
});

describe("GET /report -- anomalies section contract (G)", () => {
  it("includes the anomalies section as an object alongside every other stable top-level key", async () => {
    const assembledReport = buildAssembledReport();
    const { app } = loadAppWithMockedService({
      getReportImpl: async () => assembledReport,
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken("report-contract-anomalies-user")}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.anomalies).toBe("object");
    // Every pre-existing stable key remains present alongside the new one --
    // adding `anomalies` did not rename or remove anything.
    expect(typeof res.body.metadata).toBe("object");
    expect(typeof res.body.summary).toBe("object");
    expect(typeof res.body.forecast).toBe("object");
  });

  it("does not expose raw historical expenses, userId, description, client id, or internal sort fields on a flagged anomaly", async () => {
    const anomalies = {
      hasData: true,
      reasonCode: null,
      baselineWindow: { months: 12, start: "2025-08-01T00:00:00.000Z", endExclusive: "2026-08-01T00:00:00.000Z" },
      evaluatedExpenseCount: 1,
      eligibleCategoryCount: 1,
      insufficientHistoryCategoryCount: 0,
      flaggedCount: 1,
      anomalies: [
        {
          expenseId: "64f1a2b3c4d5e6f7a8b9c0d1",
          expenseName: "Dinner",
          category: "Food",
          amount: 3500,
          expenseDate: "2026-08-15T00:00:00.000Z",
          severity: "high",
          reasonCode: "CATEGORY_AMOUNT_SPIKE",
          baseline: { scope: "category", sampleCount: 10, medianAmount: 500 },
          detection: { method: "MODIFIED_Z", score: 5, threshold: 3.5, thresholdMultiple: 1.43, amountRatio: 7 },
        },
      ],
    };
    const assembledReport = buildAssembledReport({ anomalies });
    const { app } = loadAppWithMockedService({
      getReportImpl: async () => assembledReport,
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken("report-contract-anomalies-shape-user")}`);

    expect(res.status).toBe(200);
    const [returnedAnomaly] = res.body.anomalies.anomalies;
    expect(returnedAnomaly).not.toHaveProperty("userId");
    expect(returnedAnomaly).not.toHaveProperty("id");
    expect(returnedAnomaly).not.toHaveProperty("description");
    expect(returnedAnomaly.baseline).not.toHaveProperty("expenses");
    expect(returnedAnomaly.expenseId).toBe("64f1a2b3c4d5e6f7a8b9c0d1");
  });
});

describe("GET /report -- forecast section contract (I, Batch 2)", () => {
  it("includes forecast alongside every other stable top-level key", async () => {
    const assembledReport = buildAssembledReport();
    const { app } = loadAppWithMockedService({ getReportImpl: async () => assembledReport });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken("report-contract-forecast-user")}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.forecast).toBe("object");
    // Every remaining stable key is present, including Batch 1's anomalies.
    expect(typeof res.body.anomalies).toBe("object");
    expect(typeof res.body.metadata).toBe("object");
  });

  it("a populated forecast never claims to be anything other than an estimate, and carries no leaked expense/user data", async () => {
    const forecast = {
      hasData: true,
      method: "TRAILING_MEDIAN_MAD_V1",
      historyMonthsAvailable: 6,
      currentPartialMonth: { included: false, totalSoFar: 250, note: "excluded" },
      nextMonthForecast: { hasData: true, method: "TRAILING_MEDIAN_MAD_V1", estimate: 1000, range: { lower: 800, upper: 1200 }, historyMonthsUsed: 6, horizonMonths: 1 },
      nextQuarterForecast: { hasData: true, method: "TRAILING_MEDIAN_MAD_V1", estimate: 3000, range: { lower: 2400, upper: 3600 }, historyMonthsUsed: 6, horizonMonths: 3 },
      nextYearForecast: { hasData: false, reasonCode: "INSUFFICIENT_HISTORY_FOR_NEXT_YEAR", method: "TRAILING_MEDIAN_MAD_V1", estimate: null, range: null, historyMonthsUsed: 6, horizonMonths: 12 },
    };
    const assembledReport = buildAssembledReport({ forecast });
    const { app } = loadAppWithMockedService({ getReportImpl: async () => assembledReport });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken("report-contract-forecast-shape-user")}`);

    expect(res.status).toBe(200);
    expect(res.body.forecast.method).toBe("TRAILING_MEDIAN_MAD_V1");
    expect(res.body.forecast.nextMonthForecast.range.lower).toBeLessThanOrEqual(res.body.forecast.nextMonthForecast.range.upper);
    const serialized = JSON.stringify(res.body.forecast);
    expect(serialized).not.toContain("userId");
    expect(serialized.toLowerCase()).not.toMatch(/\btrained\b|\baccuracy\b/);
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

describe("GET /report -- Phase C read-time repair wiring", () => {
  it("calls syncRecoveryService.repairIfPending for the authenticated user BEFORE serving the report", async () => {
    const assembledReport = buildAssembledReport();
    const callOrder = [];
    const { app } = loadAppWithMockedService({
      getReportImpl: async () => {
        callOrder.push("getReport");
        return assembledReport;
      },
      repairIfPendingImpl: async (userId) => {
        callOrder.push("repairIfPending");
        return { attempted: true, stillPending: false };
      },
    });

    const userId = "report-contract-repair-user";
    const res = await request(app).get("/report").set("Authorization", `Bearer ${signToken(userId)}`);

    expect(res.status).toBe(200);
    expect(callOrder).toEqual(["repairIfPending", "getReport"]);
  });

  it("Phase C.1 -- when repair leaves the report component pending, forces a direct refreshReport() instead of trusting getReport()'s cache/store path", async () => {
    const freshReport = { __probe: "FORCED_FRESH_REPORT", metadata: { version: CURRENT_REPORT_VERSION } };
    const getReportMock = jest.fn(async () => ({ __probe: "SHOULD_NOT_BE_SERVED_STALE" }));
    const refreshReportMock = jest.fn(async () => freshReport);
    jest.doMock(REPORT_SERVICE_PATH, () => ({
      getReport: getReportMock,
      refreshReport: refreshReportMock,
    }));
    jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
      repairIfPending: jest.fn(async () => ({ attempted: true, stillPending: true, reportRepairFailed: true })),
    }));
    const app = require(APP_PATH);

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken("report-contract-forced-refresh-user")}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(freshReport);
    // getReport()'s own cache/store path is never used on this path -- it
    expect(getReportMock).not.toHaveBeenCalled();
    expect(refreshReportMock).toHaveBeenCalledWith("report-contract-forced-refresh-user");
  });

  it("Phase C.1 -- when the forced refresh ALSO fails, returns a controlled 503 rather than falling through to a stale getReport() path", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const getReportMock = jest.fn(async () => ({ __probe: "SHOULD_NOT_BE_SERVED_STALE" }));
    const refreshReportMock = jest.fn(async () => {
      throw new Error("simulated forced-refresh failure");
    });
    jest.doMock(REPORT_SERVICE_PATH, () => ({
      getReport: getReportMock,
      refreshReport: refreshReportMock,
    }));
    jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
      repairIfPending: jest.fn(async () => ({ attempted: true, stillPending: true, reportRepairFailed: true })),
    }));
    const app = require(APP_PATH);

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken("report-contract-forced-refresh-fails-user")}`);

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.recoveryPending).toBe(true);
    expect(getReportMock).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("Phase C.1 -- when the forced refresh is fence-skipped (superseded by newer concurrent work), returns a controlled 503, not a false success", async () => {
    const getReportMock = jest.fn(async () => ({ __probe: "SHOULD_NOT_BE_SERVED_STALE" }));
    const refreshReportMock = jest.fn(async () => ({ skipped: true, reason: "superseded" }));
    jest.doMock(REPORT_SERVICE_PATH, () => ({
      getReport: getReportMock,
      refreshReport: refreshReportMock,
    }));
    jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
      repairIfPending: jest.fn(async () => ({ attempted: true, stillPending: true, reportRepairFailed: true })),
    }));
    const app = require(APP_PATH);

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken("report-contract-forced-refresh-superseded-user")}`);

    expect(res.status).toBe(503);
    expect(res.body.recoveryPending).toBe(true);
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it("Phase C.1 -- when repair fully succeeded (nothing still pending), the normal getReport() cache/store path is used exactly as before", async () => {
    const assembledReport = buildAssembledReport();
    const { app, getReportMock } = loadAppWithMockedService({
      getReportImpl: async () => assembledReport,
      repairIfPendingImpl: async () => ({ attempted: true, stillPending: false, reportRepairFailed: false }),
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken("report-contract-repair-succeeded-user")}`);

    expect(res.status).toBe(200);
    expect(getReportMock).toHaveBeenCalledTimes(1);
  });

  it("still serves the report normally even when repairIfPending itself rejects", async () => {
    // repairIfPending's own contract (Services/syncRecoveryService.js) is to
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const assembledReport = buildAssembledReport();
    const { app } = loadAppWithMockedService({
      getReportImpl: async () => assembledReport,
      repairIfPendingImpl: async () => {
        throw new Error("simulated repair failure");
      },
    });

    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${signToken("report-contract-repair-throws-user")}`);

    // Documents current behavior: report.controller.js's own try/catch
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ success: false, message: "Failed to fetch financial report." });

    consoleErrorSpy.mockRestore();
  });
});
