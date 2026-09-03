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

// Returns the header object to spread into an axios request config's
// headers. `requestId` (OBS-001-T02) is optional and forwarded only when it
// matches the same safe shape enforced by backend/Middlewares/requestId.js,
// so the ML service can correlate its own logs with the originating request.
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

module.exports = { buildMlServiceUrl, mlOperationsHeaders, OPERATIONS_TOKEN_HEADER, REQUEST_ID_HEADER };
