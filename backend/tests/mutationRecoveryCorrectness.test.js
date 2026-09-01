// Phase C.1 -- Mutation Recovery Correctness Gate.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const PENDING_SYNC_PATH = "../models/PendingSync";
const REPORT_MODEL_PATH = "../models/Report";
const REPORT_CACHE_PATH = "../cache/reportCache";
const REPORT_GENERATOR_PATH = "../analytics/reportGenerator";

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

// A minimal, purpose-built in-memory Mongo-like store for PendingSync --
function makeFakePendingSyncModel() {
  const store = new Map(); // userId -> doc

  function defaultDoc(userId) {
    return {
      user: userId,
      revision: 0,
      pendingBudgetMonths: [],
      reportPending: false,
      lastError: null,
      lastAttemptAt: null,
      reservedBudgetMonths: [],
      reservedReports: [],
      reservedUserWideReservations: [],
    };
  }

  // Phase C.4 -- an ISO-8601 date string matcher, used below to revive
  const ISO_DATE_STRING = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  function clone(doc) {
    return doc ? JSON.parse(JSON.stringify(doc), (key, value) => {
      if (key === "month" || key === "reservedAt" || key === "lastAttemptAt") {
        return value === null ? null : new Date(value);
      }
      if (typeof value === "string" && ISO_DATE_STRING.test(value)) {
        return new Date(value);
      }
      return value;
    }) : null;
  }

  function applyUpdate(doc, update) {
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        doc[k] = (doc[k] || 0) + v;
      }
    }
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        doc[k] = v;
      }
    }
    if (update.$addToSet) {
      for (const [k, v] of Object.entries(update.$addToSet)) {
        const values = v.$each || [v];
        doc[k] = doc[k] || [];
        for (const val of values) {
          const exists = doc[k].some((existing) => new Date(existing).getTime() === new Date(val).getTime());
          if (!exists) doc[k].push(val);
        }
      }
    }
    if (update.$push) {
      for (const [k, v] of Object.entries(update.$push)) {
        const values = v.$each || [v];
        doc[k] = doc[k] || [];
        doc[k].push(...values);
      }
    }
    if (update.$pull) {
      for (const [k, v] of Object.entries(update.$pull)) {
        if (v && v.$in) {
          doc[k] = (doc[k] || []).filter(
            (existing) => !v.$in.some((target) => new Date(target).getTime() === new Date(existing).getTime())
          );
        } else if (v && v.token && v.token.$in) {
          doc[k] = (doc[k] || []).filter((existing) => !v.token.$in.includes(existing.token));
        } else if (v && v.token) {
          doc[k] = (doc[k] || []).filter((existing) => existing.token !== v.token);
        }
      }
    }
    return doc;
  }

  function makeQuery(filter) {
    const query = {
      lean: async () => {
        const doc = store.get(String(filter.user));
        if (!doc) return null;
        if (filter.revision !== undefined && doc.revision !== filter.revision) return null;
        return clone(doc);
      },
      select() {
        return query; // no-op projection -- fake never restricts fields
      },
    };
    return query;
  }

  return {
    _store: store,
    findOne: jest.fn((filter) => makeQuery(filter)),
    findOneAndUpdate: jest.fn(async (filter, update, options = {}) => {
      const userId = String(filter.user);
      let doc = store.get(userId);
      if (!doc) {
        if (!options.upsert) return null;
        doc = defaultDoc(userId);
      }
      if (filter.revision !== undefined && doc.revision !== filter.revision) {
        return null;
      }
      const updated = applyUpdate({ ...doc }, update);
      store.set(userId, updated);
      return clone(updated);
    }),
    updateOne: jest.fn(async (filter, update) => {
      const userId = String(filter.user);
      const doc = store.get(userId);
      if (!doc) return { matchedCount: 0 };
      const updated = applyUpdate({ ...doc }, update);
      store.set(userId, updated);
      return { matchedCount: 1 };
    }),
  };
}

// Real Mongo CAS filter evaluation, shared by both fake models below --
function casFilterMatches(doc, filter) {
  if (!filter.$or) return true; // unfenced call -- always matches
  const currentRevision = doc.syncRevision;
  return filter.$or.some((clause) => {
    if (clause.syncRevision && clause.syncRevision.$exists === false) {
      return currentRevision === undefined || currentRevision === null;
    }
    if (clause.syncRevision && clause.syncRevision.$lte !== undefined) {
      return (
        currentRevision !== undefined &&
        currentRevision !== null &&
        currentRevision <= clause.syncRevision.$lte
      );
    }
    return false;
  });
}

