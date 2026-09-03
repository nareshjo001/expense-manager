// OBS-001-T03 -- backend/Middlewares/error.middleware.js structured logging
const errorHandler = require("../Middlewares/error.middleware");

function buildRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("error.middleware", () => {
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  test("responds with the error's statusCode/message and logs a structured error event", () => {
    const err = new Error("Something exploded");
    err.statusCode = 418;
    err.code = "TEAPOT";
    const req = { requestId: "req-abc", baseUrl: "/expense", method: "POST" };
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(418);
    expect(res.body).toEqual({ success: false, message: "Something exploded" });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const record = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
    expect(record.event).toBe("unhandled_request_error");
    expect(record.requestId).toBe("req-abc");
    expect(record.statusCode).toBe(418);
    expect(record.errorCode).toBe("TEAPOT");
  });

  test("defaults to 500 and a generic message when the error carries neither", () => {
    const err = new Error();
    const req = {};
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe("Internal Server Error");
  });

  test("never leaks the raw stack trace into the logged record", () => {
    const err = new Error("boundary test");
    const req = { requestId: "req-xyz" };
    const res = buildRes();

    errorHandler(err, req, res, jest.fn());

    const record = JSON.parse(consoleErrorSpy.mock.calls[0][0]);
    expect(record.stack).toBeUndefined();
    expect(JSON.stringify(record)).not.toContain("at Object");
  });
});
