// DAT-004-T04 -- Services/ExportServices/exportRequestService.js.
//
// Exercised against a small in-memory fake ExportRequest model
// (create/find/findOne) and a mocked exportGenerationService, the same
// fast no-real-Mongo pattern exportGenerationService.test.js and
// recurringLifecycleService.test.js use. This suite proves the
// request-lifecycle orchestration (sync-vs-queued decision, row-limit
// enforcement BEFORE creation, ownership scoping on every read) -- not
// row counting/serialization, which is exportGenerationService's own,
// already-covered contract.
"use strict";

const EXPORT_REQUEST_MODEL_PATH = "../models/ExportRequest";
const GENERATION_SERVICE_PATH = "../Services/ExportServices/exportGenerationService";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";

const GENERATION_ERROR_CODES = Object.freeze({
  INVALID_DOMAIN: "INVALID_DOMAIN",
  INVALID_FORMAT: "INVALID_FORMAT",
  INVALID_COMBINATION: "INVALID_COMBINATION",
  TOO_MANY_ROWS: "TOO_MANY_ROWS",
});

function matches(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => String(doc[key]) === String(cond));
}

// Minimal in-memory stand-in for the three ExportRequest calls
// exportRequestService.js actually makes: create, find(...).sort().lean(),
// and findOne(...).lean(). Mirrors exportGenerationCron.test.js's own
// buildStore shape for the same model.
function buildStore(seedDocs = []) {
  let autoId = 1;
  const state = seedDocs.map((d) => ({ ...d }));

  return {
    state,
    create: jest.fn(async (doc) => {
      const created = { _id: `gen-${autoId++}`, createdAt: new Date(), ...doc };
      state.push(created);
      return { ...created };
    }),
    find: jest.fn((filter = {}) => ({
      sort: () => ({
        lean: async () => state.filter((d) => matches(d, filter)).map((d) => ({ ...d })),
      }),
    })),
    findOne: jest.fn((filter = {}) => ({
      lean: async () => {
        const doc = state.find((d) => matches(d, filter));
        return doc ? { ...doc } : null;
      },
    })),
  };
}

function loadService({ docs, countImpl, generateImpl } = {}) {
  jest.resetModules();
  const store = buildStore(docs || []);
  const countExportRows = jest.fn(countImpl || (async () => 0));
  const generateExportPayload = jest.fn(
    generateImpl || (async () => ({ content: "content", rowCount: 0, contentType: "application/json" }))
  );

  jest.doMock(EXPORT_REQUEST_MODEL_PATH, () => store);
  jest.doMock(GENERATION_SERVICE_PATH, () => ({
    countExportRows,
    generateExportPayload,
    ERROR_CODES: GENERATION_ERROR_CODES,
  }));

  const service = require("../Services/ExportServices/exportRequestService");
  return { service, store, countExportRows, generateExportPayload };
}

function readyRequest(overrides = {}) {
  const now = Date.now();
  return {
    _id: "req1",
    userId: USER_ID,
    domain: "expenses",
    format: "csv",
    status: "ready",
    downloadToken: "abc123token",
    filePath: "/generated-exports/abc123token.csv",
    fileName: "balensia-export-expenses.csv",
    rowCount: 10,
    sizeBytes: 100,
    readyAt: new Date(now - 1000),
    expiresAt: new Date(now + 60 * 60 * 1000),
    createdAt: new Date(now - 2000),
    errorMessage: null,
    ...overrides,
  };
}

afterEach(() => {
  jest.resetModules();
});