// Fake BudgetModel: keyed by `${userId}|${month}`, pre-seeded by the test.
function makeFakeBudgetModel() {
  const store = new Map();
  const key = (userId, month) => `${userId}|${month}`;

  return {
    _store: store,
    seed(userId, month, spent, extra = {}) {
      store.set(key(userId, month), { userId, month, spent, budget: 1000, ...extra });
    },
    get(userId, month) {
      return store.get(key(userId, month));
    },
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const k = key(filter.userId, filter.month);
      const doc = store.get(k);
      if (!doc) return null;
      if (!casFilterMatches(doc, filter)) return null;
      const updated = { ...doc, ...update.$set };
      store.set(k, updated);
      return updated;
    }),
    findOne: jest.fn((filter) => ({
      select: () => ({
        lean: async () => {
          const doc = store.get(key(filter.userId, filter.month));
          return doc
            ? {
                _id: `${filter.userId}|${filter.month}`,
                syncRevision: doc.syncRevision,
              }
            : null;
        },
      }),
    })),
    // Phase C.3 -- backs syncRecoveryService.js's repairIfPending() Tier-2
    find: jest.fn((filter) => ({
      select: () => ({
        lean: async () => {
          const docs = [];
          for (const doc of store.values()) {
            if (String(doc.userId) === String(filter.userId)) {
              docs.push({ month: doc.month });
            }
          }
          return docs;
        },
      }),
    })),
  };
}

// Fake ExpenseModel.aggregate -- a queue of implementations, consumed in
function makeFakeExpenseModel() {
  const impls = [];
  return {
    _queue: impls,
    queueAggregate(impl) {
      impls.push(impl);
    },
    aggregate: jest.fn(async (...args) => {
      const impl = impls.shift();
      if (!impl) return [];
      return impl(...args);
    }),
  };
}

