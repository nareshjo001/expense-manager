// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
"use strict";

const PENDING_SYNC_MODEL_PATH = "../models/PendingSync";
const BUDGET_SERVICE_PATH = "../Services/BudgetServices/budget.service";
const REPORT_SERVICE_PATH = "../Services/reportService";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadService({
  findOneImpl,
  findOneAndUpdateImpl,
  updateOneImpl,
  recalculateBudgetImpl,
  refreshReportImpl,
} = {}) {
  jest.resetModules();

  const findOneMock = jest.fn(
    findOneImpl || (() => ({ lean: jest.fn().mockResolvedValue(null) }))
  );
  // Phase C.4 -- repairIfPending()'s Tier-1/Tier-2 passes now call
  const findOneAndUpdateMock = jest.fn(findOneAndUpdateImpl || (async () => ({ revision: 1 })));
  const updateOneMock = jest.fn(updateOneImpl || (async () => ({})));

  jest.doMock(PENDING_SYNC_MODEL_PATH, () => ({
    findOne: findOneMock,
    findOneAndUpdate: findOneAndUpdateMock,
    updateOne: updateOneMock,
  }));

  const recalculateBudgetMock = jest.fn(recalculateBudgetImpl || (async () => {}));
  jest.doMock(BUDGET_SERVICE_PATH, () => {
    const actual = jest.requireActual(BUDGET_SERVICE_PATH);
    return {
      ...actual,
      recalculateBudget: recalculateBudgetMock,
    };
  });

  const refreshReportMock = jest.fn(refreshReportImpl || (async () => {}));
  jest.doMock(REPORT_SERVICE_PATH, () => ({
    refreshReport: refreshReportMock,
    getReport: jest.fn(),
  }));

  const syncRecoveryService = require(SYNC_RECOVERY_SERVICE_PATH);
  return {
    syncRecoveryService,
    findOneMock,
    findOneAndUpdateMock,
    updateOneMock,
    recalculateBudgetMock,
    refreshReportMock,
  };
}

// A small stateful PendingSync fake, adapted from the proven pattern in
function makeStatefulPendingSyncModel(seedDoc) {
  let doc = seedDoc ? { ...seedDoc } : null;

  const ISO_DATE_STRING = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  function clone(source) {
    return source
      ? JSON.parse(JSON.stringify(source), (key, value) => {
          if (key === "month" || key === "reservedAt" || key === "lastAttemptAt") {
            return value === null ? null : new Date(value);
          }
          if (typeof value === "string" && ISO_DATE_STRING.test(value)) return new Date(value);
          return value;
        })
      : null;
  }

  function applyUpdate(base, update) {
    const next = { ...base };
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) next[k] = (next[k] || 0) + v;
    }
    if (update.$max) {
      for (const [k, v] of Object.entries(update.$max)) {
        if (next[k] === undefined || next[k] < v) next[k] = v;
      }
    }
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) next[k] = v;
    }
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) delete next[k];
    }
    if (update.$addToSet) {
      for (const [k, v] of Object.entries(update.$addToSet)) {
        const values = v && v.$each ? v.$each : [v];
        next[k] = next[k] || [];
        for (const val of values) {
          const exists = next[k].some((existing) => new Date(existing).getTime() === new Date(val).getTime());
          if (!exists) next[k].push(val);
        }
      }
    }
    if (update.$push) {
      for (const [k, v] of Object.entries(update.$push)) {
        const values = v && v.$each ? v.$each : [v];
        next[k] = next[k] || [];
        next[k].push(...values);
      }
    }
    if (update.$pull) {
      for (const [k, v] of Object.entries(update.$pull)) {
        if (v && v.$in) {
          next[k] = (next[k] || []).filter(
            (existing) => !v.$in.some((target) => new Date(target).getTime() === new Date(existing).getTime())
          );
        } else if (v && v.token && v.token.$in) {
          next[k] = (next[k] || []).filter((existing) => !v.token.$in.includes(existing.token));
        } else if (v && v.token) {
          next[k] = (next[k] || []).filter((existing) => existing.token !== v.token);
        }
      }
    }
    return next;
  }

  // Generic dot-path CAS/equality filter match (e.g. `revision: 6` or
  function matchesFilter(candidate, filter) {
    if (!candidate) return false;
    for (const [key, value] of Object.entries(filter)) {
      if (key === "user") continue;
      let actual = candidate;
      for (const part of key.split(".")) {
        actual = actual == null ? undefined : actual[part];
      }
      if (actual instanceof Date || value instanceof Date) {
        if (new Date(actual).getTime() !== new Date(value).getTime()) return false;
      } else if (actual !== value) {
        return false;
      }
    }
    return true;
  }

  const findOneAndUpdateMock = jest.fn(async (filter, update, options = {}) => {
    if (!doc) {
      if (!options.upsert) return null;
      doc = { user: filter.user, revision: 0 };
    }
    if (!matchesFilter(doc, filter)) return null;
    doc = applyUpdate(doc, update);
    return clone(doc);
  });

  const findOneMock = jest.fn(() => ({
    lean: async () => clone(doc),
  }));

  // updateOne bookkeeping calls in production always target lastError/
  // lastAttemptAt -- apply them for realism, same as findOneAndUpdate.
  const updateOneMock = jest.fn(async (filter, update) => {
    void filter;
    if (!doc) return { matchedCount: 0 };
    doc = applyUpdate(doc, update);
    return { matchedCount: 1 };
  });

  return {
    findOneMock,
    findOneAndUpdateMock,
    updateOneMock,
    getDoc: () => clone(doc),
  };
}

