// M0-2 integration suite for the real, authenticated GET /report workflow.
"use strict";

const request = require("supertest");
const app = require("../app");
const testServices = require("./setup/testServices");
const {
  freshUserId,
  signTestToken,
  previousMonthDate,
  buildFakeCachedReport,
  ArtifactTracker,
} = require("./fixtures/reportFixtures");

const REPORT_TTL_SECONDS = 3600;

let tracker;

beforeAll(async () => {
  await testServices.connect();
});

afterAll(async () => {
  await testServices.disconnect();
});

afterEach(async () => {
  if (!tracker) return;
  await tracker.cleanup();
  const result = await tracker.verifyAbsent();
  if (!result.clean) {
    throw new Error(
      `Integration test cleanup left artifacts behind: ${JSON.stringify(result)}`
    );
  }
  tracker = null;
});

describe("GET /report (integration)", () => {
  it(
    "generates User A's report from User A's own seeded data, excludes " +
      "User B's data, matches the stable response contract, and persists " +
      "a FinancialReport document for User A",
    async () => {
      tracker = new ArtifactTracker();

      const userA = freshUserId();
      const userB = freshUserId();

      // User A: two recognisable expenses + a budget.
      await tracker.createExpense(userA, {
        expenseCategory: "M0-2-USER-A-CATEGORY",
        expenseAmount: 4000,
      });
      await tracker.createExpense(userA, {
        expenseCategory: "M0-2-USER-A-CATEGORY",
        expenseAmount: 321,
      });
      await tracker.createBudget(userA, { budget: 10000, spent: 0 });

      // A previous-month expense for User A. Without this, User A has zero
      await tracker.createExpense(userA, {
        expenseCategory: "M0-2-USER-A-PREV-CATEGORY",
        expenseAmount: 1000,
        expenseDate: previousMonthDate(),
      });

      // User B: distinct, non-overlapping recognisable data.
      await tracker.createExpense(userB, {
        expenseCategory: "M0-2-USER-B-CATEGORY",
        expenseAmount: 8765,
      });
      await tracker.createBudget(userB, { budget: 20000, spent: 0 });

      tracker.trackReportUser(userA);
      tracker.trackReportUser(userB);

      const token = signTestToken(userA, "m0-2-user-a@example.test");

      const res = await request(app)
        .get("/report")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);

      // Deterministic, arithmetic-derived values from User A's own fixture.
      expect(res.body.summary.totalSpent).toBe(4321);
      expect(res.body.summary.topCategory).toBe("M0-2-USER-A-CATEGORY");

      // Cross-user isolation: none of User B's recognisable markers appear
      // anywhere in User A's response.
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain("M0-2-USER-B-CATEGORY");
      expect(serialized).not.toContain("8765");

      // Stable top-level contract.
      expect(typeof res.body.metadata).toBe("object");
      expect(typeof res.body.metadata.generatedAt).toBe("string");
      expect(typeof res.body.metadata.reportPeriod.month).toBe("number");
      expect(typeof res.body.metadata.reportPeriod.year).toBe("number");
      expect(typeof res.body.summary).toBe("object");
      expect(typeof res.body.spending).toBe("object");
      expect(typeof res.body.budgets).toBe("object");
      expect(typeof res.body.categories.monthly).toBe("object");
      expect(typeof res.body.categories.yearly).toBe("object");
      expect(typeof res.body.trends).toBe("object");
      expect(typeof res.body.habits.monthly).toBe("object");
      expect(typeof res.body.habits.yearly).toBe("object");
      expect(typeof res.body.forecast).toBe("object");
      expect(res.body.forecast).toEqual({});

      // financialHealth: type-checked per the exact, freshly-verified
      // analyzer/assembler shapes -- not guessed.
      expect(typeof res.body.financialHealth).toBe("object");
      expect(typeof res.body.financialHealth.scores).toBe("object");
      expect(
        res.body.financialHealth.overall === null ||
          typeof res.body.financialHealth.overall === "number"
      ).toBe(true);
      expect(typeof res.body.financialHealth.risk).toBe("object");
      expect(typeof res.body.financialHealth.risk.label).toBe("string");
      expect(typeof res.body.financialHealth.risk.color).toBe("string");
      expect(Array.isArray(res.body.financialHealth.signals)).toBe(true);

      // summary: only the fields the live pipeline actually populates
      expect(typeof res.body.summary.totalSpent).toBe("number");
      expect(typeof res.body.summary.transactionCount).toBe("number");
      expect(typeof res.body.summary.dailyAverage).toBe("number");
      // Deterministic from the seeded fixtures: current-month total 4321
      expect(res.body.summary.comparePastMonth).toBe(332.1);
      expect(typeof res.body.summary.topCategory).toBe("string");
      expect(typeof res.body.summary.budgetUtilization).toBe("number");
      expect(typeof res.body.summary.budgetStatus).toBe("string");

      // Direct MongoDB proof that GET /report actually persisted a report
      // for User A (not just returned an in-memory value).
      const FinancialReport = require("../models/Report");
      const persisted = await FinancialReport.findOne({ user: userA }).lean();
      expect(persisted).not.toBeNull();
      expect(persisted.summary.totalSpent).toBe(4321);
    }
  );

  it("on a cache miss, generates the report, stores it under the exact user-scoped Redis key with the expected TTL", async () => {
    tracker = new ArtifactTracker();

    const userC = freshUserId();
    await tracker.createExpense(userC, {
      expenseCategory: "M0-2-USER-C-CATEGORY",
      expenseAmount: 555,
    });
    await tracker.createBudget(userC, { budget: 5000, spent: 0 });
    tracker.trackReportUser(userC);

    const cacheKey = `report:${userC}`;
    tracker.trackRedisKey(cacheKey, testServices.redisClient);

    // Confirm no stale key exists before the request (a fresh ObjectId
    const existedBefore = await testServices.redisClient.exists(cacheKey);
    expect(existedBefore).toBe(0);

    const token = signTestToken(userC, "m0-2-user-c@example.test");
    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);

    const cachedRaw = await testServices.redisClient.get(cacheKey);
    expect(cachedRaw).not.toBeNull();

    const cached = JSON.parse(cachedRaw);
    expect(cached.summary.totalSpent).toBe(res.body.summary.totalSpent);
    expect(cached.summary.topCategory).toBe(res.body.summary.topCategory);

    const ttl = await testServices.redisClient.ttl(cacheKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(REPORT_TTL_SECONDS);
    // "Approximately one hour" -- allow generous headroom for test latency
    // rather than asserting an exact remaining-second count.
    expect(ttl).toBeGreaterThan(REPORT_TTL_SECONDS - 300);
  });

  it("a cache hit returns independently pre-seeded cached content, never freshly generated MongoDB data", async () => {
    tracker = new ArtifactTracker();

    // Deliberately NO MongoDB fixtures for this user -- if the response
    // reflects the marker below, it could only have come from the cache.
    const userD = freshUserId();
    const cacheKey = `report:${userD}`;
    tracker.trackRedisKey(cacheKey, testServices.redisClient);
    tracker.trackReportUser(userD);

    const marker = 999999999;
    const fakeReport = buildFakeCachedReport(marker);
    await testServices.redisClient.set(cacheKey, JSON.stringify(fakeReport), {
      EX: REPORT_TTL_SECONDS,
    });

    const token = signTestToken(userD, "m0-2-user-d@example.test");
    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalSpent).toBe(marker);
    expect(res.body.summary.topCategory).toBe("M0-2-FAKE-CACHE-MARKER");

    // No MongoDB write should have occurred for a cache hit.
    const FinancialReport = require("../models/Report");
    const persisted = await FinancialReport.findOne({ user: userD }).lean();
    expect(persisted).toBeNull();
  });

  it("User F never receives User E's pre-seeded cached report", async () => {
    tracker = new ArtifactTracker();

    const userE = freshUserId();
    const userF = freshUserId();

    // User E: cache pre-seeded with a marker, no MongoDB fixtures, and
    // User E's own report is never requested in this test.
    const userECacheKey = `report:${userE}`;
    tracker.trackRedisKey(userECacheKey, testServices.redisClient);
    const eMarker = 123123123;
    await testServices.redisClient.set(
      userECacheKey,
      JSON.stringify(buildFakeCachedReport(eMarker)),
      { EX: REPORT_TTL_SECONDS }
    );

    // User F: real MongoDB fixtures, own recognisable data.
    await tracker.createExpense(userF, {
      expenseCategory: "M0-2-USER-F-CATEGORY",
      expenseAmount: 250,
    });
    await tracker.createBudget(userF, { budget: 3000, spent: 0 });
    tracker.trackReportUser(userF);

    const tokenF = signTestToken(userF, "m0-2-user-f@example.test");
    const res = await request(app)
      .get("/report")
      .set("Authorization", `Bearer ${tokenF}`);

    expect(res.status).toBe(200);
    expect(res.body.summary.totalSpent).not.toBe(eMarker);
    expect(res.body.summary.topCategory).toBe("M0-2-USER-F-CATEGORY");
    expect(JSON.stringify(res.body)).not.toContain(String(eMarker));
  });
});