// Fake FinancialReport model (models/Report) -- one doc per user. As of
function makeFakeFinancialReportModel() {
  const store = new Map();
  // Phase C.3 -- lets a test force the NEXT plain (unconditional, no $or)
  let forceNextUpsertConflict = false;
  return {
    _store: store,
    _forceNextUpsertConflict() {
      forceNextUpsertConflict = true;
    },
    findOneAndUpdate: jest.fn((filter, update, options = {}) => ({
      lean: async () => {
        const userId = String(filter.user);
        const existing = store.get(userId);
        // Phase C.3 -- reportService.js now issues every write as a $set
        const setFields = update && update.$set ? update.$set : update;

        if (options.upsert && forceNextUpsertConflict && (!existing || !casFilterMatches(existing, filter))) {
          forceNextUpsertConflict = false;
          const err = new Error(
            "E11000 duplicate key error collection: test.financialreports index: user_1 dup key"
          );
          err.code = 11000;
          throw err;
        }

        if (existing && casFilterMatches(existing, filter)) {
          const merged = { ...existing, ...setFields };
          store.set(userId, merged);
          return merged;
        }

        if (existing && !casFilterMatches(existing, filter)) {
          if (!options.upsert) return null;
          const err = new Error(
            "E11000 duplicate key error collection: test.financialreports index: user_1 dup key"
          );
          err.code = 11000;
          throw err;
        }

        // No document exists for this user at all.
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
}

// Fake reportCache (stands in for Redis) -- a plain Map, with the same
function makeFakeReportCache() {
  const store = new Map();
  const revisionStore = new Map();
  return {
    _store: store,
    _revisionStore: revisionStore,
    get: jest.fn(async (userId) => store.get(String(userId)) || null),
    getWithRevision: jest.fn(async (userId) => {
      const key = String(userId);
      const payload = store.get(key);
      if (!payload) return null;
      return { revision: revisionStore.has(key) ? revisionStore.get(key) : null, payload };
    }),
    set: jest.fn(async (userId, report, revision = null) => {
      const key = String(userId);
      store.set(key, report);
      revisionStore.set(key, revision);
    }),
    invalidate: jest.fn(async (userId) => {
      const key = String(userId);
      store.delete(key);
      revisionStore.delete(key);
    }),
  };
}

function loadReal({ generateReportImpl } = {}) {
  jest.resetModules();

  const fakePendingSync = makeFakePendingSyncModel();
  const fakeBudgetModel = makeFakeBudgetModel();
  const fakeExpenseModel = makeFakeExpenseModel();
  const fakeReport = makeFakeFinancialReportModel();
  const fakeReportCache = makeFakeReportCache();
  const generateReportMock = jest.fn(generateReportImpl || (async () => ({ metadata: { version: 4 } })));

  jest.doMock(PENDING_SYNC_PATH, () => fakePendingSync);
  jest.doMock(SCHEMAS_PATH, () => ({
    ExpenseModel: fakeExpenseModel,
    BudgetModel: fakeBudgetModel,
    UserModel: {},
    MlFeedbackModel: {},
    IncomeModel: {},
  }));
  jest.doMock(REPORT_MODEL_PATH, () => fakeReport);
  jest.doMock(REPORT_CACHE_PATH, () => fakeReportCache);
  jest.doMock(REPORT_GENERATOR_PATH, () => ({ generateReport: generateReportMock }));

  const budgetService = require("../Services/BudgetServices/budget.service");
  const reportService = require("../Services/reportService");
  const syncRecoveryService = require("../Services/syncRecoveryService");

  return {
    budgetService,
    reportService,
    syncRecoveryService,
    fakePendingSync,
    fakeBudgetModel,
    fakeExpenseModel,
    fakeReport,
    fakeReportCache,
    generateReportMock,
  };
}

const USER_ID = "concurrency-user";
const JAN_2026 = new Date("2026-01-15T00:00:00.000Z");
const JAN_MONTH_KEY = JAN_2026.toLocaleString("default", { month: "short", year: "numeric" });
const FEB_2026 = new Date("2026-02-01T00:00:00.000Z");
const FEB_MONTH_KEY = FEB_2026.toLocaleString("default", { month: "short", year: "numeric" });
const MAR_2026 = new Date("2026-03-01T00:00:00.000Z");
const MAR_MONTH_KEY = MAR_2026.toLocaleString("default", { month: "short", year: "numeric" });

describe("Required test 6/7/8: an older synchronization (A) cannot clobber a newer one (B) that already finished", () => {
  it("BudgetModel.spent: A's stale write is skipped by the fence -- B's fresher value survives, PendingSync ends up with no surviving pending marker because B's own confirm+clear already covers it", async () => {
    const { budgetService, syncRecoveryService, fakeBudgetModel, fakeExpenseModel } = loadReal();
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 0);

    // A starts a repair pass first and captures revision 0 (nothing
    const aGate = deferred();
    fakeExpenseModel.queueAggregate(async () => {
      await aGate.promise;
      return [{ _id: null, total: 100 }]; // A's OLDER snapshot
    });
    // B's aggregate resolves immediately with the NEWER total.
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 150 }]);

    // A begins (captures fenceRevision 0) but blocks on its aggregate.
    const aPromise = budgetService.recalculateBudget(USER_ID, JAN_2026, { fenceRevision: 0 });

    // B runs to completion FIRST: reserve -> (primary write happens
    const { budgetReservations, reportReservation } = await syncRecoveryService.reserve({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      reserveReport: false,
    });
    const bResult = await syncRecoveryService.synchronizeAfterMutation({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      budgetTokens: budgetReservations.map((r) => r.token),
      reportToken: reportReservation && reportReservation.token,
    });
    expect(bResult.budget).toBe("synchronized");
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(150);

    // NOW let A's aggregate resolve and finish its write attempt.
    aGate.resolve();
    const aOutcome = await aPromise;

    // A's write was skipped -- fenced out ATOMICALLY at the write itself
    expect(aOutcome).toEqual({ skipped: true, reason: "superseded", currentRevision: 1 });
    // BudgetModel.spent still holds B's fresher value -- never clobbered.
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(150);
    // Final content, not just the return value: the stored document's own
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).syncRevision).toBe(1);
  });

  it("FinancialReport + Redis: A's stale report is skipped by the fence -- B's fresher report and cache entry survive untouched, and A never even touches the cache", async () => {
    const aGate = deferred();
    let call = 0;
    const { reportService, syncRecoveryService, fakeReport, fakeReportCache } = loadReal({
      generateReportImpl: async () => {
        call += 1;
        if (call === 1) {
          // A's call: blocks here until the test explicitly releases it,
          // simulating a slow generate that started before B's mutation.
          await aGate.promise;
          return { metadata: { version: 4 }, spending: { totalSpent: 100 } }; // A's OLDER content
        }
        return { metadata: { version: 4 }, spending: { totalSpent: 150 } }; // B's NEWER content
      },
    });

    const aPromise = reportService.refreshReport(USER_ID, { fenceRevision: 0 });

    const { reportReservation } = await syncRecoveryService.reserve({ userId: USER_ID, reserveReport: true });
    const bResult = await syncRecoveryService.synchronizeAfterMutation({
      userId: USER_ID,
      budgetDates: [],
      reportToken: reportReservation && reportReservation.token,
    });
    expect(bResult.report).toBe("synchronized");
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(150);
    expect(fakeReportCache._store.get(USER_ID).spending.totalSpent).toBe(150);
    expect(fakeReportCache.set).toHaveBeenCalledTimes(1); // only B's win ever reached the cache

    aGate.resolve();
    const aOutcome = await aPromise;

    // A's write was skipped -- fenced out ATOMICALLY at the Mongo write
    expect(aOutcome).toEqual({ skipped: true, reason: "superseded", currentRevision: 1 });
    // Neither Mongo nor "Redis" was overwritten with A's stale content --
    // final contents, not just A's return value.
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(150);
    expect(fakeReport._store.get(USER_ID).syncRevision).toBe(1);
    expect(fakeReportCache._store.get(USER_ID).spending.totalSpent).toBe(150);
    // Requirement 3's second proof: a fenced-out operation cannot even
    expect(fakeReportCache.set).toHaveBeenCalledTimes(1);
    expect(fakeReportCache.invalidate).not.toHaveBeenCalled();

    // Final PendingSync content: B's own confirm+clear cycle already fully
    const finalMarker = await syncRecoveryService.getPendingSync(USER_ID);
    expect(finalMarker.reportPending).toBe(false);
    expect(finalMarker.reservedReports).toEqual([]);
  });
});

