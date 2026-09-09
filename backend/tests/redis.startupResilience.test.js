// OPS-004-T04 -- an unreachable Redis degrades the backend, it does not stop it.
//
// Before this change connectRedis() awaited redisClient.connect() with no
// catch, and server.js turned the rejection into process.exit(1). Combined
// with a platform that restarts on exit, a Redis blip produced a crash loop:
// restart, fail on the same unreachable Redis, repeat -- so the backend was
// DOWN for the duration of a cache outage rather than degraded through it.
"use strict";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  delete process.env.REDIS_URL;
});

function loadRedisModule({ connectFails = false, isReady = true } = {}) {
  jest.resetModules();

  const connect = jest.fn(async () => {
    if (connectFails) throw new Error("ECONNREFUSED 127.0.0.1:6379");
  });

  const client = {
    connect,
    on: jest.fn(),
    get isReady() {
      return isReady;
    },
    isOpen: false,
  };

  jest.doMock("redis", () => ({ createClient: () => client }));

  return { module: require("../config/redis"), client, connect };
}

describe("connectRedis", () => {
  test("resolves with connected:true on success", async () => {
    const { module } = loadRedisModule();
    await expect(module.connectRedis()).resolves.toEqual({ connected: true });
  });

  test("does NOT throw when Redis is unreachable", async () => {
    // This single assertion is the whole feature. connectRedis() rejecting
    // is what server.js's try/catch turned into process.exit(1).
    const { module } = loadRedisModule({ connectFails: true });
    await expect(module.connectRedis()).resolves.toEqual(
      expect.objectContaining({ connected: false })
    );
  });

  test("returns the underlying error so the caller can log why", async () => {
    const { module } = loadRedisModule({ connectFails: true });
    const result = await module.connectRedis();

    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toContain("ECONNREFUSED");
  });

  test("registers an 'error' listener on the client", async () => {
    // Not decoration: an EventEmitter with no "error" listener rethrows the
    // error as an uncaught exception, which server.js's process handler
    // turns into an exit -- reintroducing this exact crash by another route.
    const { client } = loadRedisModule();
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
  });

  test("a background retry is scheduled only when REDIS_URL was configured", async () => {
    // Retrying against an absent REDIS_URL would log a failure every 30s
    // forever on a machine that never intended to run Redis.
    jest.useFakeTimers();
    const spy = jest.spyOn(global, "setInterval");

    const { module } = loadRedisModule({ connectFails: true });
    await module.connectRedis();
    expect(spy).not.toHaveBeenCalled();

    jest.useRealTimers();
    spy.mockRestore();
  });

  test("schedules a retry when REDIS_URL is set, so a late-starting Redis is picked up", async () => {
    // node-redis's own reconnectStrategy covers a connection that dropped
    // after connecting; it does not cover a connect() that never succeeded.
    // That is the deploy-time case -- Redis provisioned after the backend --
    // and without this the instance stays cacheless until someone redeploys.
    jest.useFakeTimers();
    process.env.REDIS_URL = "redis://localhost:6379";
    const spy = jest.spyOn(global, "setInterval");

    const { module } = loadRedisModule({ connectFails: true });
    await module.connectRedis();

    expect(spy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));

    jest.useRealTimers();
    spy.mockRestore();
  });
});

describe("isRedisAvailable", () => {
  test("reads the client's live state rather than a remembered flag", async () => {
    // A boolean set once at connect time goes stale the moment the
    // connection drops, and would make /health/deps confidently wrong.
    const { module } = loadRedisModule({ isReady: true });
    expect(module.isRedisAvailable()).toBe(true);
  });

  test("reports false when the client is not ready", () => {
    const { module } = loadRedisModule({ isReady: false });
    expect(module.isRedisAvailable()).toBe(false);
  });
});
