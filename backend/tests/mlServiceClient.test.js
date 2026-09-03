// Remediation Workstream C -- backend-side ML-service request helper.
"use strict";

const MODULE_PATH = "../utils/mlServiceClient";

let originalMlRoute;
let originalOperationsToken;

beforeEach(() => {
  originalMlRoute = process.env.ML_ROUTE;
  originalOperationsToken = process.env.ML_OPERATIONS_TOKEN;
  jest.resetModules();
});

afterEach(() => {
  if (originalMlRoute === undefined) delete process.env.ML_ROUTE;
  else process.env.ML_ROUTE = originalMlRoute;
  if (originalOperationsToken === undefined) delete process.env.ML_OPERATIONS_TOKEN;
  else process.env.ML_OPERATIONS_TOKEN = originalOperationsToken;
});

describe("Remediation Workstream C: utils/mlServiceClient.js", () => {
  it("builds a correct URL when ML_ROUTE is configured", () => {
    process.env.ML_ROUTE = "http://ml-service.internal:8000";
    const { buildMlServiceUrl } = require(MODULE_PATH);

    expect(buildMlServiceUrl("/predict-category")).toBe(
      "http://ml-service.internal:8000/predict-category"
    );
  });

  it("throws synchronously (never returns a URL containing 'undefined') when ML_ROUTE is unset", () => {
    delete process.env.ML_ROUTE;
    const { buildMlServiceUrl } = require(MODULE_PATH);

    expect(() => buildMlServiceUrl("/predict-category")).toThrow();
  });

  it("throws when ML_ROUTE is blank", () => {
    process.env.ML_ROUTE = "   ";
    const { buildMlServiceUrl } = require(MODULE_PATH);

    expect(() => buildMlServiceUrl("/predict-category")).toThrow();
  });

  it("attaches the X-ML-Operations-Token header when ML_OPERATIONS_TOKEN is configured", () => {
    process.env.ML_OPERATIONS_TOKEN = "a-real-token-value";
    const { mlOperationsHeaders, OPERATIONS_TOKEN_HEADER } = require(MODULE_PATH);

    const headers = mlOperationsHeaders();
    expect(headers[OPERATIONS_TOKEN_HEADER]).toBe("a-real-token-value");
    expect(OPERATIONS_TOKEN_HEADER).toBe("X-ML-Operations-Token");
  });

  it("returns no header at all when ML_OPERATIONS_TOKEN is unset -- never a header with an empty/undefined value", () => {
    delete process.env.ML_OPERATIONS_TOKEN;
    const { mlOperationsHeaders } = require(MODULE_PATH);

    expect(mlOperationsHeaders()).toEqual({});
  });

  // OBS-001-T02 -- request/correlation ID forwarding to the ML service.
  it("forwards a well-shaped requestId as X-Request-ID", () => {
    delete process.env.ML_OPERATIONS_TOKEN;
    const { mlOperationsHeaders, REQUEST_ID_HEADER } = require(MODULE_PATH);

    const headers = mlOperationsHeaders("req-abc-123");
    expect(headers[REQUEST_ID_HEADER]).toBe("req-abc-123");
  });

  it("does not forward a malformed or missing requestId", () => {
    delete process.env.ML_OPERATIONS_TOKEN;
    const { mlOperationsHeaders, REQUEST_ID_HEADER } = require(MODULE_PATH);

    expect(mlOperationsHeaders("has a space\nand newline")[REQUEST_ID_HEADER]).toBeUndefined();
    expect(mlOperationsHeaders(undefined)[REQUEST_ID_HEADER]).toBeUndefined();
    expect(mlOperationsHeaders()[REQUEST_ID_HEADER]).toBeUndefined();
  });

  it("combines both the operations token and requestId headers when both are present", () => {
    process.env.ML_OPERATIONS_TOKEN = "a-real-token-value";
    const { mlOperationsHeaders, OPERATIONS_TOKEN_HEADER, REQUEST_ID_HEADER } = require(MODULE_PATH);

    const headers = mlOperationsHeaders("req-xyz");
    expect(headers[OPERATIONS_TOKEN_HEADER]).toBe("a-real-token-value");
    expect(headers[REQUEST_ID_HEADER]).toBe("req-xyz");
  });
});