describe("createExportRequest -- validation", () => {
  test("rejects an invalid domain without creating anything or counting rows", async () => {
    const { service, store, countExportRows } = loadService();

    await expect(
      service.createExportRequest({ userId: USER_ID, domain: "not-a-domain", format: "csv" })
    ).rejects.toMatchObject({ code: "INVALID_DOMAIN" });

    expect(store.create).not.toHaveBeenCalled();
    expect(countExportRows).not.toHaveBeenCalled();
  });

  test("rejects an invalid format", async () => {
    const { service, store } = loadService();

    await expect(
      service.createExportRequest({ userId: USER_ID, domain: "expenses", format: "xml" })
    ).rejects.toMatchObject({ code: "INVALID_FORMAT" });

    expect(store.create).not.toHaveBeenCalled();
  });

  test('rejects domain "all" combined with format "csv"', async () => {
    const { service, store } = loadService();

    await expect(
      service.createExportRequest({ userId: USER_ID, domain: "all", format: "csv" })
    ).rejects.toMatchObject({ code: "INVALID_COMBINATION" });

    expect(store.create).not.toHaveBeenCalled();
  });
});

describe("createExportRequest -- row limit", () => {
  test("rejects a request whose row count exceeds MAX_EXPORT_ROWS, creating no ExportRequest and generating nothing", async () => {
    const { MAX_EXPORT_ROWS } = require("../utils/exportTypes");
    const { service, store, generateExportPayload } = loadService({
      countImpl: async () => MAX_EXPORT_ROWS + 1,
    });

    await expect(
      service.createExportRequest({ userId: USER_ID, domain: "expenses", format: "csv" })
    ).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });

    expect(store.create).not.toHaveBeenCalled();
    expect(generateExportPayload).not.toHaveBeenCalled();
  });
});

describe("createExportRequest -- sync path", () => {
  test("a row count of 0 is a valid empty export, generated synchronously", async () => {
    const { service, store, generateExportPayload } = loadService({
      countImpl: async () => 0,
      generateImpl: async () => ({ content: "[]", rowCount: 0, contentType: "application/json" }),
    });

    const result = await service.createExportRequest({ userId: USER_ID, domain: "expenses", format: "json" });

    expect(result.mode).toBe("sync");
    expect(result.rowCount).toBe(0);
    expect(result.content).toBe("[]");
    expect(result.fileName).toEqual(expect.stringContaining("expenses"));
    expect(generateExportPayload).toHaveBeenCalledTimes(1);
    expect(store.create).not.toHaveBeenCalled();
  });

  test("a row count below SYNC_ROW_LIMIT generates inline and creates no ExportRequest document", async () => {
    const { SYNC_ROW_LIMIT } = require("../utils/exportTypes");
    const { service, store } = loadService({
      countImpl: async () => SYNC_ROW_LIMIT - 1,
      generateImpl: async () => ({ content: "date,amount\r\n", rowCount: SYNC_ROW_LIMIT - 1, contentType: "text/csv" }),
    });

    const result = await service.createExportRequest({ userId: USER_ID, domain: "expenses", format: "csv" });

    expect(result.mode).toBe("sync");
    expect(result.contentType).toBe("text/csv");
    expect(store.create).not.toHaveBeenCalled();
  });
});

describe("createExportRequest -- queued path", () => {
  test("a row count at or above SYNC_ROW_LIMIT creates a queued ExportRequest with an unguessable token", async () => {
    const { SYNC_ROW_LIMIT } = require("../utils/exportTypes");
    const { service, store, generateExportPayload } = loadService({
      countImpl: async () => SYNC_ROW_LIMIT,
    });

    const result = await service.createExportRequest({ userId: USER_ID, domain: "income", format: "json" });

    expect(result.mode).toBe("queued");
    expect(result.status).toBe("queued");
    expect(result.domain).toBe("income");
    expect(result.format).toBe("json");
    expect(result.id).toBeDefined();
    expect(generateExportPayload).not.toHaveBeenCalled();

    expect(store.create).toHaveBeenCalledTimes(1);
    const createdDoc = store.create.mock.calls[0][0];
    expect(createdDoc.userId).toBe(USER_ID);
    expect(createdDoc.status).toBe("queued");
    // Token must be present, unguessable-length hex, and never equal to a
    // Mongo ObjectId-style value derived from userId/timestamp.
    expect(createdDoc.downloadToken).toMatch(/^[a-f0-9]{48}$/);
  });

  test("two queued requests get different downloadTokens", async () => {
    const { SYNC_ROW_LIMIT } = require("../utils/exportTypes");
    const { service, store } = loadService({ countImpl: async () => SYNC_ROW_LIMIT });

    await service.createExportRequest({ userId: USER_ID, domain: "income", format: "json" });
    await service.createExportRequest({ userId: USER_ID, domain: "income", format: "json" });

    const [first, second] = store.create.mock.calls.map((call) => call[0].downloadToken);
    expect(first).not.toEqual(second);
  });
});

