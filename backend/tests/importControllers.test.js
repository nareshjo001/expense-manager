// IMP-001-T04 -- Controllers/ImportControllers/*.js. Same fast
// controller-unit-test pattern as duplicateCandidateControllers.test.js
// -- importSessionService is mocked, so this proves only the HTTP
// mapping (status codes, response shape, error-code -> status mapping),
// not the business rules (already covered by
// importSessionService.test.js).
"use strict";

const SERVICE_PATH = "../Services/ImportServices/importSessionService";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const VALID_SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0cc";

// Same shape importSessionService.js actually exports: CSV_ERROR_CODES's
// own keys (TOO_MANY_ROWS/EMPTY_FILE/MALFORMED_ROW) spread in verbatim,
// plus this service's own codes.
const ERROR_CODES = Object.freeze({
  TOO_MANY_ROWS: "IMPORT_TOO_MANY_ROWS",
  EMPTY_FILE: "IMPORT_EMPTY_FILE",
  MALFORMED_ROW: "IMPORT_MALFORMED_ROW",
  FILE_TOO_LARGE: "IMPORT_FILE_TOO_LARGE",
  INVALID_MAPPING: "IMPORT_INVALID_MAPPING",
  NOT_FOUND: "IMPORT_SESSION_NOT_FOUND",
  SESSION_NOT_PREVIEWING: "IMPORT_SESSION_NOT_PREVIEWING",
  ROW_NOT_FOUND: "IMPORT_ROW_NOT_FOUND",
  INVALID_DECISION: "IMPORT_INVALID_DECISION",
});

function makeError(code, message = "err") {
  const err = new Error(message);
  err.code = code;
  return err;
}

const makeReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  userId: USER_ID,
  ...overrides,
});

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const jsonBody = (res) => res.json.mock.calls[0][0];

function loadControllers(serviceMock = {}) {
  jest.resetModules();
  jest.doMock(SERVICE_PATH, () => ({
    previewImportHeaders: jest.fn(),
    createImportSessionPreview: jest.fn(),
    getImportSessionSafeShape: jest.fn(),
    listImportSessionsSafeShape: jest.fn(),
    decideImportRow: jest.fn(),
    ERROR_CODES,
    ...serviceMock,
  }));
  jest.doMock("mongoose", () => ({
    Types: { ObjectId: { isValid: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) } },
  }));

  return {
    previewHeaders: require("../Controllers/ImportControllers/previewHeaders"),
    createSession: require("../Controllers/ImportControllers/createSession"),
    listSessions: require("../Controllers/ImportControllers/listSessions"),
    getSession: require("../Controllers/ImportControllers/getSession"),
    decideRow: require("../Controllers/ImportControllers/decideRow"),
  };
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.dontMock(SERVICE_PATH);
  jest.dontMock("mongoose");
});

