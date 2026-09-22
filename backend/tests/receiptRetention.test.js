// OCR-004-T07 -- cron/receiptRetention.js's runReceiptRetentionJob.
//
// node-cron's own schedule() is not exercised here (no real clock/interval
// -- matches this codebase's other cron tests, which test the JOB BODY
// directly, see tests/exportCleanup.test.js). The Receipt model, the
// storage adapter, the lease and the logger are all faked/mocked.
//
// Services/ReceiptServices/receiptStorageAdapter.js is being built by a
// parallel task and may not exist on disk yet, so it is mocked with
// { virtual: true } -- this suite does not depend on that file's real
// presence, only on its documented signature,
// async deleteReceiptObject(storageKey), idempotent for an already-gone
// object (resolves, never throws for that case).
"use strict";

const CRON_PATH = "node-cron";
const RECEIPT_MODEL_PATH = "../models/Receipt";
const STORAGE_ADAPTER_PATH = "../Services/ReceiptServices/receiptStorageAdapter";
const LEASE_PATH = "../utils/jobLease";
const LOGGER_PATH = "../utils/logger";

// Real, un-mocked -- pure constants/functions, no DB or network access.
// Fixtures below are built FROM these so this suite would fail if
// receiptLifecycle.js's own retention rule ever drifted from what this
// cron's Mongo query encodes.
const {
  RECEIPT_UNLINKED_RETENTION_DAYS,
  isEligibleForRetentionSweep,
} = require("../utils/receiptLifecycle");

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = RECEIPT_UNLINKED_RETENTION_DAYS * DAY_MS;

// A minimal in-memory stand-in for Receipt's find/findOneAndDelete, the
// same shape tests/exportCleanup.test.js's buildStore uses -- plus an
// optional hook fired right before findOneAndDelete's match check, used
// by the race-condition test to simulate a concurrent link happening
// between the batch find() and this item's per-item delete.
function buildStore(docs, { onFindOneAndDelete } = {}) {
  const state = docs.map((d) => ({ ...d }));

  function matches(d, filter) {
    if (filter._id !== undefined && String(d._id) !== String(filter._id)) return false;
    if (filter.linkedExpenseId !== undefined && d.linkedExpenseId !== filter.linkedExpenseId) {
      return false;
    }
    if (filter.uploadedAt && filter.uploadedAt.$lte) {
      if (!(d.uploadedAt instanceof Date) || d.uploadedAt.getTime() > filter.uploadedAt.$lte.getTime()) {
        return false;
      }
    }
    return true;
  }

  return {
    state,
    find: jest.fn(async (filter = {}) => state.filter((d) => matches(d, filter)).map((d) => ({ ...d }))),
    findOneAndDelete: jest.fn(async (filter = {}) => {
      if (onFindOneAndDelete) onFindOneAndDelete(filter, state);
      const idx = state.findIndex((d) => matches(d, filter));
      if (idx === -1) return null;
      const [removed] = state.splice(idx, 1);
      return { ...removed };
    }),
  };
}

function unlinkedReceipt(overrides = {}) {
  return {
    _id: "receipt1",
    userId: "user1",
    storageKey: "gridfs-key-1",
    linkedExpenseId: null,
    uploadedAt: new Date(Date.now() - RETENTION_MS - DAY_MS), // clearly past the window
    ...overrides,
  };
}

function loadJob({ docs, deleteReceiptObjectImpl, onFindOneAndDelete } = {}) {
  jest.resetModules();

  const store = buildStore(docs || [], { onFindOneAndDelete });
  const deleteReceiptObject = jest.fn(deleteReceiptObjectImpl || (async () => {}));
  const scheduled = {};

  jest.doMock(CRON_PATH, () => ({
    schedule: (expr, handler) => {
      scheduled.expr = expr;
      scheduled.handler = handler;
      return { stop: () => {} };
    },
  }));
  jest.doMock(RECEIPT_MODEL_PATH, () => store);
  jest.doMock(
    STORAGE_ADAPTER_PATH,
    () => ({ deleteReceiptObject }),
    { virtual: true }
  );
  // The lease is not under test here (job-level lease behaviour belongs to
  // jobLease.test.js); run the body directly, same as the sibling
  // exportCleanup/retryPush tests.
  jest.doMock(LEASE_PATH, () => ({
    runWithLease: async (_name, _ttl, fn) => {
      await fn({ isHeld: () => true });
      return { ran: true };
    },
  }));
  jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));

  const mod = require("../cron/receiptRetention");
  return { ...mod, store, deleteReceiptObject, scheduledExpr: () => scheduled.expr, run: () => scheduled.handler() };
}

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("runReceiptRetentionJob -- deletes an eligible unlinked receipt", () => {
  test("an unlinked receipt past the retention window gets its storage object deleted and its document removed", async () => {
    const receipt = unlinkedReceipt();
    expect(isEligibleForRetentionSweep(receipt, new Date())).toBe(true);

    const { run, store, deleteReceiptObject } = loadJob({ docs: [receipt] });

    await run();

    expect(deleteReceiptObject).toHaveBeenCalledTimes(1);
    expect(deleteReceiptObject).toHaveBeenCalledWith("gridfs-key-1");
    expect(store.state.find((d) => d._id === "receipt1")).toBeUndefined();
  });
});

