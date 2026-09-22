// IMP-001-T06 -- Controllers/ImportControllers/commitSession.js.
// Same fast controller-unit-test pattern as
// tests/duplicateCandidateControllers.test.js -- importCommitService is
// mocked, so this proves only the HTTP mapping (status codes, response
// shape), not the commit business rules (covered by
// tests/importCommitService.test.js).
"use strict";

const SERVICE_PATH = "../Services/ImportServices/importCommitService";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const VALID_SESSION_ID = "64f1a2b3c4d5e6f7a8b9c0bb";

const ERROR_CODES = Object.freeze({
  NOT_FOUND: "NOT_FOUND",
  ALREADY_COMMITTING: "ALREADY_COMMITTING",
  SESSION_EXPIRED: "SESSION_EXPIRED",
});

function makeError(code, message = "err") {
  const err = new Error(message);
  err.code = code;
  return err;
}

const makeReq = (overrides = {}) => ({ body: {}, params: {}, query: {}, userId: USER_ID, ...overrides });

const makeRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const jsonBody = (res) => res.json.mock.calls[0][0];

function loadController(serviceMock = {}) {
  jest.resetModules();
  jest.doMock("mongoose", () => ({
    Types: { ObjectId: { isValid: (id) => /^[0-9a-fA-F]{24}$/.test(String(id)) } },
  }));
  jest.doMock(SERVICE_PATH, () => ({
    commitImportSession: jest.fn(),
    ERROR_CODES,
    ...serviceMock,
  }));
  return require("../Controllers/ImportControllers/commitSession");
}

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe("commitImportSessionController", () => {
  test("404s for a malformed session id without calling the service", async () => {
    const commitImportSession = jest.fn();
    const { commitImportSessionController } = loadController({ commitImportSession });
    const res = makeRes();

    await commitImportSessionController(makeReq({ params: { id: "not-an-id" } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(jsonBody(res).errorCode).toBe(ERROR_CODES.NOT_FOUND);
    expect(commitImportSession).not.toHaveBeenCalled();
  });

  test("200s with the service's data on success, passing userId/sessionId through", async () => {
    const data = { id: VALID_SESSION_ID, status: "committed", committedCount: 2, skippedCount: 0, rows: [] };
    const commitImportSession = jest.fn().mockResolvedValue(data);
    const { commitImportSessionController } = loadController({ commitImportSession });
    const res = makeRes();

    await commitImportSessionController(makeReq({ params: { id: VALID_SESSION_ID } }), res);

    expect(commitImportSession).toHaveBeenCalledWith({ userId: USER_ID, sessionId: VALID_SESSION_ID });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(jsonBody(res)).toEqual({ success: true, data });
  });

  test("404s when the service reports NOT_FOUND", async () => {
    const commitImportSession = jest.fn().mockRejectedValue(makeError(ERROR_CODES.NOT_FOUND));
    const { commitImportSessionController } = loadController({ commitImportSession });
    const res = makeRes();

    await commitImportSessionController(makeReq({ params: { id: VALID_SESSION_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(jsonBody(res).errorCode).toBe(ERROR_CODES.NOT_FOUND);
  });

  test("409s when the service reports ALREADY_COMMITTING", async () => {
    const commitImportSession = jest.fn().mockRejectedValue(makeError(ERROR_CODES.ALREADY_COMMITTING));
    const { commitImportSessionController } = loadController({ commitImportSession });
    const res = makeRes();

    await commitImportSessionController(makeReq({ params: { id: VALID_SESSION_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(jsonBody(res).errorCode).toBe(ERROR_CODES.ALREADY_COMMITTING);
  });

  test("410s when the service reports SESSION_EXPIRED", async () => {
    const commitImportSession = jest.fn().mockRejectedValue(makeError(ERROR_CODES.SESSION_EXPIRED));
    const { commitImportSessionController } = loadController({ commitImportSession });
    const res = makeRes();

    await commitImportSessionController(makeReq({ params: { id: VALID_SESSION_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(410);
    expect(jsonBody(res).errorCode).toBe(ERROR_CODES.SESSION_EXPIRED);
  });

  test("500s on an unexpected error", async () => {
    const commitImportSession = jest.fn().mockRejectedValue(new Error("boom"));
    const { commitImportSessionController } = loadController({ commitImportSession });
    const res = makeRes();

    await commitImportSessionController(makeReq({ params: { id: VALID_SESSION_ID } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(jsonBody(res).success).toBe(false);
  });
});
