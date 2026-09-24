// DAT-004-T06 -- cron/exportCleanup.js's runExportCleanupJob.
//
// node-cron's own schedule() is not exercised here (no real clock/interval
// -- matches this codebase's other cron tests, which test the JOB BODY
// directly). ExportRequest, the lease and the logger are all
// faked/mocked, the same pattern tests/exportGenerationCron.test.js uses
// for its sibling job; fs/promises is mocked too, so this suite never
// touches the real generated-exports/ directory.
"use strict";

const CRON_PATH = "node-cron";
const EXPORT_REQUEST_PATH = "../models/ExportRequest";
const LEASE_PATH = "../utils/jobLease";
const LOGGER_PATH = "../utils/logger";
const FS_PATH = "fs/promises";

// Real, un-mocked -- pure constants, no DB or network access.
const { EXPORT_STATUSES } = require("../utils/exportTypes");

// A minimal in-memory stand-in for ExportRequest's find/updateOne, the
// same shape tests/exportGenerationCron.test.js's buildStore uses.
function buildStore(docs) {
  const state = docs.map((d) => ({ ...d }));

  return {
    state,
    find: jest.fn(async (filter = {}) =>
      state
        .filter((d) => {
          if (filter.status !== undefined && d.status !== filter.status) return false;
          if (filter.expiresAt && filter.expiresAt.$lte) {
            if (!(d.expiresAt instanceof Date) || d.expiresAt.getTime() > filter.expiresAt.$lte.getTime()) {
              return false;
            }
          }
          return true;
        })
        .map((d) => ({ ...d }))
    ),
    updateOne: jest.fn(async (filter, update) => {
      const doc = state.find((d) => String(d._id) === String(filter._id));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { acknowledged: true };
    }),
  };
}

function readyRequest(overrides = {}) {
  const now = Date.now();
  return {
    _id: "req1",
    userId: "user1",
    domain: "expenses",
    format: "json",
    status: EXPORT_STATUSES.READY,
    downloadToken: "tok1",
    filePath: "/tmp/generated-exports/tok1.json",
    fileName: "balensia-export-expenses-20260101-000000Z.json",
    rowCount: 5,
    readyAt: new Date(now - 25 * 60 * 60 * 1000),
    expiresAt: new Date(now - 60 * 60 * 1000), // expired an hour ago
    ...overrides,
  };
}

function loadJob({ docs, unlinkImpl } = {}) {
  jest.resetModules();

  const store = buildStore(docs || []);
  const unlink = jest.fn(unlinkImpl || (async () => {}));
  const scheduled = {};

  jest.doMock(CRON_PATH, () => ({
    schedule: (expr, handler) => {
      scheduled.handler = handler;
      return { stop: () => {} };
    },
  }));
  jest.doMock(EXPORT_REQUEST_PATH, () => store);
  // The lease is not under test here (job-level lease behaviour belongs to
  // jobLease.test.js); run the body directly, same as the sibling
  // exportGeneration/retryPush tests.
  jest.doMock(LEASE_PATH, () => ({
    runWithLease: async (_name, _ttl, fn) => {
      await fn({ isHeld: () => true });
      return { ran: true };
    },
  }));
  jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));
  jest.doMock(FS_PATH, () => ({ unlink }));

  const mod = require("../cron/exportCleanup");
  return { ...mod, store, unlink, run: () => scheduled.handler() };
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

describe("runExportCleanupJob -- deletes an expired ready export", () => {
  test("deletes the file and marks the request expired with filePath nulled", async () => {
    const { run, store, unlink } = loadJob({ docs: [readyRequest()] });

    await run();

    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith("/tmp/generated-exports/tok1.json");

    const updated = store.state[0];
    expect(updated.status).toBe(EXPORT_STATUSES.EXPIRED);
    expect(updated.filePath).toBeNull();
    // Historical fields are preserved, not nulled.
    expect(updated.fileName).toBe("balensia-export-expenses-20260101-000000Z.json");
    expect(updated.rowCount).toBe(5);
    expect(updated.expiresAt).toBeInstanceOf(Date);
    expect(updated.readyAt).toBeInstanceOf(Date);
  });
});

describe("runExportCleanupJob -- leaves non-expired requests alone", () => {
  test("a ready request whose expiresAt is still in the future is untouched", async () => {
    const notYetExpired = readyRequest({
      _id: "req2",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // expires an hour from now
    });
    const { run, store, unlink } = loadJob({ docs: [notYetExpired] });

    await run();

    expect(unlink).not.toHaveBeenCalled();
    expect(store.state[0].status).toBe(EXPORT_STATUSES.READY);
    expect(store.state[0].filePath).toBe("/tmp/generated-exports/tok1.json");
  });
});

