// Remediation Workstream D (3rd follow-up) -- proves the ACTUAL, real
// reservation-ownership semantics behind the recurring cron's crash-gap
// recovery, against the REAL Services/syncRecoveryService.js and a
// real-CAS-semantics fake models/PendingSync (not a fully mocked service).
//
// tests/recurringJob.crashGapRecovery.test.js mocks syncRecoveryService.js
// itself, so its assertions ("abandon() was called with these arguments")
// only prove cron/recurringJob.js CALLS the right functions -- they cannot
// prove the underlying PendingSync document actually survives a crash, or
// that a later reserve() call does not silently destroy an earlier one's
// evidence. This file closes that gap: syncRecoveryService.js is required
// UNMODIFIED, and models/PendingSync is replaced with a small in-memory
// store that applies the exact same $set/$push/$pull/$inc/upsert semantics
// real MongoDB would (adapted from tests/mutationRecoveryCorrectness.
// test.js's own makeFakePendingSyncModel(), the established pattern for
// this exact kind of proof in this codebase).
//
// The core question (as of the system-wide reservation-ownership
// correction): reservedReports/reservedUserWideReservations are now OWNED-
// TOKEN ARRAYS on PendingSync (see models/PendingSync.js), structured
// identically to reservedBudgetMonths -- every reserve() call pushes its
// own entry, and confirm()/abandon() only ever pull the exact token they
// own. Before that correction, these were SINGLE objects, and a second
// reserve() call's $set silently overwrote an earlier, still-unconfirmed
// reservation's token in the same field; the original recurring-cron design
// additionally called abandon() on that (already-overwritten) field after
// an E11000 replay, which could delete the only evidence of a still-
// outstanding sync with nothing durable substituted. cron/recurringJob.js
// no longer calls abandon() on this path at all -- it drives one real
// reconciliation via synchronizeAfterMutation() instead, using its OWN
// reservation token. This file proves that correction against real
// document state, not mocked call assertions, AND proves it remains
// correct now that reservations are arrays: an earlier crashed run's own
// orphaned reservation entry is no longer even at risk of being destroyed
// by a later run -- it simply persists as a separate, independently-owned
// array entry until it ages out and is defensively (harmlessly) recomputed
// by a future repairIfPending() call, exactly like any other orphaned
// Tier-2 entry in this codebase.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PENDING_SYNC_PATH = "../models/PendingSync";
const SCHEMAS_PATH = "../config/Schemas";
const BUDGET_SERVICE_PATH = "../Services/BudgetServices/budget.service";
const REPORT_SERVICE_PATH = "../Services/reportService";
const RECURRING_EXPENSE_PATH = "../models/RecurringExpense";
const NOTIFICATION_PATH = "../models/Notification";
const PUSH_SERVICE_PATH = "../Services/push.service";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const CRON_JOB_PATH = "../cron/recurringJob";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

afterEach(() => {
  jest.useRealTimers();
  jest.resetModules();
  jest.restoreAllMocks();
});

beforeEach(() => {
  // The fixture is due in August and should advance to September. Pin the
  // cron clock inside that month so this ownership test remains valid after
  // the real calendar reaches September.
  jest.useFakeTimers().setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
});

function occurrenceIdFor(recurringId, nextDueDate) {
  return crypto.createHash("sha256").update(`${recurringId}:${nextDueDate.toISOString()}`).digest("hex");
}