describe("runReceiptRetentionJob -- leaves a not-yet-eligible receipt alone", () => {
  test("an unlinked receipt NOT yet past the retention window is left untouched", async () => {
    const notYetEligible = unlinkedReceipt({
      _id: "receipt2",
      uploadedAt: new Date(Date.now() - DAY_MS), // one day old, nowhere near 90
    });
    expect(isEligibleForRetentionSweep(notYetEligible, new Date())).toBe(false);

    const { run, store, deleteReceiptObject } = loadJob({ docs: [notYetEligible] });

    await run();

    expect(deleteReceiptObject).not.toHaveBeenCalled();
    expect(store.state).toHaveLength(1);
    expect(store.state[0]._id).toBe("receipt2");
  });
});

describe("runReceiptRetentionJob -- a linked receipt is never touched", () => {
  test("a linked receipt, however old, is NEVER swept even though it would otherwise be past the window", async () => {
    const linkedButAncient = unlinkedReceipt({
      _id: "receipt3",
      linkedExpenseId: "expense-1",
      uploadedAt: new Date(Date.now() - RETENTION_MS * 10),
    });
    // Built from and verified against the real receiptLifecycle rule, not
    // a hand-rolled duplicate of it -- this assertion (and the fixture it
    // guards) would fail on its own if that rule's linked-receipt
    // exclusion ever drifted.
    expect(isEligibleForRetentionSweep(linkedButAncient, new Date())).toBe(false);

    const { run, store, deleteReceiptObject } = loadJob({ docs: [linkedButAncient] });

    await run();

    expect(deleteReceiptObject).not.toHaveBeenCalled();
    expect(store.state).toHaveLength(1);
    expect(store.state[0]._id).toBe("receipt3");
  });
});

describe("runReceiptRetentionJob -- idempotent against an already-gone storage object", () => {
  test("a receipt whose GridFS object is already gone still gets its document removed without the job throwing", async () => {
    // deleteReceiptObject is documented idempotent: an already-gone
    // object is a successful no-op, i.e. it resolves rather than throws.
    const receipt = unlinkedReceipt({ _id: "receipt4", storageKey: "already-gone-key" });

    const { run, store, deleteReceiptObject } = loadJob({
      docs: [receipt],
      deleteReceiptObjectImpl: async () => undefined,
    });

    await expect(run()).resolves.toBeUndefined();

    expect(deleteReceiptObject).toHaveBeenCalledWith("already-gone-key");
    expect(store.state.find((d) => d._id === "receipt4")).toBeUndefined();
  });
});

