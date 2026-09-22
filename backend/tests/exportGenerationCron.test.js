// DAT-004-T0X -- cron/exportGeneration.js's runExportGenerationJob.
//
// node-cron's own schedule() is not exercised here (no real clock/interval
// -- matches this codebase's other cron tests, which test the JOB BODY
// directly). ExportRequest, the generation service, the lease and the
// logger are all faked/mocked, the same pattern retryPush.itemClaim.test.js
// uses for its own per-item-claim job. fs/promises is mocked too, so this
// suite never touches the real generated-exports/ directory.
"use strict";

const CRON_PATH = "node-cron";
const EXPORT_REQUEST_PATH = "../models/ExportRequest";
const SERVICE_PATH = "../Services/ExportServices/exportGenerationService";
const LEASE_PATH = "../utils/jobLease";
const LOGGER_PATH = "../utils/logger";
const FS_PATH = "fs/promises";

// Real, un-mocked -- pure constants/helpers, no DB or network access, so
// there is no reason to fake this module's own contract.
const { EXPORT_STATUSES } = require("../utils/exportTypes");

// A minimal in-memory stand-in for the one Mongo behaviour the claim design
// depends on: findOneAndUpdate matching and updating a document ATOMICALLY,
// re-checking status at the moment of the update -- the same shape
// retryPush.itemClaim.test.js's buildStore uses for claimNotification.
function buildStore(docs) {
  const state = docs.map((d) => ({ ...d }));

  return {
    state,
    find: jest.fn(async (filter = {}) =>
      state.filter((d) => filter.status === undefined || d.status === filter.status).map((d) => ({ ...d }))
    ),
    findOneAndUpdate: jest.fn(async (filter) => {
      const doc = state.find((d) => String(d._id) === String(filter._id) && d.status === filter.status);
      if (!doc) return null;
      doc.status = EXPORT_STATUSES.PROCESSING;
      return { ...doc };
    }),
    updateOne: jest.fn(async (filter, update) => {
      const doc = state.find((d) => String(d._id) === String(filter._id));
      if (doc && update.$set) Object.assign(doc, update.$set);
      return { acknowledged: true };
    }),
  };
}

function queuedRequest(overrides = {}) {
  return {
    _id: "req1",
    userId: "user1",
    domain: "expenses",
    format: "json",
    dateFrom: null,
    dateTo: null,
    status: EXPORT_STATUSES.QUEUED,
    downloadToken: "tok1",
    ...overrides,
  };
}

function loadJob({ docs, generateImpl } = {}) {
  jest.resetModules();

  const store = buildStore(docs || []);
  const generateExportPayload = jest.fn(
    generateImpl || (async () => ({ content: "x", rowCount: 1, contentType: "application/json" }))
  );
  const mkdir = jest.fn(async () => {});
  const writeFile = jest.fn(async () => {});
  const scheduled = {};

  jest.doMock(CRON_PATH, () => ({
    schedule: (expr, handler) => {
      scheduled.handler = handler;
      return { stop: () => {} };
    },
  }));
  jest.doMock(EXPORT_REQUEST_PATH, () => store);
  jest.doMock(SERVICE_PATH, () => ({ generateExportPayload }));
  // The lease is not under test here (job-level lease behaviour belongs to
  // jobLease.test.js); run the body directly, same as retryPush's tests.
  jest.doMock(LEASE_PATH, () => ({
    runWithLease: async (_name, _ttl, fn) => {
      await fn({ isHeld: () => true });
      return { ran: true };
    },
  }));
  jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));
  jest.doMock(FS_PATH, () => ({ mkdir, writeFile }));

  const mod = require("../cron/exportGeneration");
  return { ...mod, store, generateExportPayload, mkdir, writeFile, run: () => scheduled.handler() };
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