// Adapted verbatim (same update semantics) from
// tests/mutationRecoveryCorrectness.test.js's makeFakePendingSyncModel() --
// real CAS on `revision`, real $inc/$set/$addToSet/$push/$pull application,
// real upsert. `_store` is exposed for direct, unmediated introspection of
// durable state between simulated cron runs (a real crash's only surviving
// evidence would be exactly this document, unmediated by any mock).
function makeFakePendingSyncModel() {
  const store = new Map();

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

  const ISO_DATE_STRING = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  function clone(doc) {
    return doc
      ? JSON.parse(JSON.stringify(doc), (key, value) => {
          if (key === "month" || key === "reservedAt" || key === "lastAttemptAt") {
            return value === null ? null : new Date(value);
          }
          if (typeof value === "string" && ISO_DATE_STRING.test(value)) {
            return new Date(value);
          }
          return value;
        })
      : null;
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

  return {
    _store: store,
    findOne: jest.fn((filter) => ({
      lean: async () => {
        const doc = store.get(String(filter.user));
        if (!doc) return null;
        if (filter.revision !== undefined && doc.revision !== filter.revision) return null;
        return clone(doc);
      },
    })),
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

// Fake ExpenseModel -- real uniqueness enforcement on { userId, id } (the
// same field the real expenseSchema.index({userId:1,id:1},{unique:true})
// protects), so a second create() for the SAME occurrenceId genuinely
// throws a real-shaped E11000 error rather than a scripted one-off.
function makeFakeExpenseModel() {
  const docs = new Map(); // `${userId}:${id}` -> doc
  return {
    _docs: docs,
    create: jest.fn(async (doc) => {
      const key = `${doc.userId}:${doc.id}`;
      if (docs.has(key)) {
        const err = new Error("E11000 duplicate key error collection: expenses index: userId_1_id_1");
        err.code = 11000;
        throw err;
      }
      const stored = { ...doc, _id: `expense-${docs.size + 1}` };
      docs.set(key, stored);
      return stored;
    }),
    findOne: jest.fn((filter) => ({
      lean: async () => {
        const key = `${filter.userId}:${filter.id}`;
        return docs.get(key) || null;
      },
    })),
  };
}

// Fake RecurringExpenseModel -- real mutable state (not just a call-count
// mock), so "the schedule advances exactly once" can be verified against
// the ACTUAL stored nextDueDate before/after each simulated run, and so a
// later run's own `find({ nextDueDate: { $lte: now } })` genuinely stops
// matching a recurring definition once it has actually been advanced --
// exactly like the real due-date query would.
function makeFakeRecurringExpenseModel(initial) {
  const doc = { ...initial };
  return {
    _doc: doc,
    find: jest.fn((filter) => ({
      lean: async () => {
        const now = filter.nextDueDate.$lte;
        return doc.nextDueDate.getTime() <= now.getTime() ? [{ ...doc }] : [];
      },
    })),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      if (doc._id !== filter._id) return null;
      if (filter.nextDueDate.getTime() !== doc.nextDueDate.getTime()) return null; // CAS miss
      Object.assign(doc, update.$set);
      return { ...doc };
    }),
  };
}

function loadRealCronJob({ recurringInitial, recalculateBudgetImpl, refreshReportImpl } = {}) {
  jest.resetModules();

  let capturedCallback = null;
  jest.doMock("node-cron", () => ({
    schedule: jest.fn((_expr, callback) => {
      capturedCallback = callback;
    }),
  }));

  const pendingSyncModel = makeFakePendingSyncModel();
  jest.doMock(PENDING_SYNC_PATH, () => pendingSyncModel);

  const expenseModel = makeFakeExpenseModel();
  const budgetModelStub = { find: jest.fn(() => ({ select: () => ({ lean: async () => [] }) })) };
  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel: expenseModel, BudgetModel: budgetModelStub }));

  const recurringExpenseModel = makeFakeRecurringExpenseModel(recurringInitial);
  jest.doMock(RECURRING_EXPENSE_PATH, () => ({ RecurringExpenseModel: recurringExpenseModel }));

  const notificationCreateMock = jest.fn().mockResolvedValue({ _id: "notif-1", title: "t" });
  const notificationUpdateOneMock = jest.fn().mockResolvedValue({});
  jest.doMock(NOTIFICATION_PATH, () => ({
    create: notificationCreateMock,
    updateOne: notificationUpdateOneMock,
  }));

  const sendPushMock = jest.fn().mockResolvedValue({ success: true });
  jest.doMock(PUSH_SERVICE_PATH, () => ({ sendPush: sendPushMock }));

  const clearUserExpenseCacheMock = jest.fn().mockResolvedValue(undefined);
  jest.doMock(EXPENSE_CACHE_PATH, () => ({ clearUserExpenseCache: clearUserExpenseCacheMock }));

  // Real syncRecoveryService.js, real budget.service.js's getMonthAnchor/
  // getMonthAnchorFromKey (via jest.requireActual, exactly like
  // tests/syncRecoveryService.test.js's own established pattern) -- only
  // recalculateBudget/refreshReport themselves are replaced, since THEIR
  // internal correctness is proven elsewhere and is not what this file is
  // testing.
  const recalculateBudgetMock = jest.fn(recalculateBudgetImpl || (async () => ({ skipped: false })));
  jest.doMock(BUDGET_SERVICE_PATH, () => {
    const actual = jest.requireActual(BUDGET_SERVICE_PATH);
    return { ...actual, recalculateBudget: recalculateBudgetMock };
  });

  const refreshReportMock = jest.fn(refreshReportImpl || (async () => ({ skipped: false })));
  jest.doMock(REPORT_SERVICE_PATH, () => ({
    refreshReport: refreshReportMock,
    getReport: jest.fn(),
  }));

  require(CRON_JOB_PATH);

  return {
    runCronCallback: async () => capturedCallback(),
    pendingSyncModel,
    expenseModel,
    recurringExpenseModel,
    recalculateBudgetMock,
    refreshReportMock,
    notificationCreateMock,
    sendPushMock,
  };
}