function loadServiceStateful(seedDoc, { recalculateBudgetImpl, refreshReportImpl } = {}) {
  jest.resetModules();

  const fake = makeStatefulPendingSyncModel(seedDoc);
  jest.doMock(PENDING_SYNC_MODEL_PATH, () => ({
    findOne: fake.findOneMock,
    findOneAndUpdate: fake.findOneAndUpdateMock,
    updateOne: fake.updateOneMock,
  }));

  const recalculateBudgetMock = jest.fn(recalculateBudgetImpl || (async () => ({})));
  jest.doMock(BUDGET_SERVICE_PATH, () => {
    const actual = jest.requireActual(BUDGET_SERVICE_PATH);
    return { ...actual, recalculateBudget: recalculateBudgetMock };
  });

  const refreshReportMock = jest.fn(refreshReportImpl || (async () => ({})));
  jest.doMock(REPORT_SERVICE_PATH, () => ({ refreshReport: refreshReportMock, getReport: jest.fn() }));

  const syncRecoveryService = require(SYNC_RECOVERY_SERVICE_PATH);
  return {
    syncRecoveryService,
    findOneMock: fake.findOneMock,
    findOneAndUpdateMock: fake.findOneAndUpdateMock,
    updateOneMock: fake.updateOneMock,
    recalculateBudgetMock,
    refreshReportMock,
    getDoc: fake.getDoc,
  };
}

const USER_ID = "sync-recovery-user";
const JAN_2026 = new Date("2026-01-15T00:00:00.000Z");
const FEB_2026 = new Date("2026-02-03T00:00:00.000Z");
// Real production code only ever stores ANCHORED (first-of-month) values in
const { getMonthAnchor: __getMonthAnchorForSeeding } = require(BUDGET_SERVICE_PATH);
const JAN_2026_ANCHOR = __getMonthAnchorForSeeding(JAN_2026);
const FEB_2026_ANCHOR = __getMonthAnchorForSeeding(FEB_2026);

describe("markPending", () => {
  it("is a defensive no-op that never creates an empty marker when nothing failed", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService();

    const result = await syncRecoveryService.markPending({ userId: USER_ID });

    expect(result).toBeNull();
    expect(findOneAndUpdateMock).not.toHaveBeenCalled();
  });

  it("upserts a new marker with an atomic $inc revision, $addToSet budget months, and sanitized error", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService();

    await syncRecoveryService.markPending({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      reportPending: true,
      error: new Error("simulated recalculateBudget failure"),
    });

    expect(findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    const [filter, update, options] = findOneAndUpdateMock.mock.calls[0];
    expect(filter).toEqual({ user: USER_ID });
    expect(update.$inc).toEqual({ revision: 1 });
    expect(update.$addToSet.pendingBudgetMonths.$each).toHaveLength(1);
    expect(update.$set.reportPending).toBe(true);
    expect(update.$set.lastError).toBe("simulated recalculateBudget failure");
    expect(options).toEqual({ upsert: true, new: true, setDefaultsOnInsert: true });
  });

  it("de-duplicates multiple dates within the same month down to a single anchor", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService();

    const sameMonthLater = new Date("2026-01-28T00:00:00.000Z");
    await syncRecoveryService.markPending({
      userId: USER_ID,
      budgetDates: [JAN_2026, sameMonthLater],
    });

    const [, update] = findOneAndUpdateMock.mock.calls[0];
    expect(update.$addToSet.pendingBudgetMonths.$each).toHaveLength(1);
  });

  it("never sets reportPending:false -- only clearIfRevisionMatches clears it", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService();

    await syncRecoveryService.markPending({ userId: USER_ID, budgetDates: [JAN_2026] });

    const [, update] = findOneAndUpdateMock.mock.calls[0];
    expect(update.$set).not.toHaveProperty("reportPending");
  });
});