describe("runExportCleanupJob -- idempotent against a file already gone", () => {
  test("an expired request whose file is already missing (ENOENT) still gets marked expired without throwing", async () => {
    const { run, store, unlink } = loadJob({
      docs: [readyRequest()],
      unlinkImpl: async () => {
        const err = new Error("no such file or directory");
        err.code = "ENOENT";
        throw err;
      },
    });

    await expect(run()).resolves.toBeUndefined();

    expect(unlink).toHaveBeenCalledTimes(1);
    const updated = store.state[0];
    expect(updated.status).toBe(EXPORT_STATUSES.EXPIRED);
    expect(updated.filePath).toBeNull();
  });
});

describe("runExportCleanupJob -- request with no filePath", () => {
  test("a doc with filePath null is marked expired without attempting a filesystem call", async () => {
    const { run, store, unlink } = loadJob({
      docs: [readyRequest({ filePath: null })],
    });

    await run();

    expect(unlink).not.toHaveBeenCalled();
    const updated = store.state[0];
    expect(updated.status).toBe(EXPORT_STATUSES.EXPIRED);
    expect(updated.filePath).toBeNull();
  });
});

describe("runExportCleanupJob -- fail-open per item", () => {
  test("one item throwing a non-ENOENT deletion error does not stop the rest of the batch", async () => {
    const failing = readyRequest({ _id: "req1", filePath: "/tmp/generated-exports/tok1.json" });
    const okay = readyRequest({ _id: "req2", filePath: "/tmp/generated-exports/tok2.json" });

    const { run, store, unlink } = loadJob({
      docs: [failing, okay],
      unlinkImpl: async (filePath) => {
        if (filePath === "/tmp/generated-exports/tok1.json") {
          const err = new Error("permission denied");
          err.code = "EACCES";
          throw err;
        }
      },
    });

    await expect(run()).resolves.toBeUndefined();

    expect(unlink).toHaveBeenCalledTimes(2);

    // The failing item is left as "ready" so a later sweep retries the
    // delete rather than orphaning its file by clearing filePath anyway.
    const failedDoc = store.state.find((d) => d._id === "req1");
    expect(failedDoc.status).toBe(EXPORT_STATUSES.READY);
    expect(failedDoc.filePath).toBe("/tmp/generated-exports/tok1.json");

    // The rest of the batch still gets processed.
    const okDoc = store.state.find((d) => d._id === "req2");
    expect(okDoc.status).toBe(EXPORT_STATUSES.EXPIRED);
    expect(okDoc.filePath).toBeNull();
  });

  test("does not throw when the DB query itself fails", async () => {
    jest.resetModules();
    jest.doMock(CRON_PATH, () => ({ schedule: jest.fn() }));
    jest.doMock(EXPORT_REQUEST_PATH, () => ({
      find: jest.fn(async () => {
        throw new Error("db down");
      }),
      updateOne: jest.fn(),
    }));
    jest.doMock(LEASE_PATH, () => ({
      runWithLease: async (_n, _t, fn) => {
        await fn({ isHeld: () => true });
        return { ran: true };
      },
    }));
    jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));
    jest.doMock(FS_PATH, () => ({ unlink: jest.fn() }));

    const { runExportCleanupJob } = require("../cron/exportCleanup");
    await expect(runExportCleanupJob({ isHeld: () => true })).resolves.toBeUndefined();
  });
});

describe("runExportCleanupJob -- lease loss mid-run", () => {
  test("stops early once the lease is lost, leaving later expired items untouched", async () => {
    jest.resetModules();
    const store = buildStore([
      readyRequest({ _id: "req1" }),
      readyRequest({ _id: "req2" }),
    ]);
    const unlink = jest.fn(async () => {});
    const scheduled = {};

    jest.doMock(CRON_PATH, () => ({
      schedule: (expr, handler) => {
        scheduled.handler = handler;
        return { stop: () => {} };
      },
    }));
    jest.doMock(EXPORT_REQUEST_PATH, () => store);
    jest.doMock(LEASE_PATH, () => ({
      runWithLease: async (_n, _t, fn) => {
        await fn({ isHeld: () => false });
        return { ran: true };
      },
    }));
    jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));
    jest.doMock(FS_PATH, () => ({ unlink }));

    require("../cron/exportCleanup");
    await scheduled.handler();

    expect(unlink).not.toHaveBeenCalled();
    expect(store.state[0].status).toBe(EXPORT_STATUSES.READY);
    expect(store.state[1].status).toBe(EXPORT_STATUSES.READY);
  });
});

describe("runExportCleanupJob -- exports", () => {
  test("exports runExportCleanupJob for direct testing, same pattern as cron/staleDeviceCleanup.js", () => {
    const { runExportCleanupJob } = loadJob({ docs: [] });
    expect(typeof runExportCleanupJob).toBe("function");
  });

  test("no expired requests -- a clean no-op run", async () => {
    const { run, unlink } = loadJob({ docs: [] });
    await expect(run()).resolves.toBeUndefined();
    expect(unlink).not.toHaveBeenCalled();
  });
});