describe("runExportGenerationJob -- claim, generate, mark ready", () => {
  test("claims a queued request, generates its payload, writes the file, and marks it ready", async () => {
    const { run, store, generateExportPayload, mkdir, writeFile } = loadJob({
      docs: [queuedRequest()],
      generateImpl: async () => ({ content: '{"a":1}', rowCount: 5, contentType: "application/json" }),
    });

    await run();

    expect(generateExportPayload).toHaveBeenCalledWith({
      userId: "user1",
      domain: "expenses",
      format: "json",
      dateFrom: null,
      dateTo: null,
    });
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(writeFile).toHaveBeenCalledTimes(1);

    const [filePath, content] = writeFile.mock.calls[0];
    expect(filePath).toContain("tok1.json");
    expect(content).toBe('{"a":1}');

    const updated = store.state[0];
    expect(updated.status).toBe(EXPORT_STATUSES.READY);
    expect(updated.rowCount).toBe(5);
    expect(updated.sizeBytes).toBe(Buffer.byteLength('{"a":1}', "utf8"));
    expect(updated.readyAt).toBeInstanceOf(Date);
    expect(updated.expiresAt).toBeInstanceOf(Date);
    expect(updated.expiresAt.getTime()).toBeGreaterThan(updated.readyAt.getTime());
    expect(updated.fileName).toMatch(/^balensia-export-expenses-/);
    expect(updated.errorMessage).toBeNull();
  });

  test("the claim moves status to 'processing' BEFORE generation runs", async () => {
    let statusDuringGeneration;
    const { run, store } = loadJob({
      docs: [queuedRequest()],
      generateImpl: async () => {
        statusDuringGeneration = store.state[0].status;
        return { content: "x", rowCount: 1, contentType: "application/json" };
      },
    });

    await run();

    expect(statusDuringGeneration).toBe(EXPORT_STATUSES.PROCESSING);
  });

  test("passes the request's own dateFrom/dateTo through to generateExportPayload unchanged", async () => {
    const dateFrom = new Date("2026-01-01");
    const dateTo = new Date("2026-01-31");
    const { run, generateExportPayload } = loadJob({
      docs: [queuedRequest({ domain: "income", format: "csv", dateFrom, dateTo })],
    });

    await run();

    expect(generateExportPayload).toHaveBeenCalledWith(
      expect.objectContaining({ domain: "income", format: "csv", dateFrom, dateTo })
    );
  });
});

describe("runExportGenerationJob -- claim-race protection", () => {
  test("skips an item another worker already claimed between the read and this worker's claim", async () => {
    const { run, store, generateExportPayload } = loadJob({ docs: [queuedRequest()] });

    // The interleaving that matters: this worker has already READ the
    // document (status "queued") when the other worker's claim lands --
    // same shape as retryPush.itemClaim.test.js's equivalent test.
    const realFind = store.find.getMockImplementation();
    store.find.mockImplementation(async (...args) => {
      const snapshot = await realFind(...args);
      store.state[0].status = EXPORT_STATUSES.PROCESSING; // the other worker wins, right here
      return snapshot;
    });

    await run();

    expect(generateExportPayload).not.toHaveBeenCalled();
    // Untouched by this run -- the claim belongs to the worker that won.
    expect(store.state[0].status).toBe(EXPORT_STATUSES.PROCESSING);
  });

  test("two concurrent runs over the same queued document generate it only once", async () => {
    jest.resetModules();
    const store = buildStore([queuedRequest()]);
    const generateExportPayload = jest.fn(async () => ({ content: "x", rowCount: 1, contentType: "application/json" }));
    const scheduled = [];

    jest.doMock(CRON_PATH, () => ({
      schedule: (expr, handler) => {
        scheduled.push(handler);
        return { stop: () => {} };
      },
    }));
    jest.doMock(EXPORT_REQUEST_PATH, () => store);
    jest.doMock(SERVICE_PATH, () => ({ generateExportPayload }));
    jest.doMock(LEASE_PATH, () => ({
      runWithLease: async (_n, _t, fn) => {
        await fn({ isHeld: () => true });
        return { ran: true };
      },
    }));
    jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));
    jest.doMock(FS_PATH, () => ({ mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => {}) }));

    require("../cron/exportGeneration");

    await Promise.all([scheduled[0](), scheduled[0]()]);

    expect(generateExportPayload).toHaveBeenCalledTimes(1);
    expect(store.state[0].status).toBe(EXPORT_STATUSES.READY);
  });
});

