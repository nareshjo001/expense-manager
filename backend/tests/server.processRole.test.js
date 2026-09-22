// OPS-004-T05 -- only the process that owns the scheduled jobs loads them.
//
// server.js require()s nine cron modules under runsScheduledJobs(): the
// original three, accountDeletionJob (PRV-001-T04), staleDeviceCleanup
// (NOT-003-T06), exportGeneration/exportCleanup (DAT-004-T03/T06), and
// receiptRetention (OCR-004-T07), and importSessionRetention (IMP-001). Each
// calls cron.schedule() at require
// time. Requiring them unconditionally meant every web instance scheduled
// every job, so scaling the web tier to three instances scheduled three
// copies of each. REC-001's Redis leases keep that from double-EXECUTING --
// but a lease is a safety net for a race that should not be happening, and
// during a Redis outage the net is the thing that is missing.
//
// All nine cron files are mocked below (not just the original three) so
// this suite never pulls in a real module's dependency chain (Mongoose
// models, jobLease's Redis client, node-cron's real scheduler holding the
// event loop open past the test run) -- each real cron module has its own
// direct suite, and mocking every one here keeps this file testing ONLY
// server.js's require-gating wiring.
//
// These tests assert the wiring in server.js, not just the helper it calls,
// because the helper being right while server.js ignores it is exactly the
// bug that would ship silently.
"use strict";

const MIN_SECRET_LENGTH = 32;

// Restored in afterEach rather than at the end of loadServer(): server.js's
// startServer() is async, so anything read after the first await -- the
// role reported in the server_started log line, for one -- would see the
// restored environment if loadServer put it back itself.
const ORIGINAL_ENV = process.env;

afterEach(() => {
  process.env = ORIGINAL_ENV;
  jest.resetModules();
  jest.restoreAllMocks();
});

// Loads server.js with everything external stubbed, and reports which cron
// modules it pulled in.
async function loadServer({ processRole } = {}) {
  jest.resetModules();

  const env = {
    ...process.env,
    NODE_ENV: "test",
    MONGO_CONN: "mongodb://localhost:27017/balenisa",
    JWT_SECRET: "a".repeat(MIN_SECRET_LENGTH),
    REFRESH_TOKEN_SECRET: "b".repeat(MIN_SECRET_LENGTH),
  };
  if (processRole === undefined) delete env.PROCESS_ROLE;
  else env.PROCESS_ROLE = processRole;

  process.env = env;

  const scheduled = [];
  const track = (name) => {
    scheduled.push(name);
    return {};
  };

  jest.doMock("../cron/recurringJob", () => track("recurringJob"), { virtual: false });
  jest.doMock("../cron/retryPush", () => track("retryPush"), { virtual: false });
  jest.doMock("../cron/feedbackCollector", () => track("feedbackCollector"), { virtual: false });
  jest.doMock("../cron/accountDeletionJob", () => track("accountDeletionJob"), { virtual: false });
  jest.doMock("../cron/staleDeviceCleanup", () => track("staleDeviceCleanup"), { virtual: false });
  jest.doMock("../cron/exportGeneration", () => track("exportGeneration"), { virtual: false });
  jest.doMock("../cron/exportCleanup", () => track("exportCleanup"), { virtual: false });
  jest.doMock("../cron/receiptRetention", () => track("receiptRetention"), { virtual: false });
  jest.doMock("../cron/importSessionRetention", () => track("importSessionRetention"), { virtual: false });

  const listen = jest.fn((port, host, cb) => {
    if (cb) cb();
    return { close: jest.fn() };
  });
  jest.doMock("../app", () => ({ listen }));
  jest.doMock("../config/db", () => jest.fn(async () => {}));
  jest.doMock("../config/redis", () => ({
    connectRedis: jest.fn(async () => ({ connected: true })),
    isRedisAvailable: () => true,
    redisClient: {},
  }));
  jest.doMock("dotenv", () => ({ config: () => ({}) }));

  require("../server");

  // The cron require()s happen synchronously at module load, but
  // startServer() is async -- app.listen() is reached only after connectDB()
  // and connectRedis() resolve. Flush the microtask queue so `listen` is
  // observable to the assertions below.
  await new Promise((resolve) => {
    setImmediate(resolve);
  });

  return { scheduled, listen };
}

describe("PROCESS_ROLE gates the cron jobs", () => {
  test("PROCESS_ROLE=web schedules NO jobs", async () => {
    const { scheduled } = await loadServer({ processRole: "web" });
    expect(scheduled).toEqual([]);
  });

  test("PROCESS_ROLE=worker schedules all nine", async () => {
    const { scheduled } = await loadServer({ processRole: "worker" });
    expect(scheduled.sort()).toEqual([
      "accountDeletionJob",
      "exportCleanup",
      "exportGeneration",
      "feedbackCollector",
      "importSessionRetention",
      "receiptRetention",
      "recurringJob",
      "retryPush",
      "staleDeviceCleanup",
    ]);
  });

  test("an unset PROCESS_ROLE still schedules them -- the default is behaviour-preserving", async () => {
    // A deployment that upgrades to this version without setting anything
    // must keep running recurring expenses, push retries, ML feedback
    // collection, the account-deletion purge, the stale-device sweep, both
    // export jobs, and the receipt retention sweep. Defaulting to "web"
    // would stop all eight while every instance stayed healthy and served
    // traffic -- the hardest kind of regression to notice.
    const { scheduled } = await loadServer({ processRole: undefined });
    expect(scheduled.sort()).toEqual([
      "accountDeletionJob",
      "exportCleanup",
      "exportGeneration",
      "feedbackCollector",
      "importSessionRetention",
      "receiptRetention",
      "recurringJob",
      "retryPush",
      "staleDeviceCleanup",
    ]);
  });

  test("a web process still serves HTTP", async () => {
    const { listen } = await loadServer({ processRole: "web" });
    expect(listen).toHaveBeenCalled();
  });

  test("a worker process also serves HTTP, so its health probes work", async () => {
    // The worker listens too. A worker with no HTTP port has no /health/live
    // for the platform to probe, so a hung worker would go unnoticed.
    const { listen } = await loadServer({ processRole: "worker" });
    expect(listen).toHaveBeenCalled();
  });
});
