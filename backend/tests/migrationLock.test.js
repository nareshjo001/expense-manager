// DAT-003-T02 -- backend/migrations/lock.js: exclusive migration lock.
// Mocks Redis at the same seam jobLease.test.js does (config/redis) so
// these tests exercise lock.js's actual acquire/release logic built on
// top of the real jobLease.js code, not a re-implementation of it.
"use strict";

const REDIS_CONFIG_PATH = "../config/redis";
const LOCK_PATH = "../migrations/lock";

function loadLock({ setImpl, evalImpl } = {}) {
  jest.resetModules();

  const redisClient = {
    set: jest.fn(setImpl || (async () => "OK")),
    eval: jest.fn(evalImpl || (async () => 1)),
  };

  jest.doMock(REDIS_CONFIG_PATH, () => ({ redisClient }));

  const lock = require(LOCK_PATH);
  return { lock, redisClient };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("migrations/lock: acquireMigrationLock", () => {
  test("returns an owner token when the lock is free", async () => {
    const { lock, redisClient } = loadLock({ setImpl: async () => "OK" });

    const owner = await lock.acquireMigrationLock(1000);

    expect(typeof owner).toBe("string");
    expect(redisClient.set).toHaveBeenCalledWith(
      "job-lease:db-migrations",
      expect.any(String),
      { NX: true, PX: 1000 }
    );
  });

  test("throws MigrationLockError when another process already holds the lock", async () => {
    const { lock } = loadLock({ setImpl: async () => null });

    await expect(lock.acquireMigrationLock(1000)).rejects.toThrow(lock.MigrationLockError);
    await expect(lock.acquireMigrationLock(1000)).rejects.toThrow(/already holds it/);
  });

  test("fails CLOSED (throws) when Redis is unreachable -- opposite of jobLease's fail-open", async () => {
    const { lock } = loadLock({
      setImpl: async () => {
        throw new Error("connection closed");
      },
    });

    await expect(lock.acquireMigrationLock(1000)).rejects.toThrow(lock.MigrationLockError);
    await expect(lock.acquireMigrationLock(1000)).rejects.toThrow(/Redis is unreachable/);
  });

  test("uses the default TTL when none is given", async () => {
    const { lock, redisClient } = loadLock({ setImpl: async () => "OK" });

    await lock.acquireMigrationLock();

    expect(redisClient.set).toHaveBeenCalledWith(
      "job-lease:db-migrations",
      expect.any(String),
      { NX: true, PX: lock.DEFAULT_TTL_MS }
    );
  });
});

describe("migrations/lock: releaseMigrationLock", () => {
  test("never throws even when the release call itself fails", async () => {
    const { lock } = loadLock({
      evalImpl: async () => {
        throw new Error("redis down");
      },
    });

    await expect(lock.releaseMigrationLock("some-owner")).resolves.toBeUndefined();
  });
});

describe("migrations/lock: withMigrationLock", () => {
  test("runs fn and releases the lock when acquisition succeeds", async () => {
    const { lock, redisClient } = loadLock({ setImpl: async () => "OK" });
    const fn = jest.fn(async () => "migration result");

    const result = await lock.withMigrationLock(fn, 1000);

    expect(result).toBe("migration result");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(redisClient.eval).toHaveBeenCalledTimes(1);
  });

  test("does not call fn at all when the lock is already held", async () => {
    const { lock } = loadLock({ setImpl: async () => null });
    const fn = jest.fn(async () => "should not run");

    await expect(lock.withMigrationLock(fn, 1000)).rejects.toThrow(lock.MigrationLockError);
    expect(fn).not.toHaveBeenCalled();
  });

  test("does not call fn at all when Redis is unreachable", async () => {
    const { lock } = loadLock({
      setImpl: async () => {
        throw new Error("connection closed");
      },
    });
    const fn = jest.fn(async () => "should not run");

    await expect(lock.withMigrationLock(fn, 1000)).rejects.toThrow(lock.MigrationLockError);
    expect(fn).not.toHaveBeenCalled();
  });

  test("still releases the lock and propagates the error when fn throws", async () => {
    const { lock, redisClient } = loadLock({ setImpl: async () => "OK" });
    const boom = new Error("migration up() failed");

    await expect(
      lock.withMigrationLock(async () => {
        throw boom;
      }, 1000)
    ).rejects.toThrow("migration up() failed");

    expect(redisClient.eval).toHaveBeenCalledTimes(1);
  });

  test("two concurrent withMigrationLock calls for the same lock: only one runs fn", async () => {
    let held = false;
    const { lock } = loadLock({
      setImpl: async () => {
        if (held) return null;
        held = true;
        return "OK";
      },
    });
    const ran = [];

    const results = await Promise.allSettled([
      lock.withMigrationLock(async () => {
        ran.push("first");
      }, 1000),
      lock.withMigrationLock(async () => {
        ran.push("second");
      }, 1000),
    ]);

    expect(ran).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(lock.MigrationLockError);
  });
});
