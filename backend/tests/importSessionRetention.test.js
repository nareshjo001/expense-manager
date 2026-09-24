// IMP-001 -- cron/importSessionRetention.js's runImportSessionRetentionJob.
//
// Same testing posture as tests/receiptRetention.test.js: the job BODY is
// exercised directly against an in-memory fake of ImportSession's
// find/findOneAndUpdate, node-cron's own schedule() is never exercised
// (no real clock), and the lease/logger are faked.
"use strict";

const CRON_PATH = "node-cron";
const IMPORT_SESSION_MODEL_PATH = "../models/ImportSession";
const LEASE_PATH = "../utils/jobLease";
const LOGGER_PATH = "../utils/logger";

const {
  IMPORT_SESSION_RETENTION_HOURS,
  IMPORT_SESSION_STATUSES,
  isSessionEligibleForRetentionSweep,
} = require("../utils/importTypes");

const HOUR_MS = 60 * 60 * 1000;
const RETENTION_MS = IMPORT_SESSION_RETENTION_HOURS * HOUR_MS;

// A minimal in-memory stand-in for ImportSession's find/findOneAndUpdate,
// the same shape tests/receiptRetention.test.js's buildStore uses -- plus
// an optional hook fired right before findOneAndUpdate's match check, used
// to simulate a concurrent commit happening between the batch find() and
// this item's per-item update.
function buildStore(docs, { onFindOneAndUpdate } = {}) {
  const state = docs.map((d) => ({ ...d }));

  function matches(d, filter) {
    if (filter._id !== undefined && String(d._id) !== String(filter._id)) return false;
    if (filter.status && filter.status.$in) {
      if (!filter.status.$in.includes(d.status)) return false;
    }
    if (filter.createdAt !== undefined) {
      if (new Date(d.createdAt).getTime() !== new Date(filter.createdAt).getTime()) return false;
    }
    return true;
  }

  return {
    state,
    find: jest.fn(async (filter = {}) => state.filter((d) => matches(d, filter)).map((d) => ({ ...d }))),
    findOneAndUpdate: jest.fn(async (filter = {}, update = {}) => {
      if (onFindOneAndUpdate) onFindOneAndUpdate(filter, state);
      const idx = state.findIndex((d) => matches(d, filter));
      if (idx === -1) return null;
      Object.assign(state[idx], update.$set || {});
      return { ...state[idx] };
    }),
  };
}

function previewingSession(overrides = {}) {
  return {
    _id: "session1",
    userId: "user1",
    status: IMPORT_SESSION_STATUSES.PREVIEWING,
    createdAt: new Date(Date.now() - RETENTION_MS - HOUR_MS), // clearly past the window
    ...overrides,
  };
}

function loadJob({ docs, onFindOneAndUpdate } = {}) {
  jest.resetModules();

  const store = buildStore(docs || [], { onFindOneAndUpdate });
  const scheduled = {};

  jest.doMock(CRON_PATH, () => ({
    schedule: (expr, handler) => {
      scheduled.expr = expr;
      scheduled.handler = handler;
      return { stop: () => {} };
    },
  }));
  jest.doMock(IMPORT_SESSION_MODEL_PATH, () => store);

  const leaseState = { held: true };
  jest.doMock(LEASE_PATH, () => ({
    runWithLease: async (name, ttl, fn) => fn({ isHeld: () => leaseState.held }),
  }));

  const logEvent = jest.fn();
  jest.doMock(LOGGER_PATH, () => ({ logEvent }));

  const mod = require("../cron/importSessionRetention");
  return { mod, store, scheduled, logEvent, leaseState };
}

