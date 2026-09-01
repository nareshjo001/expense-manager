// Remediation Workstream D (3rd follow-up) -- proves the ACTUAL, real
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
  jest.useFakeTimers().setSystemTime(new Date("2026-08-15T12:00:00.000Z"));
});

function occurrenceIdFor(recurringId, nextDueDate) {
  return crypto.createHash("sha256").update(`${recurringId}:${nextDueDate.toISOString()}`).digest("hex");
}

// Adapted verbatim (same update semantics) from
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
    await harness.runCronCallback(); // Run 2

    // 4. duplicate occurrence detected -- still exactly one expense document.
    expect(harness.expenseModel._docs.size).toBe(1);
    expect(harness.expenseModel.create).toHaveBeenCalledTimes(2);

    // 5/8/9/10. Report reconciliation completed for real: confirm()
    expect(harness.refreshReportMock).toHaveBeenCalledTimes(1);
    expect(harness.recalculateBudgetMock).toHaveBeenCalledTimes(1);

    const finalDoc = harness.pendingSyncModel._store.get(USER_ID);
    expect(finalDoc.reportPending).toBe(false); // pending cleared -- report is current.
    // R2's OWN token was released by confirm() (a $pull naming exactly its
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