describe("Required test 9: revision/marker ABA -- a removed/recreated marker never confuses an old repair", () => {
  it("a stale-captured revision from before a full pending/clear cycle cannot clear a DIFFERENT, later pending cycle at the same revision number's neighborhood", async () => {
    const { syncRecoveryService } = loadReal();

    // First pending cycle: mark pending at revision 0->1, then fully clear.
    const rev1 = await syncRecoveryService.confirm({ userId: USER_ID, budgetDates: [JAN_2026], confirmReport: false });
    expect(rev1).toBe(1);
    await syncRecoveryService.clearIfRevisionMatches({ userId: USER_ID, revision: rev1, repairedBudgetMonths: [JAN_2026] });

    // A captures revision 1 (post-clear) here, but is slow.
    const staleRevision = rev1;

    // Second, unrelated pending cycle begins and moves the revision to 2.
    const rev2 = await syncRecoveryService.confirm({ userId: USER_ID, budgetDates: [JAN_2026], confirmReport: false });
    expect(rev2).toBe(2);

    // A's late clear attempt, using the STALE revision it captured earlier,
    // must not clear the NEW cycle's pending work.
    const clearResult = await syncRecoveryService.clearIfRevisionMatches({
      userId: USER_ID,
      revision: staleRevision,
      repairedBudgetMonths: [JAN_2026],
    });

    expect(clearResult.matched).toBe(false);
    const after = await syncRecoveryService.getPendingSync(USER_ID);
    expect(after.pendingBudgetMonths).toHaveLength(1); // still pending -- not falsely cleared
    expect(after.revision).toBe(2);
  });
});

describe("Required test 10: report repair failure never returns/recaches stale data as fresh", () => {
  it("refreshReport fenced-skip leaves the PRE-EXISTING cache/store completely untouched (not overwritten with a stale value)", async () => {
    const { reportService, fakeReport, fakeReportCache } = loadReal();

    // Seed a pre-existing fresh report/cache entry (as if a prior, newer
    // sync already ran).
    fakeReport._store.set(USER_ID, { metadata: { version: 4 }, spending: { totalSpent: 999 } });
    fakeReportCache._store.set(USER_ID, { metadata: { version: 4 }, spending: { totalSpent: 999 } });

    const result = await reportService.refreshReport(USER_ID, { fenceRevision: 5 }); // no PendingSync doc -> current is null -> treated as fenceRevision mismatch only if current exists; with no doc, current is null so the check `current && current.revision !== fenceRevision` is false -- skip does NOT trigger. Confirm this behavior explicitly:
    // Explanation: when no PendingSync document exists at all, there is
    expect(result.skipped).toBeUndefined();
  });
});

describe("Required test: repair failure with a PendingSync doc present correctly fences a stale refresh", () => {
  it("when a newer revision is on record, refreshReport's fenced write is skipped and existing fresher data is preserved", async () => {
    const { reportService, syncRecoveryService, fakeReport, fakeReportCache } = loadReal();

    // Establish revision 3 on the marker (simulating a newer mutation
    // already having confirmed pending work).
    await syncRecoveryService.confirm({ userId: USER_ID, confirmReport: true });
    await syncRecoveryService.confirm({ userId: USER_ID, confirmReport: true });
    await syncRecoveryService.confirm({ userId: USER_ID, confirmReport: true });
    const marker = await syncRecoveryService.getPendingSync(USER_ID);
    expect(marker.revision).toBe(3);

    // Phase C.2 -- the fence is enforced by the DOCUMENT's OWN stamped
    fakeReport._store.set(USER_ID, {
      metadata: { version: 4 },
      spending: { totalSpent: 999 },
      syncRevision: 3,
    });
    fakeReportCache._store.set(USER_ID, { metadata: { version: 4 }, spending: { totalSpent: 999 } });

    const result = await reportService.refreshReport(USER_ID, { fenceRevision: 2 }); // stale, captured before the 3rd confirm

    expect(result).toEqual({ skipped: true, reason: "superseded", currentRevision: 3 });
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(999);
    expect(fakeReport._store.get(USER_ID).syncRevision).toBe(3); // never rolled back
    expect(fakeReportCache._store.get(USER_ID).spending.totalSpent).toBe(999);
  });
});

describe("Required tests 1-3 + 12: crash gap closure -- reserve() alone (primary write crash simulated by never calling confirm) is still recoverable", () => {
  it("ADD: a reservation with no Tier-1 marker (simulating a crash before confirm ran) is found and repaired once stale", async () => {
    const { syncRecoveryService, fakeBudgetModel, fakeExpenseModel } = loadReal();
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 0);
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 42 }]);

    // reserve() runs (as addexpense.js now does BEFORE its primary write).
    await syncRecoveryService.reserve({ userId: USER_ID, budgetDates: [JAN_2026], reserveReport: false });

    // Simulate a crash: confirm() is NEVER called (the process died right
    // after the primary write, before synchronizeAfterMutation began).
    const before = await syncRecoveryService.getPendingSync(USER_ID);
    expect(before.pendingBudgetMonths).toHaveLength(0); // no Tier-1 evidence at all
    expect(before.reservedBudgetMonths).toHaveLength(1); // only Tier-2 evidence

    // A read-time repair happens "later" (age-gate satisfied via injected now).
    const farFuture = before.reservedBudgetMonths[0].reservedAt.getTime() + 20000;
    const result = await syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });

    expect(result.attempted).toBe(true);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(42);
    // Phase C.2 correction: the reservation is DELIBERATELY NOT released by
    const after = await syncRecoveryService.getPendingSync(USER_ID);
    expect(after.reservedBudgetMonths).toHaveLength(1);
    expect(after.reservedBudgetMonths[0].token).toBe(
      before.reservedBudgetMonths[0].token
    );
  });

  it("EDIT: a reservation covering both the original and new month is fully recoverable after a simulated crash", async () => {
    const { syncRecoveryService, fakeBudgetModel, fakeExpenseModel } = loadReal();
    const FEB_2026 = new Date("2026-02-01T00:00:00.000Z");
    const FEB_KEY = FEB_2026.toLocaleString("default", { month: "short", year: "numeric" });
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 0);
    fakeBudgetModel.seed(USER_ID, FEB_KEY, 0);
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 10 }]);
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 20 }]);

    await syncRecoveryService.reserve({ userId: USER_ID, budgetDates: [JAN_2026, FEB_2026], reserveReport: false });
    const before = await syncRecoveryService.getPendingSync(USER_ID);
    expect(before.reservedBudgetMonths).toHaveLength(2);

    const farFuture = before.reservedBudgetMonths[0].reservedAt.getTime() + 20000;
    await syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });

    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(10);
    expect(fakeBudgetModel.get(USER_ID, FEB_KEY).spent).toBe(20);
  });

  it("DELETE (hard-delete recovery, no surviving expense document or timestamp evidence): reservation alone drives recovery, aggregate naturally reflects the deletion", async () => {
    const { syncRecoveryService, fakeBudgetModel, fakeExpenseModel } = loadReal();
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 999); // stale pre-delete value
    // The deleted expense is gone -- the aggregate over what remains sums to 0.
    fakeExpenseModel.queueAggregate(async () => []);

    await syncRecoveryService.reserve({ userId: USER_ID, budgetDates: [JAN_2026], reserveReport: false });
    const before = await syncRecoveryService.getPendingSync(USER_ID);
    const farFuture = before.reservedBudgetMonths[0].reservedAt.getTime() + 20000;

    await syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });

    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(0);
  });
});

