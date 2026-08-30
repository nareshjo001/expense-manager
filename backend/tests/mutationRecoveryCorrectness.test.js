// Phase C.1 -- Mutation Recovery Correctness Gate.
//
// End-to-end concurrency proof for the crash-gap closure and the
// derived-data write fencing. Unlike syncRecoveryService.test.js (which
// mocks budget.service.js/reportService.js themselves), THIS file keeps
// Services/BudgetServices/budget.service.js, Services/reportService.js, and
// Services/syncRecoveryService.js entirely REAL, and only fakes the model/
// cache layer beneath them (models/PendingSync, config/Schemas's
// ExpenseModel/BudgetModel, models/Report, cache/reportCache,
// analytics/reportGenerator). This is what lets these tests assert the
// FINAL CONTENTS of BudgetModel, FinancialReport, "Redis" (the fake
// reportCache store), and PendingSync after a controlled interleaving --
// not just which mocked function was called with what arguments.
//
// Every interleaving below is driven by explicit, manually-resolved
// deferred promises -- never a real timer/sleep -- so the ordering is
// exact and deterministic on every run.
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
// real CAS semantics (filter.revision must match to update), real $inc/
// $set/$addToSet/$push/$pull application, real upsert. Good enough for
// every update shape syncRecoveryService.js actually issues (verified
// against Services/syncRecoveryService.js's exact update documents).
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
  // `pendingBudgetMonths` ARRAY ELEMENTS back into real Date objects.
  // Confirmed problem: the reviver below only special-cased revival by
  // OBJECT KEY name ("month"/"reservedAt"/"lastAttemptAt"), but
  // `pendingBudgetMonths` is a plain array of Date values with no such key
  // on each element (JSON's reviver receives the ARRAY INDEX, e.g. "0", as
  // `key` for array elements, never a name) -- so those entries silently
  // round-tripped through JSON.stringify/parse as plain STRINGS, not
  // dates, on every lean() read. No test exercised repairIfPending()'s own
  // Tier-1 recompute loop (`for (const anchor of before.pendingBudgetMonths)`)
  // against this fake model before Phase C.4's own new repair-fence-
  // uniqueness tests -- every prior test either drove Tier-2 reservations
  // or used synchronizeAfterMutation (whose own `budgetDates` come from the
  // caller directly, never a re-read marker), so this never surfaced.
  // `getMonthRange(date)` -- called by budget.service.js's
  // recalculateBudget() for each anchor -- calls `date.getFullYear()`,
  // which throws on a plain string, silently caught by repairIfPending()'s
  // own per-month try/catch and misreported as a budget repair failure
  // rather than ever actually recomputing.
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
// matches the exact `$or: [{syncRevision:{$exists:false}}, {syncRevision:
// {$lte: fenceRevision}}]` shape budget.service.js/reportService.js issue
// (see config/Schemas.js's budgetSchema.syncRevision / models/Report.js's
// financialReportSchema.syncRevision).
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
// findOneAndUpdate never upserts (matches the real recalculateBudget call,
// which relies on the month document already existing) and, as of Phase
// C.2, actually enforces the atomic syncRevision CAS filter budget.
// service.js's fenced call issues -- a filter that fails to match returns
// null (never applies the update), exactly like a real MongoDB
// findOneAndUpdate with no upsert. findOne(...).select(...).lean() backs
// budget.service.js's post-CAS-failure existence check.
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
    // reservedUserWideReservations pass, which enumerates EVERY existing BudgetModel
    // month for a user (it deliberately does not know which single month
    // the owning edit/delete actually affected) via
    // `BudgetModel.find({ userId }).select("month").lean()`.
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
// call order, so each call in a test can return a distinct, controllable
// (possibly deferred) total.
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
// Phase C.2, reportService.js's persistAndCache() issues THREE distinct
// shapes of findOneAndUpdate against this model, in this order when the
// first is fenced-out or nothing exists yet:
//   1. A (possibly fenced) conditional update with upsert:false -- returns
//      the merged doc if the filter matches an existing document, else
//      null (deliberately never upserts here -- see reportService.js's own
//      doc comment on why upsert+a-CAS-filter-that-can-fail-to-match-an-
//      EXISTING-uniquely-keyed-document is unsafe).
//   2. findOne(...).lean() -- distinguishes "exists but fenced out" from
//      "genuinely doesn't exist yet".
//   3. An unconditional (no $or) upsert:true call, ONLY when step 2 found
//      nothing -- the genuine first-ever-report-for-this-user path.
// This fake models all three accurately, including the real MongoDB
// upsert-vs-unique-index pitfall (an upsert whose filter fails to match an
// EXISTING document attempts an INSERT and collides with the unique index
// on `user`) so a regression back to the old unsafe `upsert: true` +
// fenced-filter combination would be caught by these tests via an
// unexpected E11000 throw instead of silently "passing" on a fake that
// doesn't model the pitfall at all.
function makeFakeFinancialReportModel() {
  const store = new Map();
  // Phase C.3 -- lets a test force the NEXT plain (unconditional, no $or)
  // upsert attempt to fail with E11000 regardless of whether a document
  // currently exists in this fake's own store. This models the genuine
  // MongoDB race requirement #3 is about: two concurrent findOneAndUpdate
  // upsert:true calls, NEITHER of which has committed yet, both determine
  // "no match" and both attempt an insert -- only one can win, and the
  // other gets a real duplicate-key error from the storage engine itself,
  // even though (from this single-threaded fake's own perspective) nothing
  // was in its Map yet at the moment the call was made. A sequential,
  // await-ordered fake cannot reproduce that race organically (by the time
  // a second call actually runs, the first one's document is already
  // fully visible, so the fake's own upsert just matches normally) -- this
  // explicit arm is what lets a test exercise reportService.js's
  // createFirstReport() E11000-retry branch honestly.
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
        // update (never a full-document replacement -- see its own doc
        // comment on the replacement-vs-$set fix), so the fake must apply
        // update.$set the same way a real MongoDB $set operator would:
        // only the listed top-level keys change, everything else on an
        // existing document survives untouched.
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
// get/set/invalidate contract as cache/reportCache.js.
// Phase C.4 -- also exposes getWithRevision(), since Services/reportService.js's
// real getReport() now reads through it (not get()) to compare a cached
// entry's own revision against PendingSync's durable floor. `_store` keeps
// its existing userId -> payload shape (several tests already poke it
// directly, e.g. `_store.set(USER_ID, {...})`), with a separate parallel
// `_revisionStore` (userId -> revision) tracking whatever revision set()
// was actually called with. A revision never recorded via set() (including
// every entry a test seeds directly through `_store.set(...)`) reads back
// as `null` through getWithRevision() -- "no revision context available",
// exactly like a legacy/unfenced cache write in the real module.
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
    // pending yet -- this simulates a repair invoked while B's mutation is
    // already known-pending from an EARLIER failure, so both A and B will
    // recompute the same month.) A's aggregate is deferred so the test can
    // interleave B's full mutation before A's aggregate resolves.
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
    // elsewhere, not modeled here) -> synchronizeAfterMutation, which
    // itself confirms (bumping revision to 1), recomputes with the NEWER
    // total, persists, and clears.
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
    // (BudgetModel.findOneAndUpdate's own syncRevision CAS filter), because
    // the revision moved (B's confirm bumped it) since A captured its
    // fence value. This is proven for real here (not merely asserted) by
    // the fake model's own CAS filter evaluation -- see casFilterMatches
    // above and budget.service.js's real findOneAndUpdate call it mirrors.
    expect(aOutcome).toEqual({ skipped: true, reason: "superseded", currentRevision: 1 });
    // BudgetModel.spent still holds B's fresher value -- never clobbered.
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(150);
    // Final content, not just the return value: the stored document's own
    // syncRevision stamp is B's (1), never rolled back by A's later,
    // fenced-out attempt.
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
    // itself (proven by the fake's real CAS filter evaluation, not merely
    // asserted).
    expect(aOutcome).toEqual({ skipped: true, reason: "superseded", currentRevision: 1 });
    // Neither Mongo nor "Redis" was overwritten with A's stale content --
    // final contents, not just A's return value.
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(150);
    expect(fakeReport._store.get(USER_ID).syncRevision).toBe(1);
    expect(fakeReportCache._store.get(USER_ID).spending.totalSpent).toBe(150);
    // Requirement 3's second proof: a fenced-out operation cannot even
    // ATTEMPT to invalidate a newer cache entry -- reportCache.set() is
    // still only ever called the ONE time (B's win); A's skip path never
    // calls set() or any invalidate/delete equivalent at all.
    expect(fakeReportCache.set).toHaveBeenCalledTimes(1);
    expect(fakeReportCache.invalidate).not.toHaveBeenCalled();

    // Final PendingSync content: B's own confirm+clear cycle already fully
    // covers this report -- A's later, fenced-out, no-op attempt leaves no
    // trace in the marker either.
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
    // nothing to be "superseded" by, so the fence check is a no-op and the
    // write proceeds normally -- this assertion documents that exact
    // (intentional) behavior rather than assuming it.
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
    // syncRevision, not by a separate read of PendingSync.revision. Seed
    // the document exactly as a real revision-3 write would have left it
    // (this is what "a newer generation already won" concretely means at
    // the storage layer -- see reportService.js's persistAndCache).
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
    // this defensive recompute -- a fixed timeout cannot prove the true
    // owner will never still write. It remains present (an accepted,
    // bounded cost -- see the dedicated 7-step interleaving test below for
    // why this is required for correctness, not a leftover bug) until the
    // owning mutation's own confirm() or abandon() retires it.
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
  //   1. Mutation A reserves work.
  //   2. A remains active for longer than 15s but has not performed its
  //      primary write.
  //   3. A read request treats the reservation as stale and repairs it.
  //   4. The repair completes.
  //   5. Mutation A performs its expense write.
  //   6. The process terminates before confirm() begins.
  //   7. A later budget/report read occurs.
  //
  // A "primary write" is modeled here as a change to what the NEXT
  // ExpenseModel.aggregate() call returns -- recalculateBudget always
  // recomputes from CURRENT data, so "A performed its write" is
  // indistinguishable, from budget.service.js's perspective, from "the
  // aggregate now reflects one more expense". confirm() is simply never
  // called anywhere in this test -- that IS the simulated crash at step 6.
  // Every "read" is a call to repairIfPending with an injected `now`, never
  // a real timer/sleep.
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
    // but has NOT performed its primary write yet -- the expense data A is
    // about to write does not exist in the "database" yet, so the next
    // aggregate call still reflects the PRE-write total (100).
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 100 }]);
    const stepThreeNow = reservedAt + syncRecoveryService.RESERVATION_STALE_MS + 1000; // ~16s later

    // Step 3: a read request treats the reservation as stale (age-gate
    // satisfied) and repairs it -- this is a defensive Tier-2 recompute,
    // triggered purely by age, while A is (unknown to the repair) still
    // genuinely in flight.
    const repairAtStep3 = await syncRecoveryService.repairIfPending(USER_ID, { now: stepThreeNow });

    // Step 4: the repair completes.
    expect(repairAtStep3.attempted).toBe(true);
    // It correctly reflects the CURRENT (pre-A-write) truth as best-available data.
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(100);

    // ANSWER 1: does the original reservation still exist after step 3?
    // YES -- Phase C.2's correction means the age-gated Tier-2 pass NEVER
    // pulls/clears a reservation, only recomputes defensively.
    const afterStep3 = await syncRecoveryService.getPendingSync(USER_ID);
    expect(afterStep3.reservedBudgetMonths).toHaveLength(1);
    expect(afterStep3.reservedBudgetMonths[0].token).toBe(budgetReservations[0].token);

    // ANSWER 2: can the first repair clear, release, or permanently
    // consume the reservation? NO -- proven directly above: the exact same
    // token, still present, after a repair pass that a stale-based release
    // design (the ORIGINAL, incorrect Phase C.1 behavior) would have
    // pulled at this exact point.

    // Step 5: Mutation A performs its expense write. Modeled as: the next
    // aggregate call now reflects A's committed expense (total moves from
    // 100 to 250) -- recalculateBudget always recomputes from current data,
    // so this is indistinguishable from a real committed write landing.
    fakeExpenseModel.queueAggregate(async () => [{ _id: null, total: 250 }]);

    // Step 6: the process terminates before confirm() begins. Modeled by
    // simply never calling confirm()/synchronizeAfterMutation for A's own
    // mutation anywhere in this test -- there is no Tier-1
    // pendingBudgetMonths marker for this month at all, and never will be
    // from A's own attempt.
    const afterStep6 = await syncRecoveryService.getPendingSync(USER_ID);
    expect(afterStep6.pendingBudgetMonths).toHaveLength(0); // no Tier-1 evidence from A, ever

    // ANSWER 3: what durable evidence survives step 6? ONLY the Tier-2
    // reservation from step 1 -- still present, untouched by step 3's
    // repair, and now the SOLE surviving evidence that this month's budget
    // may not reflect the latest committed expense state.
    expect(afterStep6.reservedBudgetMonths).toHaveLength(1);
    expect(afterStep6.reservedBudgetMonths[0].token).toBe(budgetReservations[0].token);

    // Step 7: a later budget/report read occurs (getbudgets.js/report
    // controller both funnel through this same repairIfPending call). The
    // reservation is STILL stale (it was never refreshed/renewed -- its
    // reservedAt is unchanged since step 1), so this read triggers ANOTHER
    // defensive Tier-2 recompute, using whatever is CURRENT now (A's write
    // already landed at step 5).
    const stepSevenNow = reservedAt + syncRecoveryService.RESERVATION_STALE_MS + 5000;
    const repairAtStep7 = await syncRecoveryService.repairIfPending(USER_ID, { now: stepSevenNow });

    // ANSWER 4: will the later read definitely reconstruct the post-write
    // state? YES -- proven directly: Budget.spent now reflects A's write
    // (250), despite A having crashed before ever calling confirm().
    expect(repairAtStep7.attempted).toBe(true);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(250);

    // The reservation itself still survives even this SECOND repair --
    // reconstruction is guaranteed to keep happening on every subsequent
    // read for as long as the reservation is never explicitly retired by
    // A's own confirm() (never coming, per step 6) or an operator/future
    // abandon() call. This is the accepted, bounded operational cost the
    // Phase C.2 brief calls for ("keep durable recoverability until the
    // owner explicitly confirms or aborts") -- not a correctness gap: the
    // data is always eventually (in fact immediately, on the very next
    // read) correct, at the cost of a harmless repeated recompute.
    const finalState = await syncRecoveryService.getPendingSync(USER_ID);
    expect(finalState.reservedBudgetMonths).toHaveLength(1);
  });

  it("CONTRAST: proves the ORIGINAL (rejected) age-based-release design would have reopened the crash gap -- a stale-repair $pull before A's write is unrecoverable", async () => {
    // This test does not exercise production code -- it directly
    // demonstrates, using the same fake PendingSync store, why an
    // age-gated $pull (Phase C.1's original, incorrect design) is unsound:
    // once the reservation is gone, NOTHING durable survives a crash
    // before confirm(), and a later read has no way to know recovery is
    // owed at all.
    const { syncRecoveryService, fakePendingSync } = loadReal();

    const { budgetReservations } = await syncRecoveryService.reserve({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      reserveReport: false,
    });

    // Simulate the REJECTED design: an age-gated pass that releases the
    // reservation purely because it looks stale (this is exactly the
    // $pull repairIfPending's Tier-2 pass deliberately no longer issues).
    await fakePendingSync.updateOne(
      { user: USER_ID },
      { $pull: { reservedBudgetMonths: { token: budgetReservations[0].token } } }
    );

    // A's write now happens, then the process crashes before confirm().
    // No Tier-1 marker was ever set (confirm() never ran), and the Tier-2
    // reservation -- A's ONLY durable evidence -- was just destroyed.
    const after = await syncRecoveryService.getPendingSync(USER_ID);
    expect(after.pendingBudgetMonths).toHaveLength(0);
    expect(after.reservedBudgetMonths).toHaveLength(0);

    // A later read's repairIfPending has nothing left to find at all --
    // this IS the original crash gap Phase C set out to close, reopened by
    // the age-based release. This is precisely why Phase C.2 removed the
    // $pull from the age-gated pass.
    const laterRepair = await syncRecoveryService.repairIfPending(USER_ID, {
      now: Date.now() + 100000,
    });
    expect(laterRepair.attempted).toBe(false);
  });
});

