// Final correctness pass -- legacy PendingSync backward compatibility.
//
// Confirmed gap (follow-up review, AFTER the system-wide reservation-
// ownership correction in tests/syncRecoveryService.reservationOwnership.
// test.js): that fix renamed the single-object `reservedReport`/
// `reservedUserWide` fields to owned-token arrays (`reservedReports`/
// `reservedUserWideReservations`) and declared the two legacy field names
// permanently inert -- but a document written by an OLD-version process
// BEFORE this deploy can still have a legacy `reservedReport`/
// `reservedUserWide` object sitting in MongoDB, representing a mutation
// that DID commit but whose confirm() never ran before the process
// crashed. The new array-based code never read or wrote those two field
// names, so that surviving evidence was permanently invisible to repair --
// not merely delayed, LOST.
//
// Fix: models/PendingSync.js re-declares `reservedReport`/`reservedUserWide`
// as explicit, READ-AND-CLEAR-ONLY legacy fields. Services/
// syncRecoveryService.js's repairIfPending() gained a "Pass 0" that
// atomically promotes a STALE legacy reservation into modern Tier-1
// evidence (reportPending / pendingBudgetMonths) in the SAME write that
// clears the legacy field, CAS'd on the legacy field's own token for
// idempotency. A non-stale legacy reservation is left completely
// untouched and remains represented in `stillPending`.
//
// This file uses the REAL, unmocked Services/syncRecoveryService.js against
// a stateful, real-CAS-semantics fake models/PendingSync (same pattern as
// tests/syncRecoveryService.reservationOwnership.test.js), extended to
// support `$unset` and dot-path (`"reservedReport.token"`) filter matching
// -- the two new update/filter shapes repairIfPending()'s legacy pass
// actually issues (verified against Services/syncRecoveryService.js's exact
// update documents). Every assertion inspects the actual fake document
// state, never merely a mocked call count.
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