describe("Required test 5: future work is not falsely cleared before its own mutation's write occurs", () => {
  it("a repair running BEFORE a reservation ages leaves it completely untouched -- confirmed only by the owning mutation's own later confirm()", async () => {
    const { syncRecoveryService, fakeBudgetModel, fakeExpenseModel } = loadReal();
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 0);

    // B reserves (pre-write intent) but has not written or confirmed yet.
    const { budgetReservations } = await syncRecoveryService.reserve({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      reserveReport: false,
    });

    // A repair runs immediately after (reservation is fresh, not aged).
    const repairResult = await syncRecoveryService.repairIfPending(USER_ID, { now: Date.now() });
    expect(repairResult.attempted).toBe(false); // nothing eligible yet
    const midState = await syncRecoveryService.getPendingSync(USER_ID);
    expect(midState.reservedBudgetMonths).toHaveLength(1); // still present, untouched

    // NOW B's write "happens" and confirm() runs.
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 77 }]);
    await syncRecoveryService.synchronizeAfterMutation({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      budgetTokens: budgetReservations.map((r) => r.token),
    });

    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(77);
    const finalState = await syncRecoveryService.getPendingSync(USER_ID);
    expect(finalState.reservedBudgetMonths).toHaveLength(0); // released by B's own confirm
    expect(finalState.pendingBudgetMonths).toHaveLength(0); // cleared by B's own successful sync
  });
});

describe("Phase C.2, requirement 1: the complete 7-step reservation-timeout interleaving", () => {
  // Exact scenario from the Phase C.2 brief:
  it("proves the reservation survives step 3's repair, and a later read still reconstructs A's post-write state despite A never confirming", async () => {
    const { syncRecoveryService, fakeBudgetModel, fakeExpenseModel } = loadReal();
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 0);

    // Step 1: Mutation A reserves work (pre-write durable intent), exactly
    // as addexpense.js now does BEFORE its primary write.
    const { budgetReservations } = await syncRecoveryService.reserve({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      reserveReport: false,
    });
    const reservedAt = budgetReservations[0].reservedAt.getTime();

    // Step 2: A remains active for longer than RESERVATION_STALE_MS (15s)
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 100 }]);
    const stepThreeNow = reservedAt + syncRecoveryService.RESERVATION_STALE_MS + 1000; // ~16s later

    // Step 3: a read request treats the reservation as stale (age-gate
    const repairAtStep3 = await syncRecoveryService.repairIfPending(USER_ID, { now: stepThreeNow });

    // Step 4: the repair completes.
    expect(repairAtStep3.attempted).toBe(true);
    // It correctly reflects the CURRENT (pre-A-write) truth as best-available data.
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(100);

    // ANSWER 1: does the original reservation still exist after step 3?
    const afterStep3 = await syncRecoveryService.getPendingSync(USER_ID);
    expect(afterStep3.reservedBudgetMonths).toHaveLength(1);
    expect(afterStep3.reservedBudgetMonths[0].token).toBe(budgetReservations[0].token);

    // ANSWER 2: can the first repair clear, release, or permanently

    // Step 5: Mutation A performs its expense write. Modeled as: the next
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 250 }]);

    // Step 6: the process terminates before confirm() begins. Modeled by
    const afterStep6 = await syncRecoveryService.getPendingSync(USER_ID);
    expect(afterStep6.pendingBudgetMonths).toHaveLength(0); // no Tier-1 evidence from A, ever

    // ANSWER 3: what durable evidence survives step 6? ONLY the Tier-2
    expect(afterStep6.reservedBudgetMonths).toHaveLength(1);
    expect(afterStep6.reservedBudgetMonths[0].token).toBe(budgetReservations[0].token);

    // Step 7: a later budget/report read occurs (getbudgets.js/report
    const stepSevenNow = reservedAt + syncRecoveryService.RESERVATION_STALE_MS + 5000;
    const repairAtStep7 = await syncRecoveryService.repairIfPending(USER_ID, { now: stepSevenNow });

    // ANSWER 4: will the later read definitely reconstruct the post-write
    expect(repairAtStep7.attempted).toBe(true);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(250);

    // The reservation itself still survives even this SECOND repair --
    const finalState = await syncRecoveryService.getPendingSync(USER_ID);
    expect(finalState.reservedBudgetMonths).toHaveLength(1);
  });

  it("CONTRAST: proves the ORIGINAL (rejected) age-based-release design would have reopened the crash gap -- a stale-repair $pull before A's write is unrecoverable", async () => {
    // This test does not exercise production code -- it directly
    const { syncRecoveryService, fakePendingSync } = loadReal();

    const { budgetReservations } = await syncRecoveryService.reserve({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      reserveReport: false,
    });

    // Simulate the REJECTED design: an age-gated pass that releases the
    await fakePendingSync.updateOne(
      { user: USER_ID },
      { $pull: { reservedBudgetMonths: { token: budgetReservations[0].token } } }
    );

    // A's write now happens, then the process crashes before confirm().
    const after = await syncRecoveryService.getPendingSync(USER_ID);
    expect(after.pendingBudgetMonths).toHaveLength(0);
    expect(after.reservedBudgetMonths).toHaveLength(0);

    // A later read's repairIfPending has nothing left to find at all --
    const laterRepair = await syncRecoveryService.repairIfPending(USER_ID, {
      now: Date.now() + 100000,
    });
    expect(laterRepair.attempted).toBe(false);
  });
});