describe("runImportSessionRetentionJob", () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  test("registers a daily 07:00 cron schedule", () => {
    const { scheduled } = loadJob({ docs: [] });
    expect(scheduled.expr).toBe("0 7 * * *");
  });

  test("expires an eligible previewing session past the retention window", async () => {
    const { mod, store } = loadJob({ docs: [previewingSession()] });
    await mod.runImportSessionRetentionJob({ isHeld: () => true });
    expect(store.state[0].status).toBe(IMPORT_SESSION_STATUSES.EXPIRED);
  });

  test("expires an eligible committing session past the retention window (crash recovery)", async () => {
    const { mod, store } = loadJob({
      docs: [previewingSession({ status: IMPORT_SESSION_STATUSES.COMMITTING })],
    });
    await mod.runImportSessionRetentionJob({ isHeld: () => true });
    expect(store.state[0].status).toBe(IMPORT_SESSION_STATUSES.EXPIRED);
  });

  test("does not touch a fresh previewing session (within the window)", async () => {
    const fresh = previewingSession({ createdAt: new Date() });
    const { mod, store } = loadJob({ docs: [fresh] });
    await mod.runImportSessionRetentionJob({ isHeld: () => true });
    expect(store.state[0].status).toBe(IMPORT_SESSION_STATUSES.PREVIEWING);
  });

  test("never queries/touches an already-committed or already-expired session", async () => {
    const committed = previewingSession({
      _id: "c1",
      status: IMPORT_SESSION_STATUSES.COMMITTED,
    });
    const expired = previewingSession({
      _id: "e1",
      status: IMPORT_SESSION_STATUSES.EXPIRED,
    });
    const { mod, store } = loadJob({ docs: [committed, expired] });
    await mod.runImportSessionRetentionJob({ isHeld: () => true });
    // The query itself excludes these statuses -- find() never returns them.
    expect(store.find).toHaveBeenCalledWith({
      status: { $in: [IMPORT_SESSION_STATUSES.PREVIEWING, IMPORT_SESSION_STATUSES.COMMITTING] },
    });
    expect(store.state[0].status).toBe(IMPORT_SESSION_STATUSES.COMMITTED);
    expect(store.state[1].status).toBe(IMPORT_SESSION_STATUSES.EXPIRED);
  });

  test("a race (session committed between find() and the per-item update) is skipped, not overwritten", async () => {
    const session = previewingSession();
    const { mod, store, logEvent } = loadJob({
      docs: [session],
      onFindOneAndUpdate: (filter, state) => {
        // Simulate a commit landing in the gap between batch find() and
        // this item's atomic re-check.
        state[0].status = IMPORT_SESSION_STATUSES.COMMITTED;
      },
    });
    await mod.runImportSessionRetentionJob({ isHeld: () => true });
    expect(store.state[0].status).toBe(IMPORT_SESSION_STATUSES.COMMITTED);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: "swept", recheckSkippedCount: 1, expiredCount: 0 })
    );
  });

  test("stops early once the lease is lost mid-run", async () => {
    const { mod, store } = loadJob({
      docs: [previewingSession({ _id: "s1" }), previewingSession({ _id: "s2" })],
    });
    let calls = 0;
    const lease = {
      isHeld: () => {
        calls += 1;
        return calls === 1; // held for the first item only
      },
    };
    await mod.runImportSessionRetentionJob(lease);
    // Only one of the two sessions gets processed before the loop breaks.
    const expiredCount = store.state.filter((d) => d.status === IMPORT_SESSION_STATUSES.EXPIRED).length;
    expect(expiredCount).toBeLessThan(2);
  });

  test("real isSessionEligibleForRetentionSweep agrees this fixture is eligible", () => {
    const now = new Date();
    expect(isSessionEligibleForRetentionSweep(previewingSession(), now)).toBe(true);
  });

  test("swallows an unexpected error and logs via console.error rather than throwing", async () => {
    jest.resetModules();
    jest.doMock(CRON_PATH, () => ({ schedule: () => ({ stop: () => {} }) }));
    jest.doMock(IMPORT_SESSION_MODEL_PATH, () => ({
      find: jest.fn(async () => {
        throw new Error("boom");
      }),
    }));
    jest.doMock(LEASE_PATH, () => ({
      runWithLease: async (name, ttl, fn) => fn({ isHeld: () => true }),
    }));
    jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const mod = require("../cron/importSessionRetention");
    await expect(mod.runImportSessionRetentionJob({ isHeld: () => true })).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith("Import session retention cron failed.");
  });
});
