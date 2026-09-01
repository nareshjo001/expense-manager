// Phase C.3 requirement #2 -- atomic Redis revision fencing.
"use strict";

const REDIS_CONFIG_PATH = "../config/redis";
const REPORT_MODEL_PATH = "../models/Report";
const SCHEMAS_PATH = "../config/Schemas";
const REPORT_GENERATOR_PATH = "../analytics/reportGenerator";
const PENDING_SYNC_PATH = "../models/PendingSync";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// A real in-memory Redis keyspace, with an eval() that mirrors
function makeFakeRedisClient() {
  const store = new Map(); // key -> raw string value
  let evalGate = null;
  let onEvalPaused = null;
  let evalCallCount = 0;
  let pauseOnCallIndex = null;

  return {
    _store: store,
    __armEvalGate(callIndex, promise, onPaused) {
      pauseOnCallIndex = callIndex;
      evalGate = promise;
      onEvalPaused = onPaused;
    },
    get: jest.fn(async (key) => store.get(key) ?? null),
    del: jest.fn(async (key) => {
      store.delete(key);
    }),
    set: jest.fn(async (key, value) => {
      store.set(key, value);
    }),
    eval: jest.fn(async (script, { keys, arguments: args }) => {
      const myIndex = evalCallCount;
      evalCallCount += 1;
      if (pauseOnCallIndex === myIndex) {
        if (onEvalPaused) onEvalPaused();
        await evalGate;
      }

      const key = keys[0];
      const isDelete = script.includes("redis.call('DEL'");

      if (isDelete) {
        const [incomingRevisionRaw] = args;
        const existing = store.get(key);
        if (existing && incomingRevisionRaw !== "") {
          const decoded = JSON.parse(existing);
          if (decoded && decoded.revision !== null && decoded.revision !== undefined) {
            if (Number(incomingRevisionRaw) < Number(decoded.revision)) {
              return 0;
            }
          }
        }
        store.delete(key);
        return 1;
      }

      const [envelope, incomingRevisionRaw] = args;
      const existing = store.get(key);
      if (existing) {
        const decoded = JSON.parse(existing);
        if (decoded && decoded.revision !== null && decoded.revision !== undefined) {
          if (incomingRevisionRaw === "") {
            return 0;
          }
          if (Number(incomingRevisionRaw) < Number(decoded.revision)) {
            return 0;
          }
        }
      }
      store.set(key, envelope);
      return 1;
    }),
  };
}

function loadReportCache() {
  jest.resetModules();
  const fakeRedisClient = makeFakeRedisClient();
  jest.doMock(REDIS_CONFIG_PATH, () => ({
    redisClient: fakeRedisClient,
    connectRedis: jest.fn(),
  }));
  const reportCache = require("../cache/reportCache");
  return { reportCache, fakeRedisClient };
}

const USER_ID = "redis-cas-user";

describe("reportCache.js -- atomic revision-aware set()", () => {
  it("populates an empty cache slot regardless of revision (nothing to protect against yet)", async () => {
    const { reportCache, fakeRedisClient } = loadReportCache();

    await reportCache.set(USER_ID, { spending: { totalSpent: 100 } }, 5);

    const cached = await reportCache.get(USER_ID);
    expect(cached).toEqual({ spending: { totalSpent: 100 } });
    const raw = JSON.parse(fakeRedisClient._store.get(`report:${USER_ID}`));
    expect(raw.revision).toBe(5);
  });

  it("a NEWER-or-equal revision write overwrites an older cached entry", async () => {
    const { reportCache } = loadReportCache();

    await reportCache.set(USER_ID, { spending: { totalSpent: 100 } }, 5);
    await reportCache.set(USER_ID, { spending: { totalSpent: 200 } }, 5); // equal revision -- still allowed
    await reportCache.set(USER_ID, { spending: { totalSpent: 300 } }, 6); // newer

    const cached = await reportCache.get(USER_ID);
    expect(cached).toEqual({ spending: { totalSpent: 300 } });
  });

  it("an OLDER revision write is silently rejected -- the newer cached entry survives untouched", async () => {
    const { reportCache, fakeRedisClient } = loadReportCache();

    await reportCache.set(USER_ID, { spending: { totalSpent: 300 } }, 11);
    await reportCache.set(USER_ID, { spending: { totalSpent: 100 } }, 10); // older -- must be rejected

    const cached = await reportCache.get(USER_ID);
    expect(cached).toEqual({ spending: { totalSpent: 300 } });
    const raw = JSON.parse(fakeRedisClient._store.get(`report:${USER_ID}`));
    expect(raw.revision).toBe(11);
  });

  it("an UNREVISIONED write (null/undefined) can never clobber an entry that already carries a real revision", async () => {
    const { reportCache } = loadReportCache();

    await reportCache.set(USER_ID, { spending: { totalSpent: 300 } }, 11);
    await reportCache.set(USER_ID, { spending: { totalSpent: 999 } }, null);

    const cached = await reportCache.get(USER_ID);
    expect(cached).toEqual({ spending: { totalSpent: 300 } });
  });

  it("invalidate() with an OLDER revision than what is cached is rejected -- the newer cached entry survives", async () => {
    const { reportCache } = loadReportCache();

    await reportCache.set(USER_ID, { spending: { totalSpent: 300 } }, 11);
    await reportCache.invalidate(USER_ID, 10);

    const cached = await reportCache.get(USER_ID);
    expect(cached).toEqual({ spending: { totalSpent: 300 } }); // NOT deleted
  });

  it("invalidate() with a revision equal to or newer than what is cached (or no revision context at all) deletes the entry", async () => {
    const { reportCache } = loadReportCache();

    await reportCache.set(USER_ID, { spending: { totalSpent: 300 } }, 11);
    await reportCache.invalidate(USER_ID, 11);
    expect(await reportCache.get(USER_ID)).toBeNull();

    await reportCache.set(USER_ID, { spending: { totalSpent: 300 } }, 11);
    await reportCache.invalidate(USER_ID); // no revision context -- unconditional/administrative
    expect(await reportCache.get(USER_ID)).toBeNull();
  });
});