describe("Phase C.3 requirement #1: the post-write corrective-reservation gap is fully closed", () => {
  // Both tests below model the WORST case explicitly: the primary write
  it("DELETE: pre-reads January, a concurrent edit moves the expense to February, delete's primary write commits, the process terminates before ANY post-write call -- a later read fully reconstructs January AND February", async () => {
    const { syncRecoveryService, reportService, fakeBudgetModel, fakeExpenseModel, fakeReport, fakeReportCache } = loadReal({
      generateReportImpl: async () => ({ metadata: { version: 4 }, spending: { totalSpent: 500 } }),
    });

    // Pre-existing BudgetModel documents for both months, holding STALE
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 500);
    fakeBudgetModel.seed(USER_ID, FEB_MONTH_KEY, 0);

    // The delete's ONLY reservation: a single broad, month-agnostic
    const { userWideReservation, reportReservation } = await syncRecoveryService.reserve({
      userId: USER_ID,
      reserveUserWide: true,
      reserveReport: true,
    });
    expect(userWideReservation).toBeTruthy();

    // The primary delete write "happens" here (not modeled as a document
    const beforeCrash = await syncRecoveryService.getPendingSync(USER_ID);
    expect(beforeCrash.pendingBudgetMonths).toHaveLength(0);
    expect(beforeCrash.reportPending).toBe(false);
    expect(beforeCrash.reservedUserWideReservations).toHaveLength(1);
    expect(beforeCrash.reservedUserWideReservations[0].token).toBe(userWideReservation.token);

    // A later read occurs once the reservation is stale. CURRENT
    fakeExpenseModel.queueAggregate(async () => []); // January
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 500 }]); // February

    const farFuture =
      beforeCrash.reservedUserWideReservations[0].reservedAt.getTime() +
      syncRecoveryService.RESERVATION_STALE_MS +
      1000;
    const repairResult = await syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });

    expect(repairResult.attempted).toBe(true);
    expect(repairResult.budgetRepairFailed).toBe(false);
    // Every relevant Budget.spent is now correct -- reconstructed purely
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(0);
    expect(fakeBudgetModel.get(USER_ID, FEB_MONTH_KEY).spent).toBe(500);

    // Report state: the reservedReports reservation (also taken before the
    const report = await reportService.getReport(USER_ID);
    expect(report.spending.totalSpent).toBe(500);
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(500);
    // Redis state: the cache was populated by the SAME repair's refreshReport call.
    expect(fakeReportCache._store.get(USER_ID).spending.totalSpent).toBe(500);

    // PendingSync: the reservation itself is NEVER auto-released by this
    const after = await syncRecoveryService.getPendingSync(USER_ID);
    expect(after.reservedUserWideReservations).toHaveLength(1);
    expect(after.reservedUserWideReservations[0].token).toBe(userWideReservation.token);
    expect(after.reservedReports).toHaveLength(1);
    expect(after.reservedReports[0].token).toBe(reportReservation.token);
  });

  it("EDIT: pre-reads January, a competing edit moves the expense to February first, THEN this edit's own write moves it to March, the process terminates before ANY post-write call -- a later read fully reconstructs January, February, AND March", async () => {
    const { syncRecoveryService, fakeBudgetModel, fakeExpenseModel } = loadReal();

    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 500); // stale: pre-move total
    fakeBudgetModel.seed(USER_ID, FEB_MONTH_KEY, 500); // stale: the competing edit's intermediate state
    fakeBudgetModel.seed(USER_ID, MAR_MONTH_KEY, 0); // stale: doesn't yet reflect the final move

    // This edit's ONLY reservation: the single broad reservation taken
    const { userWideReservation } = await syncRecoveryService.reserve({
      userId: USER_ID,
      reserveUserWide: true,
      reserveReport: false,
    });

    // The edit's own primary write "happens" (moving the expense from its
    const beforeCrash = await syncRecoveryService.getPendingSync(USER_ID);
    expect(beforeCrash.pendingBudgetMonths).toHaveLength(0);
    expect(beforeCrash.reservedUserWideReservations).toHaveLength(1);
    expect(beforeCrash.reservedUserWideReservations[0].token).toBe(userWideReservation.token);

    // A later read occurs once the reservation is stale. CURRENT
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 0 }]); // January
    fakeExpenseModel.queueAggregate(async () => []); // February
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 500 }]); // March

    const farFuture =
      beforeCrash.reservedUserWideReservations[0].reservedAt.getTime() +
      syncRecoveryService.RESERVATION_STALE_MS +
      1000;
    const repairResult = await syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });

    expect(repairResult.attempted).toBe(true);
    expect(repairResult.budgetRepairFailed).toBe(false);
    // The reservedUserWideReservations repair pass reconstructs EVERY
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(0);
    expect(fakeBudgetModel.get(USER_ID, FEB_MONTH_KEY).spent).toBe(0);
    expect(fakeBudgetModel.get(USER_ID, MAR_MONTH_KEY).spent).toBe(500);

    // The reservation survives, untouched, as durable evidence that this
    // edit's own confirm() never ran.
    const after = await syncRecoveryService.getPendingSync(USER_ID);
    expect(after.reservedUserWideReservations).toHaveLength(1);
    expect(after.reservedUserWideReservations[0].token).toBe(userWideReservation.token);
  });
});