describe("previewImportHeadersController", () => {
  test("400s when no file is uploaded", async () => {
    const previewImportHeaders = jest.fn();
    const { previewHeaders } = loadControllers({ previewImportHeaders });
    const res = makeRes();

    await previewHeaders.previewImportHeadersController(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(previewImportHeaders).not.toHaveBeenCalled();
  });

  test("200s with headerRow + suggestedMapping on success", async () => {
    const previewImportHeaders = jest.fn().mockResolvedValue({
      headerRow: ["Date", "Amount", "Merchant"],
      suggestedMapping: { date: "Date", amount: "Amount", merchant: "Merchant", category: null },
    });
    const { previewHeaders } = loadControllers({ previewImportHeaders });
    const res = makeRes();
    const req = makeReq({ file: { buffer: Buffer.from("Date,Amount,Merchant\n"), originalname: "t.csv" } });

    await previewHeaders.previewImportHeadersController(req, res);

    expect(previewImportHeaders).toHaveBeenCalledWith({ fileBuffer: req.file.buffer });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res)).toEqual(
      expect.objectContaining({
        success: true,
        headerRow: ["Date", "Amount", "Merchant"],
      })
    );
  });

  test.each([
    ["FILE_TOO_LARGE", 400],
    ["EMPTY_FILE", 400],
    ["TOO_MANY_ROWS", 400],
    ["MALFORMED_ROW", 400],
  ])("maps %s to %i", async (codeKey, expectedStatus) => {
    const previewImportHeaders = jest.fn().mockRejectedValue(makeError(ERROR_CODES[codeKey]));
    const { previewHeaders } = loadControllers({ previewImportHeaders });
    const res = makeRes();
    const req = makeReq({ file: { buffer: Buffer.from("x"), originalname: "t.csv" } });

    await previewHeaders.previewImportHeadersController(req, res);

    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(jsonBody(res)).toEqual(expect.objectContaining({ success: false, errorCode: ERROR_CODES[codeKey] }));
  });

  test("500s on an unmapped/unexpected error", async () => {
    const previewImportHeaders = jest.fn().mockRejectedValue(new Error("boom"));
    const { previewHeaders } = loadControllers({ previewImportHeaders });
    const res = makeRes();
    const req = makeReq({ file: { buffer: Buffer.from("x"), originalname: "t.csv" } });

    await previewHeaders.previewImportHeadersController(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("createImportSessionController", () => {
  test("400s when no file is uploaded", async () => {
    const createImportSessionPreview = jest.fn();
    const { createSession } = loadControllers({ createImportSessionPreview });
    const res = makeRes();

    await createSession.createImportSessionController(makeReq({ body: { columnMapping: "{}" } }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(createImportSessionPreview).not.toHaveBeenCalled();
  });

  test("400s with INVALID_MAPPING when columnMapping isn't valid JSON", async () => {
    const createImportSessionPreview = jest.fn();
    const { createSession } = loadControllers({ createImportSessionPreview });
    const res = makeRes();
    const req = makeReq({
      file: { buffer: Buffer.from("x"), originalname: "t.csv" },
      body: { columnMapping: "{not-json" },
    });

    await createSession.createImportSessionController(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(jsonBody(res)).toEqual(expect.objectContaining({ success: false, errorCode: ERROR_CODES.INVALID_MAPPING }));
    expect(createImportSessionPreview).not.toHaveBeenCalled();
  });

  test("201s with the safe session shape on success", async () => {
    const safeShape = { id: VALID_SESSION_ID, status: "previewing", rows: [] };
    const createImportSessionPreview = jest.fn().mockResolvedValue(safeShape);
    const { createSession } = loadControllers({ createImportSessionPreview });
    const res = makeRes();
    const mapping = { date: "Date", amount: "Amount", merchant: "Merchant" };
    const req = makeReq({
      file: { buffer: Buffer.from("x"), originalname: "t.csv" },
      body: { columnMapping: JSON.stringify(mapping) },
    });

    await createSession.createImportSessionController(req, res);

    expect(createImportSessionPreview).toHaveBeenCalledWith({
      userId: USER_ID,
      originalFilename: "t.csv",
      fileBuffer: req.file.buffer,
      columnMapping: mapping,
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(jsonBody(res)).toEqual({ success: true, data: safeShape });
  });

  test.each([
    ["FILE_TOO_LARGE", 400],
    ["INVALID_MAPPING", 400],
    ["EMPTY_FILE", 400],
    ["TOO_MANY_ROWS", 400],
    ["MALFORMED_ROW", 400],
  ])("maps %s to %i", async (codeKey, expectedStatus) => {
    const createImportSessionPreview = jest.fn().mockRejectedValue(makeError(ERROR_CODES[codeKey]));
    const { createSession } = loadControllers({ createImportSessionPreview });
    const res = makeRes();
    const req = makeReq({
      file: { buffer: Buffer.from("x"), originalname: "t.csv" },
      body: { columnMapping: "{}" },
    });

    await createSession.createImportSessionController(req, res);

    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(jsonBody(res)).toEqual(expect.objectContaining({ success: false, errorCode: ERROR_CODES[codeKey] }));
  });
});

describe("listImportSessionsController", () => {
  test("200s with the list", async () => {
    const listImportSessionsSafeShape = jest.fn().mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const { listSessions } = loadControllers({ listImportSessionsSafeShape });
    const res = makeRes();

    await listSessions.listImportSessionsController(makeReq(), res);

    expect(listImportSessionsSafeShape).toHaveBeenCalledWith({ userId: USER_ID });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res)).toEqual({ success: true, data: [{ id: "a" }, { id: "b" }] });
  });

  test("500s on an unexpected error", async () => {
    const listImportSessionsSafeShape = jest.fn().mockRejectedValue(new Error("boom"));
    const { listSessions } = loadControllers({ listImportSessionsSafeShape });
    const res = makeRes();

    await listSessions.listImportSessionsController(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("getImportSessionController", () => {
  test("404s for a malformed id without calling the service", async () => {
    const getImportSessionSafeShape = jest.fn();
    const { getSession } = loadControllers({ getImportSessionSafeShape });
    const res = makeRes();

    await getSession.getImportSessionController(makeReq({ params: { id: "not-an-id" } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(getImportSessionSafeShape).not.toHaveBeenCalled();
  });

  test("404s when the service returns null (not found or not owned)", async () => {
    const getImportSessionSafeShape = jest.fn().mockResolvedValue(null);
    const { getSession } = loadControllers({ getImportSessionSafeShape });
    const res = makeRes();

    await getSession.getImportSessionController(makeReq({ params: { id: VALID_SESSION_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(jsonBody(res)).toEqual(expect.objectContaining({ success: false, errorCode: "NOT_FOUND" }));
  });

  test("200s with the safe shape on success", async () => {
    const safeShape = { id: VALID_SESSION_ID, status: "previewing" };
    const getImportSessionSafeShape = jest.fn().mockResolvedValue(safeShape);
    const { getSession } = loadControllers({ getImportSessionSafeShape });
    const res = makeRes();

    await getSession.getImportSessionController(makeReq({ params: { id: VALID_SESSION_ID } }), res);

    expect(getImportSessionSafeShape).toHaveBeenCalledWith({ userId: USER_ID, sessionId: VALID_SESSION_ID });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res)).toEqual({ success: true, data: safeShape });
  });
});

describe("decideImportRowController", () => {
  test("404s for a malformed session id without calling the service", async () => {
    const decideImportRow = jest.fn();
    const { decideRow } = loadControllers({ decideImportRow });
    const res = makeRes();

    await decideRow.decideImportRowController(
      makeReq({ params: { id: "not-an-id", rowIndex: "0" }, body: { decision: "accept" } }),
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(decideImportRow).not.toHaveBeenCalled();
  });

  test("200s with the safe shape on success", async () => {
    const safeShape = { id: VALID_SESSION_ID, rows: [{ rowIndex: 0, decision: "accept" }] };
    const decideImportRow = jest.fn().mockResolvedValue(safeShape);
    const { decideRow } = loadControllers({ decideImportRow });
    const res = makeRes();
    const req = makeReq({ params: { id: VALID_SESSION_ID, rowIndex: "0" }, body: { decision: "accept" } });

    await decideRow.decideImportRowController(req, res);

    expect(decideImportRow).toHaveBeenCalledWith({
      userId: USER_ID,
      sessionId: VALID_SESSION_ID,
      rowIndex: 0,
      decision: "accept",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res)).toEqual({ success: true, data: safeShape });
  });

  test.each([
    ["NOT_FOUND", 404],
    ["SESSION_NOT_PREVIEWING", 409],
    ["ROW_NOT_FOUND", 404],
    ["INVALID_DECISION", 400],
  ])("maps %s to %i", async (codeKey, expectedStatus) => {
    const decideImportRow = jest.fn().mockRejectedValue(makeError(ERROR_CODES[codeKey]));
    const { decideRow } = loadControllers({ decideImportRow });
    const res = makeRes();
    const req = makeReq({ params: { id: VALID_SESSION_ID, rowIndex: "0" }, body: { decision: "accept" } });

    await decideRow.decideImportRowController(req, res);

    expect(res.status).toHaveBeenCalledWith(expectedStatus);
    expect(jsonBody(res)).toEqual(expect.objectContaining({ success: false, errorCode: ERROR_CODES[codeKey] }));
  });

  test("500s on an unexpected error", async () => {
    const decideImportRow = jest.fn().mockRejectedValue(new Error("boom"));
    const { decideRow } = loadControllers({ decideImportRow });
    const res = makeRes();
    const req = makeReq({ params: { id: VALID_SESSION_ID, rowIndex: "0" }, body: { decision: "accept" } });

    await decideRow.decideImportRowController(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
