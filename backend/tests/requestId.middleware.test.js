// OBS-001-T02 -- backend/Middlewares/requestId.js
const { requestIdMiddleware, REQUEST_ID_HEADER } = require("../Middlewares/requestId");

function buildReqRes(incomingHeader) {
  const headers = {};
  const req = {
    get: (name) => (name === REQUEST_ID_HEADER ? incomingHeader : undefined),
  };
  const res = {
    setHeader: (name, value) => {
      headers[name] = value;
    },
  };
  return { req, res, headers };
}

describe("requestIdMiddleware", () => {
  test("generates a fresh UUID when no header is supplied", () => {
    const { req, res, headers } = buildReqRes(undefined);
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(headers[REQUEST_ID_HEADER]).toBe(req.requestId);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("reuses a well-shaped caller-supplied request ID", () => {
    const { req, res, headers } = buildReqRes("client-supplied-id.123_abc");
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBe("client-supplied-id.123_abc");
    expect(headers[REQUEST_ID_HEADER]).toBe("client-supplied-id.123_abc");
  });

  test("rejects a malformed caller-supplied header and generates its own", () => {
    const { req, res } = buildReqRes("not a valid id\nwith newline");
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).not.toBe("not a valid id\nwith newline");
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test("rejects an oversized header value", () => {
    const { req, res } = buildReqRes("a".repeat(200));
    const next = jest.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId.length).toBeLessThanOrEqual(36);
  });
});