describe("listExportRequests", () => {
  test("returns only the requesting user's own requests, in a client-safe shape", async () => {
    const { service } = loadService({
      docs: [
        readyRequest({ _id: "r1", userId: USER_ID }),
        readyRequest({ _id: "r2", userId: OTHER_USER_ID, downloadToken: "other-token" }),
      ],
    });

    const list = await service.listExportRequests({ userId: USER_ID });

    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("r1");
    expect(list[0].filePath).toBeUndefined();
    expect(list[0].downloadToken).toBeUndefined();
    expect(list[0].downloadUrl).toBe("/api/export/download/abc123token");
  });

  test("downloadUrl is null for a non-ready request", async () => {
    const { service } = loadService({
      docs: [readyRequest({ _id: "r1", userId: USER_ID, status: "queued", downloadToken: "tok" })],
    });

    const list = await service.listExportRequests({ userId: USER_ID });
    expect(list[0].downloadUrl).toBeNull();
  });
});

describe("getExportRequestStatus", () => {
  test("returns the safe shape for the owner's own request", async () => {
    const { service } = loadService({ docs: [readyRequest({ _id: "r1", userId: USER_ID })] });

    const status = await service.getExportRequestStatus({ userId: USER_ID, id: "r1" });
    expect(status.id).toBe("r1");
    expect(status.status).toBe("ready");
  });

  test("throws NOT_FOUND for a request owned by a different user", async () => {
    const { service } = loadService({ docs: [readyRequest({ _id: "r1", userId: OTHER_USER_ID })] });

    await expect(service.getExportRequestStatus({ userId: USER_ID, id: "r1" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("throws NOT_FOUND for a request id that does not exist", async () => {
    const { service } = loadService({ docs: [] });

    await expect(service.getExportRequestStatus({ userId: USER_ID, id: "does-not-exist" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("resolveDownload", () => {
  test("resolves filePath/fileName/contentType for the owner's ready, unexpired request", async () => {
    const { service } = loadService({
      docs: [readyRequest({ _id: "r1", userId: USER_ID, downloadToken: "good-token", format: "csv" })],
    });

    const result = await service.resolveDownload({ userId: USER_ID, token: "good-token" });
    expect(result.filePath).toBe("/generated-exports/abc123token.csv");
    expect(result.contentType).toBe("text/csv");
  });

  test("throws NOT_FOUND when the token belongs to a different user", async () => {
    const { service } = loadService({
      docs: [readyRequest({ _id: "r1", userId: OTHER_USER_ID, downloadToken: "good-token" })],
    });

    await expect(service.resolveDownload({ userId: USER_ID, token: "good-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("throws NOT_FOUND for a token that does not exist at all", async () => {
    const { service } = loadService({ docs: [] });

    await expect(service.resolveDownload({ userId: USER_ID, token: "made-up-token" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("throws NOT_FOUND for a request that is not yet ready", async () => {
    const { service } = loadService({
      docs: [readyRequest({ _id: "r1", userId: USER_ID, downloadToken: "tok", status: "processing" })],
    });

    await expect(service.resolveDownload({ userId: USER_ID, token: "tok" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("throws NOT_FOUND for a request that has expired", async () => {
    const { service } = loadService({
      docs: [
        readyRequest({
          _id: "r1",
          userId: USER_ID,
          downloadToken: "tok",
          expiresAt: new Date(Date.now() - 1000),
        }),
      ],
    });

    await expect(service.resolveDownload({ userId: USER_ID, token: "tok" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
