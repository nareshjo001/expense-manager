// System-wide reservation-ownership correction.
"use strict";

const PENDING_SYNC_PATH = "../models/PendingSync";
const SCHEMAS_PATH = "../config/Schemas";
const BUDGET_SERVICE_PATH = "../Services/BudgetServices/budget.service";
const REPORT_SERVICE_PATH = "../Services/reportService";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

// Verbatim (same update semantics) as tests/mutationRecoveryCorrectness.
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
          if (typeof value === "string" && ISO_DATE_STRING.test(value)) return new Date(value);
          return value;
        })
      : null;
  }

  function applyUpdate(doc, update) {
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
    }
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) doc[k] = v;
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
      if (filter.revision !== undefined && doc.revision !== filter.revision) return null;
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

function makeFakeBudgetModel(existingMonths = []) {
  return {
    find: jest.fn(() => ({
      select: () => ({ lean: async () => existingMonths }),
    })),
  };
}

function loadRealService({ recalculateBudgetImpl, refreshReportImpl, existingBudgetMonths = [] } = {}) {
  jest.resetModules();

  const pendingSyncModel = makeFakePendingSyncModel();
  jest.doMock(PENDING_SYNC_PATH, () => pendingSyncModel);

  const budgetModel = makeFakeBudgetModel(existingBudgetMonths);
  jest.doMock(SCHEMAS_PATH, () => ({ BudgetModel: budgetModel }));

  const recalculateBudgetMock = jest.fn(recalculateBudgetImpl || (async () => ({ skipped: false })));
  jest.doMock(BUDGET_SERVICE_PATH, () => {
    const actual = jest.requireActual(BUDGET_SERVICE_PATH);
    return { ...actual, recalculateBudget: recalculateBudgetMock };
  });

  const refreshReportMock = jest.fn(refreshReportImpl || (async () => ({ skipped: false })));
  jest.doMock(REPORT_SERVICE_PATH, () => ({ refreshReport: refreshReportMock, getReport: jest.fn() }));

  const svc = require(SYNC_RECOVERY_SERVICE_PATH);
  return { svc, pendingSyncModel, recalculateBudgetMock, refreshReportMock };
}

const USER_ID = "reservation-ownership-user";