describe("runExportGenerationJob -- failure path", () => {
  test("a generation failure marks the request 'failed' with a sanitized message, never left at 'processing'", async () => {
    const { run, store } = loadJob({
      docs: [queuedRequest()],
      generateImpl: async () => {
        const err = new Error("mongo connection string exposed: mongodb://user:pass@host/db");
        err.code = "SOME_INTERNAL_CODE";
        throw err;
      },
    });

    await run();

    const updated = store.state[0];
    expect(updated.status).toBe(EXPORT_STATUSES.FAILED);
    expect(updated.status).not.toBe(EXPORT_STATUSES.PROCESSING);
    expect(updated.errorMessage).toBe("Export generation failed");
    expect(updated.errorMessage).not.toContain("mongodb://");
    expect(updated.errorMessage).not.toContain("user:pass");
  });

  test("a defensive TOO_MANY_ROWS failure also lands on 'failed', not stuck at 'processing'", async () => {
    const { run, store } = loadJob({
      docs: [queuedRequest()],
      generateImpl: async () => {
        const err = new Error("row count exceeds the maximum");
        err.code = "TOO_MANY_ROWS";
        throw err;
      },
    });

    await run();

    expect(store.state[0].status).toBe(EXPORT_STATUSES.FAILED);
  });

  test("a write failure (disk error) also fails the request rather than leaving it processing forever", async () => {
    jest.resetModules();
    const store = buildStore([queuedRequest()]);
    const generateExportPayload = jest.fn(async () => ({ content: "x", rowCount: 1, contentType: "application/json" }));
    const scheduled = {};

    jest.doMock(CRON_PATH, () => ({
      schedule: (expr, handler) => {
        scheduled.handler = handler;
        return { stop: () => {} };
      },
    }));
    jest.doMock(EXPORT_REQUEST_PATH, () => store);
    jest.doMock(SERVICE_PATH, () => ({ generateExportPayload }));
    jest.doMock(LEASE_PATH, () => ({
      runWithLease: async (_n, _t, fn) => {
        await fn({ isHeld: () => true });
        return { ran: true };
      },
    }));
    jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));
    jest.doMock(FS_PATH, () => ({
      mkdir: jest.fn(async () => {
        throw new Error("ENOSPC: no space left on device");
      }),
      writeFile: jest.fn(async () => {}),
    }));

    require("../cron/exportGeneration");
    await scheduled.handler();

    expect(store.state[0].status).toBe(EXPORT_STATUSES.FAILED);
    expect(store.state[0].errorMessage).toBe("Export generation failed");
  });
});

describe("runExportGenerationJob -- lease loss mid-run", () => {
  test("stops early once the lease is lost, leaving later queued items untouched", async () => {
    jest.resetModules();
    const store = buildStore([queuedRequest({ _id: "req1" }), queuedRequest({ _id: "req2" })]);
    const generateExportPayload = jest.fn(async () => ({ content: "x", rowCount: 1, contentType: "application/json" }));
    const scheduled = {};

    jest.doMock(CRON_PATH, () => ({
      schedule: (expr, handler) => {
        scheduled.handler = handler;
        return { stop: () => {} };
      },
    }));
    jest.doMock(EXPORT_REQUEST_PATH, () => store);
    jest.doMock(SERVICE_PATH, () => ({ generateExportPayload }));
    jest.doMock(LEASE_PATH, () => ({
      runWithLease: async (_n, _t, fn) => {
        await fn({ isHeld: () => false });
        return { ran: true };
      },
    }));
    jest.doMock(LOGGER_PATH, () => ({ logEvent: jest.fn() }));
    jest.doMock(FS_PATH, () => ({ mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => {}) }));

    require("../cron/exportGeneration");
    await scheduled.handler();

    expect(generateExportPayload).not.toHaveBeenCalled();
    expect(store.state[0].status).toBe(EXPORT_STATUSES.QUEUED);
    expect(store.state[1].status).toBe(EXPORT_STATUSES.QUEUED);
  });
});

describe("runExportGenerationJob -- exports", () => {
  test("exports runExportGenerationJob for direct testing, same pattern as cron/staleDeviceCleanup.js", () => {
    const { runExportGenerationJob } = loadJob({ docs: [] });
    expect(typeof runExportGenerationJob).toBe("function");
  });

  test("no queued requests -- a clean no-op run", async () => {
    const { run, generateExportPayload } = loadJob({ docs: [] });
    await expect(run()).resolves.toBeUndefined();
    expect(generateExportPayload).not.toHaveBeenCalled();
  });
});