// Resolves a dot-path (e.g. "reservedReport.token") against a plain object.
function getPath(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

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
      // Deliberately NO reservedReport/reservedUserWide by default -- a
      // brand-new document created by this version of the code never gets
      // one (see models/PendingSync.js's `default: undefined`). Tests that
      // need a legacy document seed it explicitly via `_store.set(...)`.
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
    if (update.$unset) {
      for (const k of Object.keys(update.$unset)) delete doc[k];
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
        }
        if (v && v.token && v.token.$in) {
          doc[k] = (doc[k] || []).filter((existing) => !v.token.$in.includes(existing.token));
        } else if (v && v.token) {
          doc[k] = (doc[k] || []).filter((existing) => existing.token !== v.token);
        }
      }
    }
    return doc;
  }

  // Real Mongo CAS filter matching for every filter key BEYOND `user`
  // (`revision`, or a dot-path like `"reservedReport.token"`) -- a filter
  // that does not match the CURRENT document's value returns null,
  // exactly like a real findOneAndUpdate whose filter no longer matches.
  function filterMatches(doc, filter) {
    for (const [key, value] of Object.entries(filter)) {
      if (key === "user") continue;
      const actual = key.includes(".") ? getPath(doc, key) : doc[key];
      if (actual !== value) return false;
    }
    return true;
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
      if (!filterMatches(doc, filter)) return null;
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

const USER_ID = "legacy-compat-user";
const STALE_RESERVED_AT_MS_AGO = 20000; // > RESERVATION_STALE_MS (15000)
const FRESH_RESERVED_AT_MS_AGO = 2000;

function seedLegacyDoc(pendingSyncModel, userId, extra = {}) {
  const base = {
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
  pendingSyncModel._store.set(userId, { ...base, ...extra });
}

describe("Legacy PendingSync compatibility -- stale legacy reservedReport", () => {
  it("is promoted to Tier-1 reportPending and reconciled in the same repairIfPending() call", async () => {
    const { svc, pendingSyncModel, refreshReportMock } = loadRealService();
    const reservedAt = new Date(Date.now() - STALE_RESERVED_AT_MS_AGO);
    seedLegacyDoc(pendingSyncModel, USER_ID, {
      reservedReport: { token: "legacy-report-tok", reservedAt },
    });

    const result = await svc.repairIfPending(USER_ID);

    // Promotion is proved through persisted document state and invoked
    // reconciliation below, not through a dedicated return-contract field
    // (repairIfPending()'s public return object intentionally stays at its
    // previously-stable 5 fields -- see syncRecoveryService.js's own doc
    // comment on the return statement).
    expect(result.attempted).toBe(true);
    expect(refreshReportMock).toHaveBeenCalledTimes(1);

    const doc = pendingSyncModel._store.get(USER_ID);
    // Legacy field cleared, reportPending fully reconciled (refreshReport
    // succeeded, so the SAME call's Tier-1 pass clears reportPending too).
    expect(doc.reservedReport).toBeUndefined();
    expect(doc.reportPending).toBe(false);
  });
});

describe("Legacy PendingSync compatibility -- stale legacy reservedUserWide", () => {
  it("is promoted to Tier-1 pendingBudgetMonths (every existing budget month) and reconciled", async () => {
    const existingMonths = [{ month: "Aug 2026" }, { month: "Sep 2026" }];
    const { svc, pendingSyncModel, recalculateBudgetMock } = loadRealService({ existingBudgetMonths: existingMonths });
    const reservedAt = new Date(Date.now() - STALE_RESERVED_AT_MS_AGO);
    seedLegacyDoc(pendingSyncModel, USER_ID, {
      reservedUserWide: { token: "legacy-userwide-tok", reservedAt },
    });

    const result = await svc.repairIfPending(USER_ID);

    // Promotion proved via persisted state + invocation counts below, not a
    // dedicated return field.
    expect(result.attempted).toBe(true);
    expect(recalculateBudgetMock).toHaveBeenCalledTimes(2); // Aug + Sep.

    const doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedUserWide).toBeUndefined();
    expect(doc.pendingBudgetMonths).toHaveLength(0); // fully reconciled this call.
  });
});

describe("Legacy PendingSync compatibility -- non-stale legacy reservations", () => {
  it("a fresh legacy reservedReport is left completely untouched and remains represented in stillPending", async () => {
    const { svc, pendingSyncModel, refreshReportMock } = loadRealService();
    const reservedAt = new Date(Date.now() - FRESH_RESERVED_AT_MS_AGO);
    seedLegacyDoc(pendingSyncModel, USER_ID, {
      reservedReport: { token: "fresh-legacy-tok", reservedAt },
    });

    const result = await svc.repairIfPending(USER_ID);

    // Not promoted -- proved by the legacy field surviving completely
    // untouched below (promotion is the ONLY code path that ever clears
    // reservedReport/reservedUserWide) and refreshReport never being
    // invoked.
    expect(refreshReportMock).not.toHaveBeenCalled();
    expect(result.stillPending).toBe(true);

    const doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedReport).toEqual({ token: "fresh-legacy-tok", reservedAt });
  });

  it("the SAME reservation becomes repairable once aged beyond the threshold (deterministic `now` injection)", async () => {
    const { svc, pendingSyncModel, refreshReportMock } = loadRealService();
    const reservedAt = new Date("2026-03-01T00:00:00.000Z");
    seedLegacyDoc(pendingSyncModel, USER_ID, {
      reservedReport: { token: "aging-tok", reservedAt },
    });

    // Still fresh at +2s.
    const stillFresh = reservedAt.getTime() + 2000;
    await svc.repairIfPending(USER_ID, { now: stillFresh });
    expect(refreshReportMock).not.toHaveBeenCalled();
    expect(pendingSyncModel._store.get(USER_ID).reservedReport).toEqual({ token: "aging-tok", reservedAt });

    // Now stale at +20s (> RESERVATION_STALE_MS).
    const nowStale = reservedAt.getTime() + 20000;
    await svc.repairIfPending(USER_ID, { now: nowStale });
    expect(refreshReportMock).toHaveBeenCalledTimes(1);
    expect(pendingSyncModel._store.get(USER_ID).reservedReport).toBeUndefined();
  });
});

describe("Legacy PendingSync compatibility -- failure/retry durability", () => {
  it("a reconciliation failure after promotion leaves Tier-1 evidence durable; a later retry completes and clears it", async () => {
    let callCount = 0;
    const { svc, pendingSyncModel, refreshReportMock } = loadRealService({
      refreshReportImpl: async () => {
        callCount += 1;
        if (callCount === 1) throw new Error("simulated report persistence failure");
        return { skipped: false };
      },
    });
    const reservedAt = new Date(Date.now() - STALE_RESERVED_AT_MS_AGO);
    seedLegacyDoc(pendingSyncModel, USER_ID, {
      reservedReport: { token: "failing-tok", reservedAt },
    });

    const firstResult = await svc.repairIfPending(USER_ID);
    expect(firstResult.reportRepairFailed).toBe(true);

    const afterFailure = pendingSyncModel._store.get(USER_ID);
    // Legacy field already cleared (promotion itself succeeded/committed),
    // but Tier-1 evidence survives the FAILED recompute -- never lost.
    expect(afterFailure.reservedReport).toBeUndefined();
    expect(afterFailure.reportPending).toBe(true);

    // A later retry (no `now` override needed -- this is now an ordinary
    // Tier-1 marker, not gated by the legacy age-gate anymore) completes
    // and clears the state.
    const retryResult = await svc.repairIfPending(USER_ID);
    expect(retryResult.reportRepairFailed).toBe(false);
    expect(refreshReportMock).toHaveBeenCalledTimes(2);

    const afterRetry = pendingSyncModel._store.get(USER_ID);
    expect(afterRetry.reportPending).toBe(false);
  });
});

