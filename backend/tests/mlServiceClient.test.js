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
});
