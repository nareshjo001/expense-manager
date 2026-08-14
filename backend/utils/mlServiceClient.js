"use strict";

// Remediation Workstream C -- shared ML-service request helper.
//
// Centralizes two previously-scattered concerns across
// Routes/ml.router.js, Controllers/ExpenseControllers/addexpense.js, and
// cron/feedbackCollector.js, each of which independently built its own
// `${process.env.ML_ROUTE}/<path>` URL and (before this remediation) never
// attached any authentication to the ML-service call:
//
//   1. ML_ROUTE validation -- a missing/blank ML_ROUTE previously produced a
//      request URL like the literal string "undefined/predict-category"
//      (template-literal interpolation of `undefined`), which only failed
//      once axios actually attempted the network call, with no earlier or
//      clearer error. buildMlServiceUrl() now throws synchronously, before
//      any request is attempted, if ML_ROUTE is unset or blank -- every
//      existing call site already wraps its ML-service call in a try/catch
//      that treats a thrown/rejected error as "service unavailable" (503)
//      or a safe fallback, so this fails exactly as safely as a network
//      failure would, without ever dispatching a malformed request.
//
//   2. ML_OPERATIONS_TOKEN attachment -- ml-service's /predict-category,
//      /generate-description, and /retrain-model now require the same
//      shared-secret operations token /ml-status and /training-runs* have
//      always required (see ml-service/status_api.py's
//      _require_operations_token / OPERATIONS_TOKEN_HEADER). This module is
//      the ONE place on the Node side that reads ML_OPERATIONS_TOKEN and
//      builds the header object, so every caller stays in sync with
//      ml-service's own header name by construction, not by convention.
//
// The token is never logged, never returned in any response body, and never
// placed in a query string -- it is attached exclusively via the header
// object mlOperationsHeaders() returns. Must match ml-service's
// OPERATIONS_TOKEN_HEADER (ml-service/status_api.py) byte-for-byte.
const OPERATIONS_TOKEN_HEADER = "X-ML-Operations-Token";

// Builds an absolute ML-service URL for `path` (expected to start with
// "/"). Throws synchronously if ML_ROUTE is not configured -- never returns
// a URL containing the literal string "undefined".
function buildMlServiceUrl(path) {
  const base = process.env.ML_ROUTE;
  if (typeof base !== "string" || base.trim() === "") {
    throw new Error("ML_ROUTE is not configured.");
  }
  return `${base.replace(/\/+$/, "")}${path}`;
}

// Returns the header object to spread into an axios request config's
// `headers`. A missing ML_OPERATIONS_TOKEN resolves to `{}` (no header
// attached) rather than throwing -- ml-service's own
// _require_operations_token already fails closed (503) when ITS
// ML_OPERATIONS_TOKEN is unset, so an unconfigured backend token still
// produces a safe, generic failure rather than a silently-open call; this
// only guarantees a CONFIGURED token is always attached, never forgotten by
// an individual call site.
function mlOperationsHeaders() {
  const token = process.env.ML_OPERATIONS_TOKEN;
  if (typeof token !== "string" || token.trim() === "") {
    return {};
  }
  return { [OPERATIONS_TOKEN_HEADER]: token };
}

module.exports = { buildMlServiceUrl, mlOperationsHeaders, OPERATIONS_TOKEN_HEADER };
