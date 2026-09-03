// OBS-001-T02 -- request/correlation ID middleware. Generates a fresh UUID
// per request unless the caller already supplied a safely-shaped one, and
// always echoes it back on the response so a client/log line can be
// correlated across the frontend, this API, and the ML service.
"use strict";

const crypto = require("crypto");

const REQUEST_ID_HEADER = "X-Request-ID";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

// Reuses a caller-supplied X-Request-ID only if it matches the safe shape
// already relied on elsewhere (security.service.js); otherwise a value from
// an untrusted client could smuggle unsafe content into downstream logs.
function requestIdMiddleware(req, res, next) {
  const incoming = req.get(REQUEST_ID_HEADER);
  const trimmed = typeof incoming === "string" ? incoming.trim() : "";
  const requestId = REQUEST_ID_PATTERN.test(trimmed) ? trimmed : crypto.randomUUID();

  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

module.exports = { requestIdMiddleware, REQUEST_ID_HEADER, REQUEST_ID_PATTERN };
