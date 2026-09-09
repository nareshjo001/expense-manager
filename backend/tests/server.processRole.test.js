// OPS-004-T05 -- only the process that owns the scheduled jobs loads them.
//
// server.js require()s three cron modules, and each calls cron.schedule() at
// require time. Requiring them unconditionally meant every web instance
// scheduled every job, so scaling the web tier to three instances scheduled
// three copies of each. REC-001's Redis leases keep that from
// double-EXECUTING -- but a lease is a safety net for a race that should not
// be happening, and during a Redis outage the net is the thing that is
// missing.
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

  test("PROCESS_ROLE=worker schedules all three", async () => {
    const { scheduled } = await loadServer({ processRole: "worker" });
    expect(scheduled.sort()).toEqual(["feedbackCollector", "recurringJob", "retryPush"]);
  });

  test("an unset PROCESS_ROLE still schedules them -- the default is behaviour-preserving", async () => {
    // A deployment that upgrades to this version without setting anything
    // must keep running recurring expenses, push retries and ML feedback
    // collection. Defaulting to "web" would stop all three while every
    // instance stayed healthy and served traffic -- the hardest kind of
    // regression to notice.
    const { scheduled } = await loadServer({ processRole: undefined });
    expect(scheduled.sort()).toEqual(["feedbackCollector", "recurringJob", "retryPush"]);
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
