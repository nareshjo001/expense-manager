// DAT-004-T04 -- Controllers/Export/{create,list,status,download}.js.
// Same fast controller-unit-test pattern as
// notificationPreferencesControllers.test.js -- the service (and, for
// download.js, fs/promises) is mocked so this file proves only the HTTP
// mapping (status codes, response shape, headers), not the business rules
// (already covered by exportRequestService.test.js).
"use strict";

const SERVICE_PATH = "../Services/ExportServices/exportRequestService";
const FS_PATH = "fs/promises";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";

const ERROR_CODES = Object.freeze({
  INVALID_DOMAIN: "INVALID_DOMAIN",
  INVALID_FORMAT: "INVALID_FORMAT",
  INVALID_COMBINATION: "INVALID_COMBINATION",
  TOO_MANY_ROWS: "TOO_MANY_ROWS",
  NOT_FOUND: "NOT_FOUND",
});

function makeError(code, message = "err") {
  const err = new Error(message);
  err.code = code;
  return err;
}

const makeReq = (overrides = {}) => ({ body: {}, params: {}, userId: USER_ID, ...overrides });

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  res.setHeader = jest.fn();
  return res;
};

const jsonBody = (res) => res.json.mock.calls[0][0];

function loadControllers(serviceMock = {}, fsMock = {}) {
  jest.resetModules();
  // Real `mongoose` is measurably slow to require in this sandbox (~50s --
  // confirmed directly, same cost recurringLifecycleControllers.test.js's
  // header comment documents for `require("../app")`), so status.js's
  // ObjectId.isValid check is exercised against the same lightweight fake
  // recurringLifecycleControllers.test.js already uses for the identical
  // purpose, not the real package.
  jest.doMock("mongoose", () => ({
    Types: { ObjectId: { isValid: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) } },
  }));
  jest.doMock(SERVICE_PATH, () => ({
    createExportRequest: jest.fn(),
    listExportRequests: jest.fn(),
    getExportRequestStatus: jest.fn(),
    resolveDownload: jest.fn(),
    ERROR_CODES,
    ...serviceMock,
  }));
  jest.doMock(FS_PATH, () => ({ readFile: jest.fn(), ...fsMock }));
  return {
    create: require("../Controllers/Export/create"),
    list: require("../Controllers/Export/list"),
    status: require("../Controllers/Export/status"),
    download: require("../Controllers/Export/download"),
  };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("createExport", () => {
  test("400s with MISSING_FIELDS when domain or format is absent", async () => {
    const { create } = loadControllers();
    const res = makeRes();

    await create.createExport(makeReq({ body: { domain: "expenses" } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(jsonBody(res).errorCode).toBe("MISSING_FIELDS");
  });

  test("400s with INVALID_DATE for an unparseable dateFrom", async () => {
    const { create } = loadControllers();
    const res = makeRes();

    await create.createExport(
      makeReq({ body: { domain: "expenses", format: "csv", dateFrom: "not-a-date" } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(jsonBody(res).errorCode).toBe("INVALID_DATE");
  });

  test("200s with the file content and attachment headers on a sync export", async () => {
    const createExportRequest = jest.fn().mockResolvedValue({
      mode: "sync",
      content: "date,amount\r\n",
      contentType: "text/csv",
      fileName: "balensia-export-expenses-x.csv",
      rowCount: 3,
    });
    const { create } = loadControllers({ createExportRequest });
    const res = makeRes();

    await create.createExport(makeReq({ body: { domain: "expenses", format: "csv" } }), res);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="balensia-export-expenses-x.csv"'
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith("date,amount\r\n");
  });

  test("202s with queued status/id on a queued export, never including filePath", async () => {
    const createExportRequest = jest.fn().mockResolvedValue({
      mode: "queued",
      id: "req123",
      status: "queued",
      domain: "expenses",
      format: "csv",
    });
    const { create } = loadControllers({ createExportRequest });
    const res = makeRes();

    await create.createExport(makeReq({ body: { domain: "expenses", format: "csv" } }), res);

    expect(res.status).toHaveBeenCalledWith(202);
    const body = jsonBody(res);
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ id: "req123", status: "queued", domain: "expenses", format: "csv", expiresAt: null });
    expect(body.data.filePath).toBeUndefined();
  });

  test.each([
    ["INVALID_DOMAIN"],
    ["INVALID_FORMAT"],
    ["INVALID_COMBINATION"],
    ["TOO_MANY_ROWS"],
  ])("400s with errorCode %s when the service rejects the request", async (code) => {
    const createExportRequest = jest.fn().mockRejectedValue(makeError(code));
    const { create } = loadControllers({ createExportRequest });
    const res = makeRes();

    await create.createExport(makeReq({ body: { domain: "all", format: "csv" } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(jsonBody(res).errorCode).toBe(code);
    expect(jsonBody(res).success).toBe(false);
  });

  test("500s on an unexpected error without leaking the error message", async () => {
    const createExportRequest = jest.fn().mockRejectedValue(new Error("db exploded, connection string xyz"));
    const { create } = loadControllers({ createExportRequest });
    const res = makeRes();

    await create.createExport(makeReq({ body: { domain: "expenses", format: "csv" } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    const body = jsonBody(res);
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).not.toEqual(expect.stringContaining("connection string"));
  });
});

describe("listExports", () => {
  test("200s with the service's list", async () => {
    const data = [{ id: "r1", status: "ready", downloadUrl: "/api/export/download/tok" }];
    const listExportRequests = jest.fn().mockResolvedValue(data);
    const { list } = loadControllers({ listExportRequests });
    const res = makeRes();

    await list.listExports(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res)).toEqual(expect.objectContaining({ success: true, data }));
  });

  test("500s on an unexpected service error", async () => {
    const listExportRequests = jest.fn().mockRejectedValue(new Error("boom"));
    const { list } = loadControllers({ listExportRequests });
    const res = makeRes();

    await list.listExports(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("getExportStatus", () => {
  test("404s for a malformed id without calling the service", async () => {
    const getExportRequestStatus = jest.fn();
    const { status } = loadControllers({ getExportRequestStatus });
    const res = makeRes();

    await status.getExportStatus(makeReq({ params: { id: "not-an-object-id" } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(getExportRequestStatus).not.toHaveBeenCalled();
  });

  test("404s when the service reports NOT_FOUND", async () => {
    const getExportRequestStatus = jest.fn().mockRejectedValue(makeError("NOT_FOUND"));
    const { status } = loadControllers({ getExportRequestStatus });
    const res = makeRes();

    await status.getExportStatus(makeReq({ params: { id: "64f1a2b3c4d5e6f7a8b9c0cc" } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("200s with the request's safe shape on success", async () => {
    const data = { id: "r1", status: "ready" };
    const getExportRequestStatus = jest.fn().mockResolvedValue(data);
    const { status } = loadControllers({ getExportRequestStatus });
    const res = makeRes();

    await status.getExportStatus(makeReq({ params: { id: "64f1a2b3c4d5e6f7a8b9c0cc" } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res).data).toEqual(data);
  });
});

describe("downloadExport", () => {
  test("200s with the file content and attachment headers on success", async () => {
    const resolveDownload = jest.fn().mockResolvedValue({
      filePath: "/generated-exports/tok.csv",
      fileName: "balensia-export-expenses-x.csv",
      contentType: "text/csv",
    });
    const readFile = jest.fn().mockResolvedValue(Buffer.from("date,amount\r\n"));
    const { download } = loadControllers({ resolveDownload }, { readFile });
    const res = makeRes();

    await download.downloadExport(makeReq({ params: { token: "tok" } }), res);

    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/csv");
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(Buffer.from("date,amount\r\n"));
  });

  test("404s (not 500) when the service can't resolve the token", async () => {
    const resolveDownload = jest.fn().mockRejectedValue(makeError("NOT_FOUND"));
    const { download } = loadControllers({ resolveDownload });
    const res = makeRes();

    await download.downloadExport(makeReq({ params: { token: "bogus" } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("404s (not 500) when the resolved file is missing on disk", async () => {
    const resolveDownload = jest.fn().mockResolvedValue({
      filePath: "/generated-exports/tok.csv",
      fileName: "x.csv",
      contentType: "text/csv",
    });
    const readFile = jest.fn().mockRejectedValue(new Error("ENOENT"));
    const { download } = loadControllers({ resolveDownload }, { readFile });
    const res = makeRes();

    await download.downloadExport(makeReq({ params: { token: "tok" } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