describe("System-wide reservation ownership -- reservedReports", () => {
  it("1. R1 commits/crashes; R2 reserves, fails, and abandons; R1 remains repairable", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveReport: true });
    // R1's mutation commits (not modeled -- conceptual); R1 crashes before confirm().

    const r2 = await svc.reserve({ userId: USER_ID, reserveReport: true });
    const afterR2Reserve = pendingSyncModel._store.get(USER_ID);
    expect(afterR2Reserve.reservedReports.map((r) => r.token)).toEqual(
      expect.arrayContaining([r1.reportReservation.token, r2.reportReservation.token])
    );

    // R2's mutation fails; R2 abandons its OWN token only.
    await svc.abandon({ userId: USER_ID, reportToken: r2.reportReservation.token });

    const afterAbandon = pendingSyncModel._store.get(USER_ID);
    expect(afterAbandon.reservedReports).toHaveLength(1);
    expect(afterAbandon.reservedReports[0].token).toBe(r1.reportReservation.token);

    // R1 remains repairable: repairIfPending() (with the age-gate bypassed
    // via `now`) finds and acts on R1's still-present entry.
    const future = new Date(afterAbandon.reservedReports[0].reservedAt.getTime() + 20000);
    const repairResult = await svc.repairIfPending(USER_ID, { now: future });
    expect(repairResult.attempted).toBe(true);
    expect(repairResult.reportRepairFailed).toBe(false);
  });

  it("2. R1 fails and abandons after R2 reserves; R2's evidence remains intact", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveReport: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveReport: true });

    // R1 fails and abandons its OWN token -- must not touch R2's entry.
    await svc.abandon({ userId: USER_ID, reportToken: r1.reportReservation.token });

    const afterAbandon = pendingSyncModel._store.get(USER_ID);
    expect(afterAbandon.reservedReports).toHaveLength(1);
    expect(afterAbandon.reservedReports[0].token).toBe(r2.reportReservation.token);
  });

  it("3a. R1 confirms then R2 confirms -- both releases apply independently, Tier-1 accumulates", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveReport: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveReport: true });

    await svc.confirm({ userId: USER_ID, confirmReport: true, reportToken: r1.reportReservation.token });
    const afterR1Confirm = pendingSyncModel._store.get(USER_ID);
    expect(afterR1Confirm.reservedReports).toHaveLength(1);
    expect(afterR1Confirm.reservedReports[0].token).toBe(r2.reportReservation.token);
    expect(afterR1Confirm.reportPending).toBe(true);

    await svc.confirm({ userId: USER_ID, confirmReport: true, reportToken: r2.reportReservation.token });
    const afterR2Confirm = pendingSyncModel._store.get(USER_ID);
    expect(afterR2Confirm.reservedReports).toHaveLength(0);
    expect(afterR2Confirm.reportPending).toBe(true);
  });

  it("3b. R2 confirms then R1 confirms (reverse order) -- same end state, no lost releases", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveReport: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveReport: true });

    await svc.confirm({ userId: USER_ID, confirmReport: true, reportToken: r2.reportReservation.token });
    const afterR2Confirm = pendingSyncModel._store.get(USER_ID);
    expect(afterR2Confirm.reservedReports).toHaveLength(1);
    expect(afterR2Confirm.reservedReports[0].token).toBe(r1.reportReservation.token);

    await svc.confirm({ userId: USER_ID, confirmReport: true, reportToken: r1.reportReservation.token });
    const afterR1Confirm = pendingSyncModel._store.get(USER_ID);
    expect(afterR1Confirm.reservedReports).toHaveLength(0);
    expect(afterR1Confirm.reportPending).toBe(true);
  });

  it("4. one request confirms while another remains in flight -- the in-flight one's evidence survives", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveReport: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveReport: true });

    // Only R1 confirms -- R2 is still mid-flight (neither confirmed nor abandoned).
    await svc.confirm({ userId: USER_ID, confirmReport: true, reportToken: r1.reportReservation.token });

    const doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedReports).toHaveLength(1);
    expect(doc.reservedReports[0].token).toBe(r2.reportReservation.token);
    expect(doc.reportPending).toBe(true); // R1's Tier-1 evidence already durable.
  });

  it("5. both requests fail and abandon in reverse order -- each release only ever removes its own token", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveReport: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveReport: true });

    // Reverse order: R2 abandons first, then R1.
    await svc.abandon({ userId: USER_ID, reportToken: r2.reportReservation.token });
    const afterR2Abandon = pendingSyncModel._store.get(USER_ID);
    expect(afterR2Abandon.reservedReports).toHaveLength(1);
    expect(afterR2Abandon.reservedReports[0].token).toBe(r1.reportReservation.token);

    await svc.abandon({ userId: USER_ID, reportToken: r1.reportReservation.token });
    const afterR1Abandon = pendingSyncModel._store.get(USER_ID);
    expect(afterR1Abandon.reservedReports).toHaveLength(0);
    // Fully failed mutations released their own reservations -- no
    // permanent false-pending state (Tier-1 was never set, nothing to clear).
    expect(afterR1Abandon.reportPending).toBe(false);
  });
});