describe("runReceiptRetentionJob -- fail-open per item on a genuine storage failure", () => {
  test("one item's non-idempotent-covered storage delete failure leaves that document untouched and does not stop the rest of the batch", async () => {
    const failing = unlinkedReceipt({ _id: "receiptFail", storageKey: "key-fail" });
    const okay = unlinkedReceipt({ _id: "receiptOk", storageKey: "key-ok" });

    const { run, store, deleteReceiptObject } = loadJob({
      docs: [failing, okay],
      deleteReceiptObjectImpl: async (storageKey) => {
        if (storageKey === "key-fail") {
          throw new Error("gridfs connection lost");
        }
      },
    });

    await expect(run()).resolves.toBeUndefined();

    expect(deleteReceiptObject).toHaveBeenCalledTimes(2);

    // The failing item's document is left alone so a later sweep retries.
    const stillThere = store.state.find((d) => d._id === "receiptFail");
    expect(stillThere).toBeDefined();
    expect(stillThere.storageKey).toBe("key-fail");

    // The rest of the batch still gets processed.
    expect(store.state.find((d) => d._id === "receiptOk")).toBeUndefined();
  });

  test("does not throw when the DB query itself fails", async () => {
    jest.resetModules();
    jest.doMock(CRON_PATH, () => ({ schedule: jest.fn() }));
    jest.doMock(RECEIPT_MODEL_PATH, () => ({
      find: jest.fn(async () => {
        throw new Error("db down");
      }),
      findOneAndDelete: jest.fn(),
    }));
    jest.doMock(
      STORAGE_ADAPTER_PATH,
      () => ({ deleteReceiptObject: jest.fn() }),
      { virtual: true }
    );
    jest.doMock(LEASE_PATH, () => ({
      runWithLease: async (_n, _t, fn) => {
        await fn({ isHeld: () => true });
        return { ran: true };
      },
    }));
    jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));

    const { runReceiptRetentionJob } = require("../cron/receiptRetention");
    await expect(runReceiptRetentionJob({ isHeld: () => true })).resolves.toBeUndefined();
  });
});

describe("runReceiptRetentionJob -- lease loss mid-run", () => {
  test("stops early once the lease is lost, leaving later eligible items untouched", async () => {
    jest.resetModules();
    const store = buildStore([
      unlinkedReceipt({ _id: "receiptA" }),
      unlinkedReceipt({ _id: "receiptB" }),
    ]);
    const deleteReceiptObject = jest.fn(async () => {});
    const scheduled = {};

    jest.doMock(CRON_PATH, () => ({
      schedule: (expr, handler) => {
        scheduled.handler = handler;
        return { stop: () => {} };
      },
    }));
    jest.doMock(RECEIPT_MODEL_PATH, () => store);
    jest.doMock(
      STORAGE_ADAPTER_PATH,
      () => ({ deleteReceiptObject }),
      { virtual: true }
    );
    jest.doMock(LEASE_PATH, () => ({
      runWithLease: async (_n, _t, fn) => {
        await fn({ isHeld: () => false });
        return { ran: true };
      },
    }));
    jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));

    require("../cron/receiptRetention");
    await scheduled.handler();

    expect(deleteReceiptObject).not.toHaveBeenCalled();
    expect(store.state).toHaveLength(2);
  });
});

describe("runReceiptRetentionJob -- race condition: relinked between find() and per-item delete", () => {
  test("a receipt that got linked between the initial find and the per-item delete is NOT deleted", async () => {
    const receipt = unlinkedReceipt({ _id: "receiptRace", storageKey: "key-race" });

    const { run, store, deleteReceiptObject } = loadJob({
      docs: [receipt],
      // Simulate a user linking the receipt to an expense in the window
      // between the batch find() (which already returned this doc as
      // unlinked) and this item's per-item findOneAndDelete re-check.
      onFindOneAndDelete: (filter, state) => {
        const doc = state.find((d) => String(d._id) === String(filter._id));
        if (doc) doc.linkedExpenseId = "expense-just-linked";
      },
    });

    await run();

    // The CAS-guarded findOneAndDelete must not match once linkedExpenseId
    // is no longer null, so the document survives (now correctly linked,
    // not deleted).
    const survivor = store.state.find((d) => d._id === "receiptRace");
    expect(survivor).toBeDefined();
    expect(survivor.linkedExpenseId).toBe("expense-just-linked");
  });
});

describe("runReceiptRetentionJob -- schedule and exports", () => {
  test("is scheduled daily at a slot that does not collide with the other daily jobs (03:00/04:00/05:00 are already taken)", () => {
    const { scheduledExpr } = loadJob({ docs: [] });
    const expr = scheduledExpr();
    expect(expr).toMatch(/^\d+ \d+ \* \* \*$/);
    expect(["0 3 * * *", "0 4 * * *", "0 5 * * *"]).not.toContain(expr);
  });

  test("exports runReceiptRetentionJob for direct testing, same pattern as cron/exportCleanup.js", () => {
    const { runReceiptRetentionJob } = loadJob({ docs: [] });
    expect(typeof runReceiptRetentionJob).toBe("function");
  });

  test("no eligible receipts -- a clean no-op run", async () => {
    const { run, deleteReceiptObject } = loadJob({ docs: [] });
    await expect(run()).resolves.toBeUndefined();
    expect(deleteReceiptObject).not.toHaveBeenCalled();
  });
});