describe("Legacy PendingSync compatibility -- idempotent promotion", () => {
  it("repeated repairIfPending() calls for an already-promoted legacy reservation never create duplicate evidence", async () => {
    const existingMonths = [{ month: "Aug 2026" }];
    const { svc, pendingSyncModel, recalculateBudgetMock } = loadRealService({ existingBudgetMonths: existingMonths });
    const reservedAt = new Date(Date.now() - STALE_RESERVED_AT_MS_AGO);
    seedLegacyDoc(pendingSyncModel, USER_ID, {
      reservedUserWide: { token: "idempotent-tok", reservedAt },
    });

    const first = await svc.repairIfPending(USER_ID);
    // First call promoted -- proved by the legacy field now being cleared
    // (the ONLY code path that ever clears it).
    expect(pendingSyncModel._store.get(USER_ID).reservedUserWide).toBeUndefined();
    const revisionAfterFirst = pendingSyncModel._store.get(USER_ID).revision;
    void first;

    // Second call: the legacy field is already gone (cleared by the first
    // call's atomic promotion), so the CAS filter on the old token can
    // never match again -- this must be a correct, safe no-op for the
    // legacy pass specifically (no duplicate $addToSet, no duplicate
    // revision bump from THIS pass).
    await svc.repairIfPending(USER_ID);

    const doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.pendingBudgetMonths).toHaveLength(0); // reconciled by first call, not duplicated.
    // recalculateBudget was called exactly once for the single existing
    // month -- promotion + reconciliation happened once, not twice.
    expect(recalculateBudgetMock).toHaveBeenCalledTimes(1);
    void revisionAfterFirst;
  });
});

describe("Legacy PendingSync compatibility -- coexistence with new array reservations", () => {
  it("a document with BOTH legacy fields and new array reservations preserves all independently owned evidence", async () => {
    const { svc, pendingSyncModel } = loadRealService();
    const staleReservedAt = new Date(Date.now() - STALE_RESERVED_AT_MS_AGO);

    seedLegacyDoc(pendingSyncModel, USER_ID, {
      reservedReport: { token: "legacy-report-tok", reservedAt: staleReservedAt },
      reservedUserWide: { token: "legacy-userwide-tok", reservedAt: staleReservedAt },
    });

    // A genuinely separate, modern array-based reservation for the SAME
    // user, taken independently of the legacy fields above.
    const modern = await svc.reserve({ userId: USER_ID, reserveReport: true });

    const result = await svc.repairIfPending(USER_ID);
    void result;

    const doc = pendingSyncModel._store.get(USER_ID);
    // Legacy evidence promoted/cleared -- both fields undefined (the ONLY
    // code path that clears them) and reportPending fully reconciled by
    // the same call's Tier-1 pass (default recompute stubs succeed).
    expect(doc.reservedReport).toBeUndefined();
    expect(doc.reservedUserWide).toBeUndefined();
    expect(doc.reportPending).toBe(false);
    // The modern array reservation is completely untouched by legacy
    // promotion -- still present, still owned by its own token.
    expect(doc.reservedReports).toHaveLength(1);
    expect(doc.reservedReports[0].token).toBe(modern.reportReservation.token);
  });
});

describe("Legacy PendingSync compatibility -- new-token confirm()/abandon() never touch legacy fields", () => {
  it("confirm() on a new array token leaves an untouched, non-stale legacy reservedReport exactly as-is", async () => {
    const { svc, pendingSyncModel } = loadRealService();
    const freshReservedAt = new Date(Date.now() - FRESH_RESERVED_AT_MS_AGO);
    seedLegacyDoc(pendingSyncModel, USER_ID, {
      reservedReport: { token: "untouched-legacy-tok", reservedAt: freshReservedAt },
    });

    const modern = await svc.reserve({ userId: USER_ID, reserveReport: true });
    await svc.confirm({ userId: USER_ID, confirmReport: true, reportToken: modern.reportReservation.token });

    const doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedReport).toEqual({ token: "untouched-legacy-tok", reservedAt: freshReservedAt });
    expect(doc.reservedReports).toHaveLength(0); // the modern token WAS released.
  });

  it("abandon() on a new array token leaves an untouched, non-stale legacy reservedUserWide exactly as-is", async () => {
    const { svc, pendingSyncModel } = loadRealService();
    const freshReservedAt = new Date(Date.now() - FRESH_RESERVED_AT_MS_AGO);
    seedLegacyDoc(pendingSyncModel, USER_ID, {
      reservedUserWide: { token: "untouched-legacy-uw-tok", reservedAt: freshReservedAt },
    });

    const modern = await svc.reserve({ userId: USER_ID, reserveUserWide: true });
    await svc.abandon({ userId: USER_ID, userWideToken: modern.userWideReservation.token });

    const doc = pendingSyncModel._store.get(USER_ID);
    expect(doc.reservedUserWide).toEqual({ token: "untouched-legacy-uw-tok", reservedAt: freshReservedAt });
    expect(doc.reservedUserWideReservations).toHaveLength(0);
  });
});