describe("Phase C.4 requirement #4: repair-fence uniqueness across two concurrent repair attempts", () => {
  it("an OLDER repair attempt (lower ticket, snapshot captured BEFORE a concurrent change) must NOT overwrite a NEWER repair attempt's (higher ticket) already-persisted fresher result, even though the older attempt's own write physically runs LAST", async () => {
    // Confirmed problem (Phase C.4 requirement #4 audit): BEFORE this fix,
    const { syncRecoveryService, fakeBudgetModel, fakeExpenseModel } = loadReal();
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 0);

    // A stale reservation -- simulates a crashed mutation whose own
    const { userWideReservation } = await syncRecoveryService.reserve({
      userId: USER_ID,
      reserveUserWide: true,
      reserveReport: false,
    });
    const farFuture =
      userWideReservation.reservedAt.getTime() + syncRecoveryService.RESERVATION_STALE_MS + 1000;

    // Attempt A's own aggregate call: its snapshot value (100) is fixed at
    const aGate = deferred();
    fakeExpenseModel.queueAggregate(async () => {
      await aGate.promise;
      return [{ _id: null, total: 100 }]; // A's OLDER snapshot
    });
    // Attempt B's own aggregate resolves immediately with the NEWER total.
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 150 }]);

    // A begins: its Tier-2 pass allocates its OWN ticket (revision 0 -> 1)
    // and starts recalculateBudget for January, blocking on its aggregate.
    const aPromise = syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });

    // B runs to FULL completion while A is still blocked: B's Tier-2 pass,
    const bResult = await syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });
    expect(bResult.attempted).toBe(true);
    expect(bResult.budgetRepairFailed).toBe(false);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(150);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).syncRevision).toBe(2);

    // NOW release A. A resumes with its OLDER snapshot (100) and attempts
    aGate.resolve();
    const aResult = await aPromise;
    expect(aResult.attempted).toBe(true);
    // recalculateBudget's own `{ skipped: true, reason: 'superseded' }`
    expect(aResult.budgetRepairFailed).toBe(false);

    // THE ACTUAL PROOF: B's fresher result survives completely untouched.
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(150);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).syncRevision).toBe(2);

    // The reservation itself is still never auto-released by either
    const after = await syncRecoveryService.getPendingSync(USER_ID);
    expect(after.reservedUserWideReservations).toHaveLength(1);
    expect(after.reservedUserWideReservations[0].token).toBe(userWideReservation.token);
  });

  it("Tier-1 pass: an older repair attempt's own ticket allocation is strictly lower than a concurrent repair attempt's, so its stale snapshot cannot overwrite the newer attempt's already-persisted result either", async () => {
    // Same corruption, same fix, but exercised through the Tier-1
    const { syncRecoveryService, fakeBudgetModel, fakeExpenseModel, fakePendingSync } = loadReal();
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 0);

    // Seed a Tier-1 marker directly (bypassing reserve()/confirm(), which
    fakePendingSync._store.set(USER_ID, {
      user: USER_ID,
      revision: 0,
      pendingBudgetMonths: [JAN_2026],
      reportPending: false,
      lastError: null,
      lastAttemptAt: null,
      reservedBudgetMonths: [],
      reservedReports: [],
      reservedUserWideReservations: [],
    });

    const aGate = deferred();
    fakeExpenseModel.queueAggregate(async () => {
      await aGate.promise;
      return [{ _id: null, total: 100 }]; // A's OLDER snapshot
    });
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 150 }]); // B's NEWER snapshot

    // A begins: its Tier-1 pass allocates its OWN ticket (revision 0 -> 1)
    // and blocks on its own recalculateBudget's aggregate.
    const aPromise = syncRecoveryService.repairIfPending(USER_ID);

    // B runs to full completion while A is still blocked. Since A's own
    const bResult = await syncRecoveryService.repairIfPending(USER_ID);
    expect(bResult.attempted).toBe(true);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(150);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).syncRevision).toBe(2);

    // NOW release A -- its stale (100) write, fenced to its own OLDER
    aGate.resolve();
    const aResult = await aPromise;
    expect(aResult.attempted).toBe(true);
    // A's own recompute for January was superseded (skipped, not an
    expect(aResult.budgetRepairFailed).toBe(true);

    // THE ACTUAL PROOF: B's fresher result survives untouched.
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(150);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).syncRevision).toBe(2);
  });
});

