// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
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