describe("getPendingSync", () => {
  it("returns null via a plain lean lookup when the user has no marker", async () => {
    const { syncRecoveryService, findOneMock } = loadService();

    const result = await syncRecoveryService.getPendingSync(USER_ID);

    expect(result).toBeNull();
    expect(findOneMock).toHaveBeenCalledWith({ user: USER_ID });
  });
});

describe("clearIfRevisionMatches", () => {
  it("pulls only the specified repaired months and clears reportPending when the revision still matches", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService({
      findOneAndUpdateImpl: async () => ({ revision: 3, pendingBudgetMonths: [], reportPending: false }),
    });

    const result = await syncRecoveryService.clearIfRevisionMatches({
      userId: USER_ID,
      revision: 3,
      repairedBudgetMonths: [JAN_2026],
      reportCleared: true,
    });

    expect(result.matched).toBe(true);
    const [filter, update] = findOneAndUpdateMock.mock.calls[0];
    expect(filter).toEqual({ user: USER_ID, revision: 3 });
    expect(update.$pull.pendingBudgetMonths.$in).toHaveLength(1);
    expect(update.$set).toEqual({ reportPending: false });
  });

  it("is a no-op that never calls the model when there is nothing to clear", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService();

    const result = await syncRecoveryService.clearIfRevisionMatches({ userId: USER_ID, revision: 1 });

    expect(result).toEqual({ matched: false });
    expect(findOneAndUpdateMock).not.toHaveBeenCalled();
  });

  it("CRITICAL: does not clear a newer mutation's pending work when the revision moved during repair", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService({
      findOneAndUpdateImpl: async () => null,
    });

    const result = await syncRecoveryService.clearIfRevisionMatches({
      userId: USER_ID,
      revision: 3,
      repairedBudgetMonths: [JAN_2026],
      reportCleared: true,
    });

    expect(result).toEqual({ matched: false, record: null });
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { user: USER_ID, revision: 3 },
      expect.any(Object),
      { new: true }
    );
  });
});

describe("reserve", () => {
  it("is a no-op that never touches the model when there is nothing to reserve", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService();

    const result = await syncRecoveryService.reserve({ userId: USER_ID });

    expect(result).toEqual({ budgetReservations: [], reportReservation: null, userWideReservation: null });
    expect(findOneAndUpdateMock).not.toHaveBeenCalled();
  });

  it("pushes a token+timestamp reservation per distinct month and a report reservation, upserting", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService();

    const result = await syncRecoveryService.reserve({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      reserveReport: true,
    });

    expect(result.budgetReservations).toHaveLength(1);
    expect(result.budgetReservations[0].token).toEqual(expect.any(String));
    expect(result.budgetReservations[0].reservedAt).toBeInstanceOf(Date);
    expect(result.reportReservation.token).toEqual(expect.any(String));

    expect(findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    const [filter, update, options] = findOneAndUpdateMock.mock.calls[0];
    expect(filter).toEqual({ user: USER_ID });
    expect(update.$push.reservedBudgetMonths.$each).toHaveLength(1);
    expect(update.$push.reservedReports.token).toEqual(expect.any(String));
    expect(options).toEqual({ upsert: true, setDefaultsOnInsert: true });
  });

  it("does NOT touch pendingBudgetMonths/reportPending -- this is a separate, not-immediately-repair-eligible tier", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService();

    await syncRecoveryService.reserve({ userId: USER_ID, budgetDates: [JAN_2026], reserveReport: true });

    const [, update] = findOneAndUpdateMock.mock.calls[0];
    // The array-based reservation design legitimately emits ONLY a $push --
    expect(update.$set).toBeUndefined();
    expect(update.$addToSet).toBeUndefined();
    expect(update.$inc).toBeUndefined();
    // Only the appropriate Tier-2 reservation arrays are changed: budget
    expect(update.$push).toEqual({
      reservedBudgetMonths: { $each: expect.any(Array) },
      reservedReports: { token: expect.any(String), reservedAt: expect.any(Date) },
    });
    expect(update.$push.reservedUserWideReservations).toBeUndefined();
  });

  it("each call generates a distinct token even for the same month (never reused, defeats ABA)", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService();

    const first = await syncRecoveryService.reserve({ userId: USER_ID, budgetDates: [JAN_2026] });
    const second = await syncRecoveryService.reserve({ userId: USER_ID, budgetDates: [JAN_2026] });

    expect(first.budgetReservations[0].token).not.toEqual(second.budgetReservations[0].token);
    expect(findOneAndUpdateMock).toHaveBeenCalledTimes(2);
  });
});