describe("System-wide reservation ownership -- reservedUserWideReservations (equivalent interleavings)", () => {
  it("6a. R1 commits/crashes; R2 reserves, fails, and abandons; R1 remains repairable (userWide)", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });
    await svc.abandon({ userId: USER_ID, userWideToken: r2.userWideReservation.token });

    const afterAbandon = pendingSyncModel._store.get(USER_ID);
    expect(afterAbandon.reservedUserWideReservations).toHaveLength(1);
    expect(afterAbandon.reservedUserWideReservations[0].token).toBe(r1.userWideReservation.token);

    const future = new Date(afterAbandon.reservedUserWideReservations[0].reservedAt.getTime() + 20000);
    const repairResult = await svc.repairIfPending(USER_ID, { now: future });
    expect(repairResult.attempted).toBe(true);
  });

  it("6b. R1 fails and abandons after R2 reserves; R2's userWide evidence remains intact", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });
    await svc.abandon({ userId: USER_ID, userWideToken: r1.userWideReservation.token });

    const afterAbandon = pendingSyncModel._store.get(USER_ID);
    expect(afterAbandon.reservedUserWideReservations).toHaveLength(1);
    expect(afterAbandon.reservedUserWideReservations[0].token).toBe(r2.userWideReservation.token);
  });

  it("6c. R1 and R2 both confirm, in either order -- both releases apply independently (userWide)", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });

    await svc.confirm({ userId: USER_ID, userWideToken: r2.userWideReservation.token, budgetDates: [] });
    let doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedUserWideReservations).toHaveLength(1);
    expect(doc.reservedUserWideReservations[0].token).toBe(r1.userWideReservation.token);

    await svc.confirm({ userId: USER_ID, userWideToken: r1.userWideReservation.token, budgetDates: [] });
    doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedUserWideReservations).toHaveLength(0);
  });

  it("6d. one confirms while another remains in flight (userWide)", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });

    await svc.confirm({ userId: USER_ID, userWideToken: r1.userWideReservation.token, budgetDates: [] });

    const doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedUserWideReservations).toHaveLength(1);
    expect(doc.reservedUserWideReservations[0].token).toBe(r2.userWideReservation.token);
  });

  it("6e. both fail and abandon in reverse order (userWide) -- no permanent false-pending state", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const r1 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });

    await svc.abandon({ userId: USER_ID, userWideToken: r2.userWideReservation.token });
    await svc.abandon({ userId: USER_ID, userWideToken: r1.userWideReservation.token });

    const doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedUserWideReservations).toHaveLength(0);
    expect(doc.reportPending).toBe(false);
    expect(doc.pendingBudgetMonths).toHaveLength(0);
  });

  it("6f. repairIfPending recovers a stale userWide reservation by recomputing every existing budget month once", async () => {
    const existingMonths = [{ month: "Aug 2026" }, { month: "Sep 2026" }];
    const { svc, pendingSyncModel, recalculateBudgetMock } = loadRealService({ existingBudgetMonths: existingMonths });

    const r1 = await svc.reserve({ userId: USER_ID, reserveUserWide: true });
    const doc = pendingSyncModel._store.get(USER_ID);
    const future = new Date(doc.reservedUserWideReservations[0].reservedAt.getTime() + 20000);

    const result = await svc.repairIfPending(USER_ID, { now: future });

    expect(result.attempted).toBe(true);
    expect(recalculateBudgetMock).toHaveBeenCalledTimes(2); // once per existing month, not per stale entry.
    // Never releases the reservation itself -- only confirm()/abandon() do.
    const after = pendingSyncModel._store.get(USER_ID);
    expect(after.reservedUserWideReservations).toHaveLength(1);
    expect(after.reservedUserWideReservations[0].token).toBe(r1.userWideReservation.token);
  });
});

describe("System-wide reservation ownership -- guarantee #7 (concurrent commits, recompute must observe both)", () => {
  it("a recompute that only observes R1's write leaves R2's evidence pending; a later recompute observing both clears fully", async () => {
    let observedWrites = 0;
    const { svc, pendingSyncModel } = loadRealService({
      refreshReportImpl: async () => {
        observedWrites += 1;
        // First recompute only "sees" R1's write (simulated); second sees both.
        return { skipped: false };
      },
    });

    const r1 = await svc.reserve({ userId: USER_ID, reserveReport: true });
    const r2 = await svc.reserve({ userId: USER_ID, reserveReport: true });

    // R1 confirms and its own recompute runs (observes only R1's write in
    await svc.synchronizeAfterMutation({
      userId: USER_ID,
      reportToken: r1.reportReservation.token,
    });

    let doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedReports).toHaveLength(1);
    expect(doc.reservedReports[0].token).toBe(r2.reportReservation.token);

    // R2 now confirms -- its own recompute (this call) observes both writes
    await svc.synchronizeAfterMutation({
      userId: USER_ID,
      reportToken: r2.reportReservation.token,
    });

    doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedReports).toHaveLength(0);
    expect(doc.reportPending).toBe(false);
    expect(observedWrites).toBe(2);
  });
});

describe("System-wide reservation ownership -- no regression to reservedBudgetMonths", () => {
  it("10. reservedBudgetMonths ownership (array, per-token $push/$pull) is unchanged by this fix", async () => {
    const { svc, pendingSyncModel } = loadRealService();

    const jan = new Date("2026-01-15T00:00:00.000Z");
    const feb = new Date("2026-02-15T00:00:00.000Z");

    const r1 = await svc.reserve({ userId: USER_ID, budgetDates: [jan] });
    const r2 = await svc.reserve({ userId: USER_ID, budgetDates: [feb] });

    let doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedBudgetMonths).toHaveLength(2);

    await svc.abandon({ userId: USER_ID, budgetTokens: [r1.budgetReservations[0].token] });
    doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedBudgetMonths).toHaveLength(1);
    expect(doc.reservedBudgetMonths[0].token).toBe(r2.budgetReservations[0].token);
  });
});