function dueRecurring(overrides = {}) {
  return {
    _id: "recurring-ownership-1",
    userId: USER_ID,
    expenseName: "Netflix",
    expenseAmount: 500,
    expenseCategory: "Entertainment",
    nextDueDate: new Date("2026-08-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("Remediation Workstream D (3rd follow-up): real reservation ownership semantics", () => {
  it("full 12-step sequence: R1 reserves+inserts+crashes, R2 reserves+detects duplicate+reconciles, one expense, one advance, report current", async () => {
    const recurring = dueRecurring();
    const occurrenceId = occurrenceIdFor(recurring._id, recurring.nextDueDate);

    // --- Run 1: reserve R1, insert succeeds, then CRASH before schedule
    // advancement / synchronization. Simulated by making the schedule-
    // advance call throw on its first invocation -- the very next
    // statement after a successful insert in cron/recurringJob.js, so this
    // reproduces "insert committed, then the process died" precisely.
    const harness = loadRealCronJob({ recurringInitial: recurring });
    harness.recurringExpenseModel.findOneAndUpdate.mockImplementationOnce(() => {
      throw new Error("simulated process crash before schedule advancement");
    });

    await harness.runCronCallback(); // Run 1

    // 1-2. reserve R1 + insert succeeded.
    expect(harness.expenseModel._docs.size).toBe(1);
    const r1Doc = harness.pendingSyncModel._store.get(USER_ID);
    expect(r1Doc).toBeTruthy();
    expect(r1Doc.reservedReports).toHaveLength(1);
    const r1ReportToken = r1Doc.reservedReports[0].token;
    expect(r1ReportToken).toBeTruthy(); // R1's durable Tier-2 evidence exists.
    expect(r1Doc.reportPending).toBe(false); // 3. no synchronization occurred.
    expect(harness.refreshReportMock).not.toHaveBeenCalled();
    // Schedule was NOT advanced -- Run 1 crashed first.
    expect(harness.recurringExpenseModel._doc.nextDueDate.getTime()).toBe(recurring.nextDueDate.getTime());

    // --- Run 2: the next cron tick rediscovers the SAME due recurring
    // definition (nextDueDate untouched). reserve() is called again for
    // real -- under the system-wide reservation-ownership correction this
    // PUSHES a second, independently-owned array entry rather than
    // overwriting R1's.
    await harness.runCronCallback(); // Run 2

    // 4. duplicate occurrence detected -- still exactly one expense document.
    expect(harness.expenseModel._docs.size).toBe(1);
    expect(harness.expenseModel.create).toHaveBeenCalledTimes(2);

    // 5/8/9/10. Report reconciliation completed for real: confirm()
    // (called by synchronizeAfterMutation on the replay path, using R2's
    // OWN token) durably wrote reportPending:true BEFORE refreshReport
    // ran, and clearIfRevisionMatches cleared it back to false only AFTER
    // refreshReport resolved successfully -- both are real writes against
    // the real fake PendingSync store, not scripted mock returns.
    expect(harness.refreshReportMock).toHaveBeenCalledTimes(1);
    expect(harness.recalculateBudgetMock).toHaveBeenCalledTimes(1);

    const finalDoc = harness.pendingSyncModel._store.get(USER_ID);
    expect(finalDoc.reportPending).toBe(false); // pending cleared -- report is current.
    // R2's OWN token was released by confirm() (a $pull naming exactly its
    // token) -- R1's entry, from the crashed run that never confirmed or
    // abandoned it, is a SEPARATE array element and is therefore untouched
    // by that $pull. This is the system-wide fix's key improvement over the
    // old single-slot design: R1's evidence is never even at risk of being
    // silently destroyed by R2's activity -- it simply persists as its own
    // orphaned entry until it ages past RESERVATION_STALE_MS, at which
    // point a future repairIfPending() call (e.g. from any ordinary
    // getReport()/getbudgets.js read) treats it as stale and performs one
    // more harmless, idempotent recompute -- the report is already correct
    // by then, so that recompute is a no-op in effect, never incorrect.
    expect(finalDoc.reservedReports).toHaveLength(1);
    expect(finalDoc.reservedReports[0].token).toBe(r1ReportToken);
    expect(finalDoc.pendingBudgetMonths).toHaveLength(0);

    // 11. schedule advanced exactly once, to next month.
    expect(harness.recurringExpenseModel.findOneAndUpdate).toHaveBeenCalledTimes(2); // 1 throw (Run1) + 1 success (Run2)
    const expectedNextDue = new Date(Date.UTC(2026, 8, 1, 0, 0, 0)); // Sept 1, 2026
    expect(harness.recurringExpenseModel._doc.nextDueDate.getTime()).toBe(expectedNextDue.getTime());

    // 6. no duplicate notification/push on the replay.
    expect(harness.notificationCreateMock).not.toHaveBeenCalled();
    expect(harness.sendPushMock).not.toHaveBeenCalled();

    // The occurrence itself, from Run 1, is untouched/uncorrupted.
    const storedExpense = harness.expenseModel._docs.get(`${USER_ID}:${occurrenceId}`);
    expect(storedExpense).toBeTruthy();
  });

  it("if the replay's own reconciliation fails, the Tier-1 pending marker remains set and durable (retryable), never silently cleared", async () => {
    const recurring = dueRecurring();

    const harness = loadRealCronJob({
      recurringInitial: recurring,
      refreshReportImpl: async () => {
        throw new Error("simulated transient refreshReport failure");
      },
    });
    harness.recurringExpenseModel.findOneAndUpdate.mockImplementationOnce(() => {
      throw new Error("simulated process crash before schedule advancement");
    });

    await harness.runCronCallback(); // Run 1: insert + crash before sync.
    await expect(harness.runCronCallback()).resolves.not.toThrow(); // Run 2: replay, reconciliation fails.

    const finalDoc = harness.pendingSyncModel._store.get(USER_ID);
    // confirm() already wrote reportPending:true durably BEFORE the failed
    // refreshReport call; clearIfRevisionMatches is never reached for the
    // report on a failure path (see synchronizeAfterMutation's own
    // reportStatus="pending" branch), so this marker survives -- a later
    // read (next cron tick, or any getReport()/getbudgets.js call) retries
    // it. This is the exact "if repair fails, pending state remains
    // retryable" invariant.
    expect(finalDoc.reportPending).toBe(true);
    expect(harness.expenseModel._docs.size).toBe(1); // still no duplicate.
  });

  it("a fully-synchronized replay's own occurrence is never re-selected by a later tick -- no repeated revisions once genuinely complete", async () => {
    const recurring = dueRecurring();

    const harness = loadRealCronJob({ recurringInitial: recurring });
    harness.recurringExpenseModel.findOneAndUpdate.mockImplementationOnce(() => {
      throw new Error("simulated process crash before schedule advancement");
    });

    await harness.runCronCallback(); // Run 1: insert + crash.
    await harness.runCronCallback(); // Run 2: replay + full reconciliation + schedule advances.

    const revisionAfterRun2 = harness.pendingSyncModel._store.get(USER_ID).revision;
    const createCallsAfterRun2 = harness.expenseModel.create.mock.calls.length;

    // Run 3: nextDueDate is now next month -- the real due-date query
    // (`nextDueDate <= now`) implemented in the fake's find() must no
    // longer match this recurring definition, exactly like the real query
    // wouldn't. No further reserve/create/recompute activity for this user.
    await harness.runCronCallback(); // Run 3

    expect(harness.expenseModel.create.mock.calls.length).toBe(createCallsAfterRun2);
    expect(harness.pendingSyncModel._store.get(USER_ID).revision).toBe(revisionAfterRun2);
  });

  it("no Mongo transaction or in-memory lock is used anywhere in the recurring crash-gap recovery path", () => {
    const cronSource = fs.readFileSync(
      path.join(__dirname, "..", "cron", "recurringJob.js"),
      "utf8"
    );
    const serviceSource = fs.readFileSync(
      path.join(__dirname, "..", "Services", "syncRecoveryService.js"),
      "utf8"
    );
    const forbidden = [
      "startSession",
      "startTransaction",
      "withTransaction",
      "new Mutex",
      "require('async-mutex')",
      'require("async-mutex")',
    ];
    for (const token of forbidden) {
      expect(cronSource.includes(token)).toBe(false);
      expect(serviceSource.includes(token)).toBe(false);
    }
  });
});