describe("confirm", () => {
  it("atomically bumps revision, adds Tier-1 pending months/report, and releases the given reservation tokens", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService({
      findOneAndUpdateImpl: async () => ({ revision: 7 }),
    });

    const revision = await syncRecoveryService.confirm({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      confirmReport: true,
      budgetTokens: ["budget-tok-1"],
      reportToken: "report-tok-1",
    });

    expect(revision).toBe(7);
    expect(findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    const [filter, update, options] = findOneAndUpdateMock.mock.calls[0];
    expect(filter).toEqual({ user: USER_ID });
    expect(update.$inc).toEqual({ revision: 1 });
    expect(update.$addToSet.pendingBudgetMonths.$each).toHaveLength(1);
    expect(update.$set.reportPending).toBe(true);
    expect(update.$pull.reservedBudgetMonths.token.$in).toEqual(["budget-tok-1"]);
    expect(update.$pull.reservedReports).toEqual({ token: "report-tok-1" });
    expect(options).toEqual({ upsert: true, new: true, setDefaultsOnInsert: true });
  });

  it("still marks Tier-1 pending work even when no reservation tokens are supplied (e.g. an idempotent replay)", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService({
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
    });

    await syncRecoveryService.confirm({ userId: USER_ID, budgetDates: [JAN_2026], confirmReport: true });

    const [, update] = findOneAndUpdateMock.mock.calls[0];
    expect(update.$addToSet.pendingBudgetMonths.$each).toHaveLength(1);
    expect(update.$set.reportPending).toBe(true);
    expect(update.$pull).toBeUndefined();
  });
});