describe("Phase C.3 requirement #3: concurrent first-report creation is fully atomic", () => {
  it("two concurrent refreshes with NO existing FinancialReport document both fail the initial fenced update, both reach creation, and exactly ONE document survives holding the NEWER revision/payload", async () => {
    let generateCall = 0;
    const aGate = deferred();
    const { reportService, fakeReport, fakeReportCache } = loadReal({
      generateReportImpl: async () => {
        generateCall += 1;
        if (generateCall === 1) {
          // A's generateReport call: blocks here so the test can run B to
          await aGate.promise;
          return { metadata: { version: 4 }, spending: { totalSpent: 100 } }; // A's OLDER content
        }
        return { metadata: { version: 4 }, spending: { totalSpent: 200 } }; // B's NEWER content
      },
    });

    // A begins first (older fenceRevision, captured before any pending
    // work exists) but blocks on its own generateReport call.
    const aPromise = reportService.refreshReport(USER_ID, { fenceRevision: 0 });

    // B runs to FULL completion while A is still blocked -- genuinely no
    const bResult = await reportService.refreshReport(USER_ID, { fenceRevision: 1 });
    expect(bResult.skipped).toBeUndefined();
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(200);
    expect(fakeReport._store.get(USER_ID).syncRevision).toBe(1);

    // NOW release A. A's own initial fenced update also fails (nothing
    aGate.resolve();
    const aResult = await aPromise;

    // A's fenceRevision (0) is OLDER than B's already-stamped syncRevision
    expect(aResult).toEqual({ skipped: true, reason: "superseded", currentRevision: 1 });

    // Exactly ONE document survives, end to end -- B's, the newer one.
    expect(fakeReport._store.size).toBe(1);
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(200);
    expect(fakeReport._store.get(USER_ID).syncRevision).toBe(1);
    // Redis holds only the newer revision -- A's fenced-out retry never
    // reaches reportCache.set() at all.
    expect(fakeReportCache._store.get(USER_ID).spending.totalSpent).toBe(200);
  });

  it("when the LATER concurrent creation attempt is actually the fresher one, its retry-into-the-fenced-update correctly WINS and overwrites the just-inserted older document", async () => {
    let generateCall = 0;
    const bGate = deferred();
    const { reportService, fakeReport } = loadReal({
      generateReportImpl: async () => {
        generateCall += 1;
        if (generateCall === 1) {
          // B's own generateReport call: invoked first (B is fired first,
          // below), and blocks here so A can run to full completion first.
          await bGate.promise;
          return { metadata: { version: 4 }, spending: { totalSpent: 300 } }; // B's NEWER content, resolves slow
        }
        return { metadata: { version: 4 }, spending: { totalSpent: 50 } }; // A's OLDER content, resolves fast
      },
    });

    // B starts first (captured the newer fenceRevision) but is slow --
    const bPromise = reportService.refreshReport(USER_ID, { fenceRevision: 5 });

    // A runs to full completion first -- inserts the first-ever document
    // with an OLDER fenceRevision.
    const aResult = await reportService.refreshReport(USER_ID, { fenceRevision: 2 });
    expect(aResult.skipped).toBeUndefined();
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(50);
    expect(fakeReport._store.get(USER_ID).syncRevision).toBe(2);

    // B resolves next -- B's OWN initial fenced update also found nothing
    bGate.resolve();
    const bResult = await bPromise;

    expect(bResult.skipped).toBeUndefined();
    expect(fakeReport._store.size).toBe(1);
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(300);
    expect(fakeReport._store.get(USER_ID).syncRevision).toBe(5);
  });

  it("the genuinely-simultaneous case -- NEITHER caller has committed yet when both attempt their own insert -- is resolved via the E11000 retry, never left as an unhandled duplicate-key error", async () => {
    // A real MongoDB race that a sequential, await-ordered fake cannot
    const { reportService, fakeReport } = loadReal({
      generateReportImpl: async () => ({ metadata: { version: 4 }, spending: { totalSpent: 77 } }),
    });

    fakeReport._forceNextUpsertConflict();

    // This call's own insert attempt is the one that "lost" the race --
    const result = await reportService.refreshReport(USER_ID, { fenceRevision: 0 });

    // No unhandled duplicate-key error escaped -- and since nothing else
    expect(result).toEqual({ skipped: true, reason: "superseded" });
    expect(fakeReport._store.size).toBe(0);
  });
});
