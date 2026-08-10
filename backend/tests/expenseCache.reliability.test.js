// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
//
// Proves the exact claim Services/syncRecoveryService.js's header comment
// and Controllers/ExpenseControllers/*.js's inline comments both rely on:
// utils/expenseCache.js's own functions already self-catch every Redis
// error and never reject, for any of the three real Redis client methods
// they call (set/multi, get, sMembers+del). This is why "Redis invalidation
// failure" / "Redis cache-write failure" are not scenarios that ever reach
// the pending-marker/derivedData logic in production -- they are validated
// directly here instead of being simulated (inaccurately) as a rejecting
// mock in a controller test.
//
// Runs under the default backend/jest.config.js (npm test) -- mocks only
// ../config/redis's redisClient; never touches a real Redis connection.
"use strict";

const REDIS_CONFIG_PATH = "../config/redis";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadExpenseCache({ multiExecImpl, getImpl, sMembersImpl, delImpl } = {}) {
  jest.resetModules();

  const execMock = jest.fn(multiExecImpl || (async () => {}));
  const multiChain = {
    set: jest.fn().mockReturnThis(),
    sAdd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: execMock,
  };

  const redisClientMock = {
    multi: jest.fn(() => multiChain),
    get: jest.fn(getImpl || (async () => null)),
    sMembers: jest.fn(sMembersImpl || (async () => [])),
    del: jest.fn(delImpl || (async () => 0)),
  };

  jest.doMock(REDIS_CONFIG_PATH, () => ({
    redisClient: redisClientMock,
    connectRedis: jest.fn(),
  }));

  const expenseCache = require(EXPENSE_CACHE_PATH);
  return { expenseCache, redisClientMock, execMock };
}

describe("utils/expenseCache.js -- Redis failures are always swallowed, never surfaced", () => {
  it("setCache resolves (does not reject) when the Redis multi/exec write fails", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { expenseCache } = loadExpenseCache({
      multiExecImpl: async () => {
        throw new Error("simulated Redis write failure");
      },
    });

    await expect(expenseCache.setCache("report:user-1", { a: 1 })).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("getCache resolves to null (does not reject) when the Redis GET fails", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { expenseCache } = loadExpenseCache({
      getImpl: async () => {
        throw new Error("simulated Redis read failure");
      },
    });

    await expect(expenseCache.getCache("report:user-1")).resolves.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("clearUserExpenseCache resolves (does not reject) when the Redis invalidation itself fails", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { expenseCache } = loadExpenseCache({
      sMembersImpl: async () => {
        throw new Error("simulated Redis invalidation failure");
      },
    });

    await expect(expenseCache.clearUserExpenseCache("user-1")).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