describe("repairIfPending -- Tier 1 (confirmed pending)", () => {
  it("attempts nothing and never touches recalculateBudget/refreshReport when no marker exists", async () => {
    const { syncRecoveryService, recalculateBudgetMock, refreshReportMock } = loadService();

    const result = await syncRecoveryService.repairIfPending(USER_ID);

    expect(result).toEqual({
      attempted: false,
      revisionMatchedOnClear: false,
      budgetRepairFailed: false,
      reportRepairFailed: false,
      stillPending: false,
    });
    expect(recalculateBudgetMock).not.toHaveBeenCalled();
    expect(refreshReportMock).not.toHaveBeenCalled();
  });

  it("attempts nothing when a marker exists but has no actual pending work (empty months, reportPending false)", async () => {
    const { syncRecoveryService, recalculateBudgetMock, refreshReportMock } = loadService({
      findOneImpl: () => ({
        lean: jest
          .fn()
          .mockResolvedValueOnce({
            revision: 1,
            pendingBudgetMonths: [],
            reportPending: false,
            reservedBudgetMonths: [],
            reservedReports: [],
          })
          .mockResolvedValueOnce({
            revision: 1,
            pendingBudgetMonths: [],
            reportPending: false,
            reservedBudgetMonths: [],
            reservedReports: [],
          }),
      }),
    });

    const result = await syncRecoveryService.repairIfPending(USER_ID);

    expect(result.attempted).toBe(false);
    expect(result.stillPending).toBe(false);
    expect(recalculateBudgetMock).not.toHaveBeenCalled();
    expect(refreshReportMock).not.toHaveBeenCalled();
  });

  it("successfully repairs a pending budget month and the report (fenced by the captured revision), then clears exactly that revision", async () => {
    const { syncRecoveryService, recalculateBudgetMock, refreshReportMock, findOneAndUpdateMock, getDoc } =
      loadServiceStateful({
        user: USER_ID,
        revision: 5,
        pendingBudgetMonths: [JAN_2026_ANCHOR],
        reportPending: true,
        reservedBudgetMonths: [],
        reservedReports: [],
      });

    const result = await syncRecoveryService.repairIfPending(USER_ID);

    // allocateRepairRevision() issues its own fresh $inc ticket (5 -> 6)
    expect(recalculateBudgetMock).toHaveBeenCalledTimes(1);
    expect(recalculateBudgetMock).toHaveBeenCalledWith(USER_ID, JAN_2026_ANCHOR, { fenceRevision: 6 });
    expect(refreshReportMock).toHaveBeenCalledWith(USER_ID, { fenceRevision: 6 });
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { user: USER_ID, revision: 6 },
      expect.objectContaining({ $set: { reportPending: false } }),
      { new: true }
    );
    expect(result).toEqual({
      attempted: true,
      revisionMatchedOnClear: true,
      budgetRepairFailed: false,
      reportRepairFailed: false,
      stillPending: false,
    });
    // Assertions inspect actual persisted document state, not only mocked
    // call counts.
    const finalDoc = getDoc();
    expect(finalDoc.pendingBudgetMonths).toHaveLength(0);
    expect(finalDoc.reportPending).toBe(false);
    expect(finalDoc.revision).toBe(6);
  });

  it("treats a fence-skipped recompute as unrepaired -- leaves the month pending rather than clearing it", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadServiceStateful(
      {
        user: USER_ID,
        revision: 5,
        pendingBudgetMonths: [JAN_2026],
        reportPending: false,
        reservedBudgetMonths: [],
        reservedReports: [],
      },
      {
        // The marker's allocation advances it to the same revision. This is
        recalculateBudgetImpl: async () => ({
          skipped: true,
          reason: "superseded",
          currentRevision: 6,
        }),
      }
    );

    const result = await syncRecoveryService.repairIfPending(USER_ID);

    // Phase C.4 -- allocateRepairRevision() now issues its own atomic $inc
    expect(findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { user: USER_ID },
      { $inc: { revision: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(result.budgetRepairFailed).toBe(true);
    expect(result.stillPending).toBe(true);
  });

  it("self-heals a reset marker revision and clears exact mixed-timezone month anchors", async () => {
    const legacyAnchorForSameMonth = new Date(JAN_2026_ANCHOR.getTime() + 60 * 60 * 1000);
    const { syncRecoveryService, recalculateBudgetMock, findOneAndUpdateMock, getDoc } =
      loadServiceStateful(
        {
          user: USER_ID,
          revision: 19,
          pendingBudgetMonths: [JAN_2026_ANCHOR, legacyAnchorForSameMonth],
          reportPending: false,
          reservedBudgetMonths: [],
          reservedReports: [],
        },
        {
          recalculateBudgetImpl: async (_userId, _date, { fenceRevision }) => {
            if (fenceRevision < 2507) {
              return {
                skipped: true,
                reason: "superseded",
                currentRevision: 2507,
              };
            }
            return {};
          },
        }
      );

    const result = await syncRecoveryService.repairIfPending(USER_ID);

    expect(recalculateBudgetMock.mock.calls.map((call) => call[2].fenceRevision)).toEqual([
      20,
      20,
      2508,
      2508,
    ]);
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { user: USER_ID },
      { $max: { revision: 2507 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(getDoc().revision).toBe(2508);
    expect(getDoc().pendingBudgetMonths).toEqual([]);
    expect(result).toEqual({
      attempted: true,
      revisionMatchedOnClear: true,
      budgetRepairFailed: false,
      reportRepairFailed: false,
      stillPending: false,
    });
  });

  it("a failed budget repair leaves that exact month pending (repeated failure never advances lastError-free)", async () => {
    const { syncRecoveryService, recalculateBudgetMock, findOneAndUpdateMock, updateOneMock } =
      loadServiceStateful(
        {
          user: USER_ID,
          revision: 2,
          pendingBudgetMonths: [JAN_2026],
          reportPending: false,
          reservedBudgetMonths: [],
          reservedReports: [],
        },
        {
          recalculateBudgetImpl: async () => {
            throw new Error("Mongo aggregate timed out");
          },
        }
      );

    const result = await syncRecoveryService.repairIfPending(USER_ID);

    // Phase C.4 -- same rationale as the fence-skipped test above: the $inc
    expect(findOneAndUpdateMock).toHaveBeenCalledTimes(1);
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { user: USER_ID },
      { $inc: { revision: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(updateOneMock).toHaveBeenCalledWith(
      { user: USER_ID },
      { $set: { lastError: "Mongo aggregate timed out", lastAttemptAt: expect.any(Date) } }
    );
    expect(result.budgetRepairFailed).toBe(true);
    expect(result.stillPending).toBe(true);
  });

  it("CRITICAL: an older repair does not clear a newer mutation's pending work recorded mid-repair", async () => {
    // Phase C.4 -- this repair attempt now allocates its OWN fresh ticket
    const { syncRecoveryService, findOneAndUpdateMock, getDoc } = loadServiceStateful(
      {
        user: USER_ID,
        revision: 5,
        pendingBudgetMonths: [JAN_2026_ANCHOR],
        reportPending: true,
        reservedBudgetMonths: [],
        reservedReports: [],
      },
      {
        // Simulates a DIFFERENT, concurrent mutation's confirm() landing
        recalculateBudgetImpl: async () => {
          await findOneAndUpdateMock(
            { user: USER_ID },
            {
              $inc: { revision: 1 },
              $addToSet: { pendingBudgetMonths: { $each: [FEB_2026_ANCHOR] } },
              $set: { reportPending: true, lastAttemptAt: new Date() },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          return {};
        },
      }
    );

    const result = await syncRecoveryService.repairIfPending(USER_ID);

    // Call 1: this repair attempt's own ticket allocation (5 -> 6).
    expect(findOneAndUpdateMock).toHaveBeenNthCalledWith(
      1,
      { user: USER_ID },
      { $inc: { revision: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    // Call 3: clearIfRevisionMatches CAS'd against ticket 6 -- the
    expect(findOneAndUpdateMock).toHaveBeenNthCalledWith(
      3,
      { user: USER_ID, revision: 6 },
      expect.any(Object),
      { new: true }
    );
    expect(result.revisionMatchedOnClear).toBe(false);
    expect(result.stillPending).toBe(true);
    // Assertions inspect actual persisted document state: the concurrent
    const finalDoc = getDoc();
    expect(finalDoc.revision).toBe(7);
    expect(finalDoc.pendingBudgetMonths.map((d) => new Date(d).getTime())).toEqual(
      expect.arrayContaining([FEB_2026_ANCHOR.getTime()])
    );
    expect(finalDoc.reportPending).toBe(true);
  });

  it("never throws even when the initial marker lookup itself fails, and never runs any repair step", async () => {
    const { syncRecoveryService, recalculateBudgetMock, refreshReportMock } = loadService({
      findOneImpl: () => ({
        lean: jest.fn().mockRejectedValue(new Error("Mongo connection lost")),
      }),
    });

    const result = await syncRecoveryService.repairIfPending(USER_ID);

    expect(result).toEqual({ attempted: false, stillPending: true, repairLookupFailed: true });
    expect(recalculateBudgetMock).not.toHaveBeenCalled();
    expect(refreshReportMock).not.toHaveBeenCalled();
  });
});

describe("repairIfPending -- Tier 2 (age-gated reservation recovery / crash-gap closure)", () => {
  const NOW = new Date("2026-03-01T00:00:00.000Z").getTime();
  const FRESH_RESERVED_AT = new Date(NOW - 2000); // 2s old -- well within a single request's latency
  const STALE_RESERVED_AT = new Date(NOW - 20000); // 20s old -- past RESERVATION_STALE_MS (15s)

  it("does NOT touch a fresh reservation -- a genuinely in-flight request's evidence is left alone", async () => {
    const marker = {
      revision: 1,
      pendingBudgetMonths: [],
      reportPending: false,
      reservedBudgetMonths: [{ month: JAN_2026, token: "fresh-tok", reservedAt: FRESH_RESERVED_AT }],
      reservedReports: [],
    };
    const leanMock = jest.fn().mockResolvedValue(marker);

    const { syncRecoveryService, recalculateBudgetMock, findOneAndUpdateMock } = loadService({
      findOneImpl: () => ({ lean: leanMock }),
    });

    const result = await syncRecoveryService.repairIfPending(USER_ID, { now: NOW });

    expect(recalculateBudgetMock).not.toHaveBeenCalled();
    expect(findOneAndUpdateMock).not.toHaveBeenCalled();
    expect(result.stillPending).toBe(true);
  });

  it("CRASH-GAP CLOSURE: recomputes (but NEVER releases) a reservation once it is older than RESERVATION_STALE_MS, with no Tier-1 marker ever having existed", async () => {
    // This is the exact scenario the crash gap describes: a process
    const marker = {
      revision: 0,
      pendingBudgetMonths: [],
      reportPending: false,
      reservedBudgetMonths: [{ month: JAN_2026, token: "crashed-tok", reservedAt: STALE_RESERVED_AT }],
      reservedReports: [],
    };
    const leanMock = jest.fn().mockResolvedValue(marker);

    const { syncRecoveryService, recalculateBudgetMock, updateOneMock, findOneAndUpdateMock } = loadService({
      findOneImpl: () => ({ lean: leanMock }),
      // Phase C.4 -- the Tier-2 pass now allocates its own fresh ticket
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
    });

    const result = await syncRecoveryService.repairIfPending(USER_ID, { now: NOW });

    // The recompute is fenced by a FRESH ticket this repair attempt itself
    expect(findOneAndUpdateMock).toHaveBeenCalledWith(
      { user: USER_ID },
      { $inc: { revision: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(recalculateBudgetMock).toHaveBeenCalledWith(USER_ID, JAN_2026, { fenceRevision: 1 });
    // No $pull, no updateOne call of any kind -- a successful defensive
    // recompute leaves the reservation completely untouched.
    expect(updateOneMock).not.toHaveBeenCalled();
    expect(result.attempted).toBe(true);
  });

  it("CRASH-GAP CLOSURE: an aged report reservation with no Tier-1 marker is still recovered, and never released by this pass", async () => {
    const marker = {
      revision: 0,
      pendingBudgetMonths: [],
      reportPending: false,
      reservedBudgetMonths: [],
      reservedReports: [{ token: "crashed-report-tok", reservedAt: STALE_RESERVED_AT }],
    };
    const leanMock = jest.fn().mockResolvedValue(marker);

    const { syncRecoveryService, refreshReportMock, updateOneMock } = loadService({
      findOneImpl: () => ({ lean: leanMock }),
      // Phase C.4 -- see the previous test's identical comment.
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
    });

    const result = await syncRecoveryService.repairIfPending(USER_ID, { now: NOW });

    expect(refreshReportMock).toHaveBeenCalledWith(USER_ID, { fenceRevision: 1 });
    // Deliberately no reservedReports entry pulled on this pass -- see Phase
    // C.2's Tier-2 doc comment in syncRecoveryService.js.
    expect(updateOneMock).not.toHaveBeenCalled();
    expect(result.attempted).toBe(true);
  });

  it("HARD-DELETE RECOVERY: an aged reservation is repaired purely from the reservation's own presence, and remains present afterward -- no expense document or timestamp/count evidence is needed", async () => {
    // Simulates a crashed delete: the expense is already gone (hard
    const marker = {
      revision: 0,
      pendingBudgetMonths: [],
      reportPending: false,
      reservedBudgetMonths: [{ month: JAN_2026, token: "crashed-delete-tok", reservedAt: STALE_RESERVED_AT }],
      reservedReports: [],
    };
    const leanMock = jest.fn().mockResolvedValue(marker);
    const recalculateBudgetMock = jest.fn(async () => ({ spent: 0 }));

    const { syncRecoveryService, updateOneMock } = loadService({
      findOneImpl: () => ({ lean: leanMock }),
      recalculateBudgetImpl: recalculateBudgetMock,
      // Phase C.4 -- see the earlier Tier-2 test's identical comment.
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
    });

    await syncRecoveryService.repairIfPending(USER_ID, { now: NOW });

    expect(recalculateBudgetMock).toHaveBeenCalledWith(USER_ID, JAN_2026, { fenceRevision: 1 });
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it("a genuinely in-flight reservation is never disturbed even while a DIFFERENT, aged reservation for the same user is defensively recomputed", async () => {
    const marker = {
      revision: 0,
      pendingBudgetMonths: [],
      reportPending: false,
      reservedBudgetMonths: [
        { month: JAN_2026, token: "aged-tok", reservedAt: STALE_RESERVED_AT },
        { month: FEB_2026, token: "fresh-tok", reservedAt: FRESH_RESERVED_AT },
      ],
      reservedReports: [],
    };
    const leanMock = jest.fn().mockResolvedValue(marker);

    const { syncRecoveryService, recalculateBudgetMock, updateOneMock } = loadService({
      findOneImpl: () => ({ lean: leanMock }),
      // Phase C.4 -- see the earlier Tier-2 tests' identical comment.
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
    });

    await syncRecoveryService.repairIfPending(USER_ID, { now: NOW });

    expect(recalculateBudgetMock).toHaveBeenCalledTimes(1);
    expect(recalculateBudgetMock).toHaveBeenCalledWith(USER_ID, JAN_2026, { fenceRevision: 1 });
    expect(recalculateBudgetMock).not.toHaveBeenCalledWith(USER_ID, FEB_2026, expect.anything());
    // Neither reservation is ever pulled/released by this pass -- for
    // EITHER month, aged or fresh.
    expect(updateOneMock).not.toHaveBeenCalled();
  });
});

describe("synchronizeAfterMutation", () => {
  it("calls confirm() FIRST (unconditionally) before any recompute -- durable evidence exists even if a crash happens immediately after", async () => {
    const callOrder = [];
    const { syncRecoveryService, findOneAndUpdateMock, recalculateBudgetMock, refreshReportMock } =
      loadService({
        findOneAndUpdateImpl: async () => {
          callOrder.push("confirm-or-clear");
          return { revision: 1 };
        },
        recalculateBudgetImpl: async () => {
          callOrder.push("recalculateBudget");
        },
        refreshReportImpl: async () => {
          callOrder.push("refreshReport");
        },
      });

    await syncRecoveryService.synchronizeAfterMutation({ userId: USER_ID, budgetDates: [JAN_2026] });

    // confirm() is the FIRST findOneAndUpdate call, strictly before any
    // recompute attempt.
    expect(callOrder[0]).toBe("confirm-or-clear");
    expect(callOrder).toContain("recalculateBudget");
    expect(callOrder).toContain("refreshReport");
  });

  it("fences its own recompute+persist with the revision confirm() returned, and clears using that same revision", async () => {
    const { syncRecoveryService, recalculateBudgetMock, refreshReportMock, findOneAndUpdateMock } =
      loadService({
        findOneAndUpdateImpl: async () => ({ revision: 9 }),
      });

    await syncRecoveryService.synchronizeAfterMutation({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      budgetTokens: ["tok-a"],
      reportToken: "tok-b",
    });

    expect(recalculateBudgetMock).toHaveBeenCalledWith(USER_ID, JAN_2026, { fenceRevision: 9 });
    expect(refreshReportMock).toHaveBeenCalledWith(USER_ID, { fenceRevision: 9 });
    // Second findOneAndUpdate call is the clear, gated on revision 9.
    const clearCall = findOneAndUpdateMock.mock.calls[1];
    expect(clearCall[0]).toEqual({ user: USER_ID, revision: 9 });
  });

  it("passes the reservation tokens through to confirm() for release", async () => {
    const { syncRecoveryService, findOneAndUpdateMock } = loadService({
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
    });

    await syncRecoveryService.synchronizeAfterMutation({
      userId: USER_ID,
      budgetDates: [JAN_2026],
      budgetTokens: ["tok-a"],
      reportToken: "tok-b",
    });

    const confirmCall = findOneAndUpdateMock.mock.calls[0];
    expect(confirmCall[1].$pull.reservedBudgetMonths.token.$in).toEqual(["tok-a"]);
    expect(confirmCall[1].$pull.reservedReports).toEqual({ token: "tok-b" });
  });

  it("returns a fully synchronized result when everything succeeds", async () => {
    const { syncRecoveryService, recalculateBudgetMock, refreshReportMock } = loadService({
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
    });

    const result = await syncRecoveryService.synchronizeAfterMutation({
      userId: USER_ID,
      budgetDates: [JAN_2026],
    });

    expect(recalculateBudgetMock).toHaveBeenCalledWith(USER_ID, JAN_2026, { fenceRevision: 1 });
    expect(refreshReportMock).toHaveBeenCalledWith(USER_ID, { fenceRevision: 1 });
    expect(result).toEqual({
      status: "synchronized",
      budget: "synchronized",
      report: "synchronized",
      recoveryPending: false,
    });
  });

  it("returns a committed-but-pending result when recalculateBudget fails", async () => {
    const { syncRecoveryService } = loadService({
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
      recalculateBudgetImpl: async () => {
        throw new Error("simulated budget aggregate failure");
      },
    });

    const result = await syncRecoveryService.synchronizeAfterMutation({
      userId: USER_ID,
      budgetDates: [JAN_2026],
    });

    expect(result).toEqual({
      status: "pending",
      budget: "pending",
      report: "synchronized",
      recoveryPending: true,
    });
  });

  it("returns a committed-but-pending result when refreshReport fails", async () => {
    const { syncRecoveryService } = loadService({
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
      refreshReportImpl: async () => {
        throw new Error("simulated report persistence failure");
      },
    });

    const result = await syncRecoveryService.synchronizeAfterMutation({ userId: USER_ID, budgetDates: [] });

    expect(result).toEqual({
      status: "pending",
      budget: "synchronized",
      report: "pending",
      recoveryPending: true,
    });
  });

  it("treats a fence-skip (superseded) the same as a failure -- leaves it pending, not falsely synchronized", async () => {
    const { syncRecoveryService } = loadService({
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
      recalculateBudgetImpl: async () => ({ skipped: true, reason: "superseded" }),
      refreshReportImpl: async () => ({ skipped: true, reason: "superseded" }),
    });

    const result = await syncRecoveryService.synchronizeAfterMutation({
      userId: USER_ID,
      budgetDates: [JAN_2026],
    });

    expect(result.budget).toBe("pending");
    expect(result.report).toBe("pending");
    expect(result.recoveryPending).toBe(true);
  });

  it("attempts every affected month independently -- one month failing does not skip the other (edit crossing months)", async () => {
    const recalculateBudgetMock = jest.fn(async (userId, date) => {
      if (date.getTime() === FEB_2026.getTime()) {
        throw new Error("February recalculation failed");
      }
    });
    const { syncRecoveryService } = loadService({
      findOneAndUpdateImpl: async () => ({ revision: 1 }),
      recalculateBudgetImpl: recalculateBudgetMock,
    });

    const result = await syncRecoveryService.synchronizeAfterMutation({
      userId: USER_ID,
      budgetDates: [JAN_2026, FEB_2026],
    });

    expect(recalculateBudgetMock).toHaveBeenCalledWith(USER_ID, JAN_2026, { fenceRevision: 1 });
    expect(recalculateBudgetMock).toHaveBeenCalledWith(USER_ID, FEB_2026, { fenceRevision: 1 });
    expect(result.budget).toBe("pending");
  });
});
