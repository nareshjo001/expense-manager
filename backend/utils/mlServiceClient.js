"use strict";

// Remediation Workstream C -- shared ML-service request helper.
const OPERATIONS_TOKEN_HEADER = "X-ML-Operations-Token";
const REQUEST_ID_HEADER = "X-Request-ID";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

// Builds an absolute ML-service URL for `path` (expected to start with
function buildMlServiceUrl(path) {
  const base = process.env.ML_ROUTE;
  if (typeof base !== "string" || base.trim() === "") {
    throw new Error("ML_ROUTE is not configured.");
  }
  return `${base.replace(/\/+$/, "")}${path}`;
}

// Returns the header object to spread into an axios request config's headers.
function mlOperationsHeaders(requestId) {
  const headers = {};

  const token = process.env.ML_OPERATIONS_TOKEN;
  if (typeof token === "string" && token.trim() !== "") {
    headers[OPERATIONS_TOKEN_HEADER] = token;
  }

  const trimmedRequestId = typeof requestId === "string" ? requestId.trim() : "";
  if (REQUEST_ID_PATTERN.test(trimmedRequestId)) {
    headers[REQUEST_ID_HEADER] = trimmedRequestId;
  }

  return headers;
}

// ML service metrics. Wrapping the CALL rather than instrumenting each call site is deliberate: there are three ML call sites today (predict-c.
const { recordOperation } = require("./metrics");

async function callMlService(operation, request) {
  const startedAt = Date.now();
  try {
    const response = await request();
    recordOperation({ scope: "ml", operation, outcome: "success", durationMs: Date.now() - startedAt });
    return response;
  } catch (err) {
    recordOperation({ scope: "ml", operation, outcome: "failure", durationMs: Date.now() - startedAt });
    throw err;
  }
}

module.exports = { buildMlServiceUrl, mlOperationsHeaders, callMlService, OPERATIONS_TOKEN_HEADER, REQUEST_ID_HEADER };