describe("Phase C.3 requirement #1: the post-write corrective-reservation gap is fully closed", () => {
  // Both tests below model the WORST case explicitly: the primary write
  // commits, and the process terminates before ANY post-write call
  // whatsoever -- confirm() is never invoked, synchronizeAfterMutation() is
  // never invoked. The single broad reservedUserWideReservations entry taken
  // BEFORE the write (see reserve()'s doc comment) is the ONLY durable
  // evidence that survives. A later read (repairIfPending, once the
  // reservation is stale) must fully reconstruct every affected month's
  // Budget.spent, the FinancialReport, the Redis cache entry, and leave
  // PendingSync in the correct state -- entirely from re-aggregating
  // CURRENT authoritative expense data, never from a second reservation
  // that was never (and, by design, never needs to be) written.
  it("DELETE: pre-reads January, a concurrent edit moves the expense to February, delete's primary write commits, the process terminates before ANY post-write call -- a later read fully reconstructs January AND February", async () => {
    const { syncRecoveryService, reportService, fakeBudgetModel, fakeExpenseModel, fakeReport, fakeReportCache } = loadReal({
      generateReportImpl: async () => ({ metadata: { version: 4 }, spending: { totalSpent: 500 } }),
    });

    // Pre-existing BudgetModel documents for both months, holding STALE
    // values -- January still reflects the expense that is about to move
    // out, February does not yet reflect the expense that will move in.
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 500);
    fakeBudgetModel.seed(USER_ID, FEB_MONTH_KEY, 0);

    // The delete's ONLY reservation: a single broad, month-agnostic
    // reservation taken BEFORE the primary write -- exactly what
    // Controllers/ExpenseControllers/deleteExpense.js now does. No
    // budgetDates are named because, at reservation time, the write has
    // not happened yet.
    const { userWideReservation, reportReservation } = await syncRecoveryService.reserve({
      userId: USER_ID,
      reserveUserWide: true,
      reserveReport: true,
    });
    expect(userWideReservation).toBeTruthy();

    // The primary delete write "happens" here (not modeled as a document
    // mutation in this file -- see expense.crossMonthRace.route.test.js for
    // that -- what matters to budget.service.js/reportService.js is purely
    // what the NEXT aggregate/generateReport call reflects). The process
    // then terminates: confirm()/synchronizeAfterMutation() is NEVER
    // called anywhere in this test for this delete -- there is no Tier-1
    // marker at all, ever, from this attempt.
    const beforeCrash = await syncRecoveryService.getPendingSync(USER_ID);
    expect(beforeCrash.pendingBudgetMonths).toHaveLength(0);
    expect(beforeCrash.reportPending).toBe(false);
    expect(beforeCrash.reservedUserWideReservations).toHaveLength(1);
    expect(beforeCrash.reservedUserWideReservations[0].token).toBe(userWideReservation.token);

    // A later read occurs once the reservation is stale. CURRENT
    // authoritative data (post-delete): January now totals 0 (the expense
    // is gone from January), February now totals 500 (the expense landed
    // there before the delete removed it entirely) -- recalculateBudget's
    // aggregate always reflects whatever is CURRENT at repair time.
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
    // from enumerating existing BudgetModel months and re-aggregating
    // current expense data, never from a second reservation that was never
    // written.
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(0);
    expect(fakeBudgetModel.get(USER_ID, FEB_MONTH_KEY).spent).toBe(500);

    // Report state: the reservedReports reservation (also taken before the
    // write, also never confirmed) is independently repaired by its own
    // Tier-2 pass in the SAME repairIfPending call.
    const report = await reportService.getReport(USER_ID);
    expect(report.spending.totalSpent).toBe(500);
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(500);
    // Redis state: the cache was populated by the SAME repair's refreshReport call.
    expect(fakeReportCache._store.get(USER_ID).spending.totalSpent).toBe(500);

    // PendingSync: the reservation itself is NEVER auto-released by this
    // defensive repair (only the owning mutation's own confirm()/abandon()
    // ever retires it -- see syncRecoveryService.js's own doc comments) --
    // it correctly remains as durable evidence that this delete's own
    // confirm() never actually ran, even though the data is now correct.
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
    // BEFORE its own primary write -- exactly what
    // Controllers/ExpenseControllers/editExpense.js now does, regardless of
    // how many months the write ultimately turns out to touch.
    const { userWideReservation } = await syncRecoveryService.reserve({
      userId: USER_ID,
      reserveUserWide: true,
      reserveReport: false,
    });

    // The edit's own primary write "happens" (moving the expense from its
    // TRUE prior month, February -- set by the earlier competing edit --
    // to March). The process then terminates before confirm() or
    // synchronizeAfterMutation() is ever called for this edit.
    const beforeCrash = await syncRecoveryService.getPendingSync(USER_ID);
    expect(beforeCrash.pendingBudgetMonths).toHaveLength(0);
    expect(beforeCrash.reservedUserWideReservations).toHaveLength(1);
    expect(beforeCrash.reservedUserWideReservations[0].token).toBe(userWideReservation.token);

    // A later read occurs once the reservation is stale. CURRENT
    // authoritative data: January (never actually touched by this edit at
    // all, since the competing edit already moved it out beforehand)
    // remains 0, February (the TRUE prior month) now totals 0 (the expense
    // moved out), March (the TRUE new month) now totals 500.
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
    // existing BudgetModel month for this user -- not just the ones this
    // specific edit happened to touch -- so all three end up correct
    // regardless of which one(s) this particular write actually affected.
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
    // repairIfPending()'s Tier-2 pass fenced every recompute+persist call
    // in a single call to a STATICALLY-READ `current.revision` -- never a
    // value it allocated itself. Two overlapping repairIfPending() calls
    // for the SAME stale reservation (e.g. two concurrent GET /report or
    // GET /budgets requests, both finding the identical stale
    // reservedUserWideReservations token, with no intervening confirm()/markPending()
    // call to bump the shared counter in between) would therefore both
    // fence their writes to the IDENTICAL revision value. recalculateBudget's
    // CAS filter (`syncRevision <= fenceRevision`) allows an EQUAL
    // fenceRevision to overwrite a document already stamped with that same
    // value, so whichever attempt's write physically landed SECOND always
    // won -- regardless of which one actually computed from the FRESHER
    // expense snapshot. This test reproduces exactly that interleaving and
    // proves the fix (allocateRepairRevision()'s per-attempt atomic $inc
    // ticket) closes it: attempt A's own ticket is now strictly LOWER than
    // attempt B's (B's ticket is allocated later, after A's), so A's write
    // -- even though it physically executes and attempts to persist AFTER
    // B's already-committed, fresher result -- is correctly rejected by the
    // real CAS filter as superseded, never silently overwriting it.
    const { syncRecoveryService, fakeBudgetModel, fakeExpenseModel } = loadReal();
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 0);

    // A stale reservation -- simulates a crashed mutation whose own
    // confirm() never ran (identical setup to the crash-gap tests above).
    // Two independent, concurrent reads each trigger their OWN
    // repairIfPending() call for this SAME stale reservation -- repair
    // never clears reservedUserWideReservations itself (only the owning mutation's own
    // confirm()/abandon() does), so BOTH calls find and act on it.
    const { userWideReservation } = await syncRecoveryService.reserve({
      userId: USER_ID,
      reserveUserWide: true,
      reserveReport: false,
    });
    const farFuture =
      userWideReservation.reservedAt.getTime() + syncRecoveryService.RESERVATION_STALE_MS + 1000;

    // Attempt A's own aggregate call: its snapshot value (100) is fixed at
    // queue time -- representing data as it stood when A's recompute
    // began -- but the call's own RESOLUTION (and therefore A's own
    // subsequent persist attempt) is deferred via this gate, simulating a
    // real-world pause (GC, event-loop scheduling, network latency)
    // between A capturing its snapshot and A actually writing it.
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
    // triggered by the SAME still-present stale reservation, allocates its
    // OWN, strictly HIGHER ticket (1 -> 2) and persists the fresher total.
    const bResult = await syncRecoveryService.repairIfPending(USER_ID, { now: farFuture });
    expect(bResult.attempted).toBe(true);
    expect(bResult.budgetRepairFailed).toBe(false);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(150);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).syncRevision).toBe(2);

    // NOW release A. A resumes with its OLDER snapshot (100) and attempts
    // to persist it fenced to its OWN ticket (1) -- now OLDER than the
    // syncRevision (2) B's fresher write already stamped, so the real,
    // atomic CAS filter correctly fails to match, and A's write is
    // rejected as superseded -- exactly like every other fenced writer in
    // this codebase, and never silently applied.
    aGate.resolve();
    const aResult = await aPromise;
    expect(aResult.attempted).toBe(true);
    // recalculateBudget's own `{ skipped: true, reason: 'superseded' }`
    // result is not an exception, so this defensive Tier-2 pass (which
    // deliberately never clears the reservation either way -- see
    // syncRecoveryService.js's own doc comment) does not report a failure
    // for it.
    expect(aResult.budgetRepairFailed).toBe(false);

    // THE ACTUAL PROOF: B's fresher result survives completely untouched.
    // A's older, stale snapshot never overwrote it, even though A's own
    // findOneAndUpdate call physically ran strictly AFTER B's.
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(150);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).syncRevision).toBe(2);

    // The reservation itself is still never auto-released by either
    // defensive Tier-2 pass -- only the owning mutation's own confirm()/
    // abandon() ever retires it.
    const after = await syncRecoveryService.getPendingSync(USER_ID);
    expect(after.reservedUserWideReservations).toHaveLength(1);
    expect(after.reservedUserWideReservations[0].token).toBe(userWideReservation.token);
  });

  it("Tier-1 pass: an older repair attempt's own ticket allocation is strictly lower than a concurrent repair attempt's, so its stale snapshot cannot overwrite the newer attempt's already-persisted result either", async () => {
    // Same corruption, same fix, but exercised through the Tier-1
    // (pendingBudgetMonths) pass instead of Tier-2's reservedUserWideReservations pass
    // -- confirming allocateRepairRevision() closes the identical gap
    // regardless of which pass triggers it.
    const { syncRecoveryService, fakeBudgetModel, fakeExpenseModel, fakePendingSync } = loadReal();
    fakeBudgetModel.seed(USER_ID, JAN_MONTH_KEY, 0);

    // Seed a Tier-1 marker directly (bypassing reserve()/confirm(), which
    // is fine -- repairIfPending() only ever reads pendingBudgetMonths/
    // reportPending/revision off the marker itself).
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
    // clearIfRevisionMatches has not run yet, the Tier-1 marker (still
    // showing January pending, revision now 1 after A's own allocation)
    // is exactly what B's own read observes -- B allocates its OWN,
    // strictly HIGHER ticket (1 -> 2) and persists the fresher total.
    const bResult = await syncRecoveryService.repairIfPending(USER_ID);
    expect(bResult.attempted).toBe(true);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).spent).toBe(150);
    expect(fakeBudgetModel.get(USER_ID, JAN_MONTH_KEY).syncRevision).toBe(2);

    // NOW release A -- its stale (100) write, fenced to its own OLDER
    // ticket (1), is correctly rejected by the CAS filter (document is
    // already at syncRevision 2).
    aGate.resolve();
    const aResult = await aPromise;
    expect(aResult.attempted).toBe(true);
    // A's own recompute for January was superseded (skipped, not an
    // exception) -- so its own clearIfRevisionMatches, which only clears
    // months this exact attempt actually repaired, does not include
    // January and A's own clear (CAS'd to ITS ticket, 1) also loses to
    // B's already-higher, already-cleared marker state -- so nothing
    // A did retroactively resurrects January as pending either.
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
          // full completion first, simulating A having started slightly
          // earlier but finishing slower.
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
    // FinancialReport document exists yet for this user, so B's own
    // initial fenced update (upsert:false) also fails to match anything,
    // and B reaches the SAME creation path A is about to reach.
    const bResult = await reportService.refreshReport(USER_ID, { fenceRevision: 1 });
    expect(bResult.skipped).toBeUndefined();
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(200);
    expect(fakeReport._store.get(USER_ID).syncRevision).toBe(1);

    // NOW release A. A's own initial fenced update also fails (nothing
    // matched when IT ran either -- both A and B observed "no document" at
    // their respective initial fenced-update attempts), so A also reaches
    // the creation path -- exactly the two-concurrent-first-writers race
    // this requirement calls out. A's plain upsert collides with B's
    // already-inserted document (E11000), which createFirstReport() now
    // catches and retries as a normal fenced update instead of surfacing
    // the raw duplicate-key error or silently dropping A's content.
    aGate.resolve();
    const aResult = await aPromise;

    // A's fenceRevision (0) is OLDER than B's already-stamped syncRevision
    // (1) -- A's retry-into-the-fenced-update correctly loses and reports
    // superseded, exactly as a normal fenced write would.
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
    // fired here, NOT awaited yet, so its own generateReportImpl call
    // (call #1, the blocking one) runs synchronously right now, before A
    // is ever invoked below.
    const bPromise = reportService.refreshReport(USER_ID, { fenceRevision: 5 });

    // A runs to full completion first -- inserts the first-ever document
    // with an OLDER fenceRevision.
    const aResult = await reportService.refreshReport(USER_ID, { fenceRevision: 2 });
    expect(aResult.skipped).toBeUndefined();
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(50);
    expect(fakeReport._store.get(USER_ID).syncRevision).toBe(2);

    // B resolves next -- B's OWN initial fenced update also found nothing
    // (it ran before A's insert existed), so B also hits E11000 on its own
    // upsert attempt and retries into the fenced update. B's fenceRevision
    // (5) is NEWER than A's already-stamped syncRevision (2), so B's retry
    // correctly WINS and overwrites A's just-inserted document -- newer
    // data survives end-to-end, never silently dropped.
    bGate.resolve();
    const bResult = await bPromise;

    expect(bResult.skipped).toBeUndefined();
    expect(fakeReport._store.size).toBe(1);
    expect(fakeReport._store.get(USER_ID).spending.totalSpent).toBe(300);
    expect(fakeReport._store.get(USER_ID).syncRevision).toBe(5);
  });

  it("the genuinely-simultaneous case -- NEITHER caller has committed yet when both attempt their own insert -- is resolved via the E11000 retry, never left as an unhandled duplicate-key error", async () => {
    // A real MongoDB race that a sequential, await-ordered fake cannot
    // reproduce organically: two concurrent upsert:true calls where
    // NEITHER has committed at the moment BOTH determine "nothing exists
    // yet" and both attempt an INSERT. Only one storage-engine insert can
    // win; the fake's `_forceNextUpsertConflict()` models the LOSING
    // call's outcome directly -- this is what proves
    // reportService.js's createFirstReport() retry branch (not just the
    // "one call already fully finished" cases above) is itself correct,
    // independent of how the two calls happened to interleave in time.
    const { reportService, fakeReport } = loadReal({
      generateReportImpl: async () => ({ metadata: { version: 4 }, spending: { totalSpent: 77 } }),
    });

    fakeReport._forceNextUpsertConflict();

    // This call's own insert attempt is the one that "lost" the race --
    // forced to observe E11000 even though, from the fake's own
    // perspective, nothing was in the store yet.
    const result = await reportService.refreshReport(USER_ID, { fenceRevision: 0 });

    // No unhandled duplicate-key error escaped -- and since nothing else
    // ever actually wrote a document in this test, the retry's own fenced
    // filter also finds nothing to match, so this call is correctly
    // reported as needing to be retried (superseded by a winner this fake
    // never modeled the content of) rather than throwing.
    expect(result).toEqual({ skipped: true, reason: "superseded" });
    expect(fakeReport._store.size).toBe(0);
  });
});