describe("Phase C.3 requirement #2 -- the exact A/B Redis race, driven through the REAL reportService.js", () => {
  it("Refresh A applies Mongo revision 10, pauses AFTER Mongo succeeds but BEFORE its own Redis SET, Refresh B applies Mongo revision 11 and caches it, A resumes -- A must NOT overwrite or delete B's cache entry", async () => {
    jest.resetModules();

    const fakeRedisClient = makeFakeRedisClient();
    jest.doMock(REDIS_CONFIG_PATH, () => ({
      redisClient: fakeRedisClient,
      connectRedis: jest.fn(),
    }));

    // Minimal fake FinancialReport model -- real fenced-CAS filter
    const store = new Map();
    function casFilterMatches(doc, filter) {
      if (!filter.$or) return true;
      const currentRevision = doc.syncRevision;
      return filter.$or.some((clause) => {
        if (clause.syncRevision && clause.syncRevision.$exists === false) {
          return currentRevision === undefined || currentRevision === null;
        }
        if (clause.syncRevision && clause.syncRevision.$lte !== undefined) {
          return currentRevision !== undefined && currentRevision !== null && currentRevision <= clause.syncRevision.$lte;
        }
        return false;
      });
    }
    const fakeReportModel = {
      findOneAndUpdate: jest.fn((filter, update, options = {}) => ({
        lean: async () => {
          const userId = String(filter.user);
          const existing = store.get(userId);
          const setFields = update && update.$set ? update.$set : update;
          if (existing && casFilterMatches(existing, filter)) {
            const merged = { ...existing, ...setFields };
            store.set(userId, merged);
            return merged;
          }
          if (existing && !casFilterMatches(existing, filter)) {
            if (!options.upsert) return null;
            const err = new Error("E11000 duplicate key");
            err.code = 11000;
            throw err;
          }
          if (!options.upsert) return null;
          const created = { user: userId, ...setFields };
          store.set(userId, created);
          return created;
        },
      })),
      findOne: jest.fn((filter) => ({
        lean: async () => store.get(String(filter.user)) || null,
      })),
    };
    jest.doMock(REPORT_MODEL_PATH, () => fakeReportModel);
    jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel: {}, BudgetModel: {}, UserModel: {}, MlFeedbackModel: {}, IncomeModel: {} }));
    jest.doMock(PENDING_SYNC_PATH, () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn(), updateOne: jest.fn() }));

    let generateCall = 0;
    jest.doMock(REPORT_GENERATOR_PATH, () => ({
      generateReport: jest.fn(async () => {
        generateCall += 1;
        return generateCall === 1
          ? { metadata: { version: 4 }, spending: { totalSpent: 1000 } } // A's content
          : { metadata: { version: 4 }, spending: { totalSpent: 2000 } }; // B's content
      }),
    }));

    const reportService = require("../Services/reportService");

    // A's Mongo write (revision 10) will succeed immediately (nothing
    const gate = deferred();
    const reachedGate = deferred();
    fakeRedisClient.__armEvalGate(0, gate.promise, () => reachedGate.resolve());

    const aPromise = reportService.refreshReport(USER_ID, { fenceRevision: 10 });
    await reachedGate.promise;

    // B runs to FULL completion while A is parked -- its OWN Mongo write
    const bResult = await reportService.refreshReport(USER_ID, { fenceRevision: 11 });
    expect(bResult.skipped).toBeUndefined();
    expect(store.get(USER_ID).spending.totalSpent).toBe(2000);
    expect(store.get(USER_ID).syncRevision).toBe(11);

    const cachedAfterB = JSON.parse(fakeRedisClient._store.get(`report:${USER_ID}`));
    expect(cachedAfterB.revision).toBe(11);
    expect(cachedAfterB.payload.spending.totalSpent).toBe(2000);

    // Resume A -- A's own eval() call now runs, carrying REVISION 10 (an
    // older revision than what B already cached, 11).
    gate.resolve();
    const aResult = await aPromise;

    // A's MONGO write itself already succeeded earlier (A got there
    expect(aResult.skipped).toBeUndefined();

    // THE ASSERTION THAT MATTERS: A's Redis eval() call, now finally
    const finalCached = JSON.parse(fakeRedisClient._store.get(`report:${USER_ID}`));
    expect(finalCached.revision).toBe(11);
    expect(finalCached.payload.spending.totalSpent).toBe(2000);

    const finalGetReport = await require("../cache/reportCache").get(USER_ID);
    expect(finalGetReport.spending.totalSpent).toBe(2000);
  });
});
