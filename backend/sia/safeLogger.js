// SIA safe structured logger.
//
// M3-3 scope: minimal, SIA-owned operational logging for the provider
// workflow only. No suitable structured logger exists anywhere else in the
// backend (the rest of the codebase uses ad hoc, free-text console.log /
// console.error calls -- see backend/config/db.js, backend/config/redis.js,
// backend/cache/reportCache.js -- none of which are safe to reuse here,
// since none constrain what can be logged).
//
// Safety model: logSiaEvent()'s ONLY parameter is a destructured object
// with four fixed, named fields (event, provider, errorCode, latencyMs).
// There is no metadata/spread parameter anywhere in this module's public
// API, so a caller cannot add an arbitrary field to a log record no matter
// what it passes in -- unknown properties on the input object are simply
// never read. Every field is additionally validated against a narrow
// primitive shape before being written; anything that fails validation
// becomes null rather than being included as-is. This module never
// receives -- and therefore can never log -- the question, system prompt,
// financial/report context, generated answer, userId, email, JWT, API key,
// Authorization header, configured model, or any raw Axios/provider
// object: callers (backend/Controllers/SiaControllers/ask.js) only ever
// pass the four safe fields below.
//
// Logging never throws and never returns a value a caller depends on, so a
// logging/sink failure can never alter the HTTP response. Each call is a
// single synchronous console.log of one JSON line -- no timers, intervals,
// or async transports are created.
"use strict";

const SCOPE = "sia";

// Stable, documented event names. Only these two are ever produced by
// backend/Controllers/SiaControllers/ask.js as of M3-3.
const SIA_LOG_EVENTS = Object.freeze({
  PROVIDER_REQUEST_COMPLETED: "provider_request_completed",
  PROVIDER_REQUEST_FAILED: "provider_request_failed",
});

const KNOWN_EVENTS = new Set(Object.values(SIA_LOG_EVENTS));

// A provider identifier or an internal error code is a short, non-blank
// string in this codebase (e.g. "openai", "PROVIDER_TIMEOUT"). Anything
// else -- including objects, the empty/whitespace string, or an
// unexpectedly long value -- is dropped to null rather than passed
// through, so a malformed or unexpected value can never smuggle unsafe
// content into a log line.
const MAX_SAFE_STRING_LENGTH = 100;

function safeString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_SAFE_STRING_LENGTH) {
    return null;
  }
  return trimmed;
}

function safeLatencyMs(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// Writes one structured JSON log record for the SIA provider workflow.
// Accepts only { event, provider, errorCode, latencyMs } -- any other
// property on the input object is ignored, not read, and never reaches
// the record. Swallows any internal failure (e.g. a broken console.log)
// so logging can never throw or otherwise affect the caller's response.
function logSiaEvent({ event, provider, errorCode, latencyMs } = {}) {
  try {
    const safeEvent = KNOWN_EVENTS.has(event) ? event : "unknown_event";
    const record = {
      timestamp: new Date().toISOString(),
      level: safeEvent === SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED ? "error" : "info",
      scope: SCOPE,
      event: safeEvent,
      provider: safeString(provider),
      errorCode: safeString(errorCode),
      latencyMs: safeLatencyMs(latencyMs),
    };
    console.log(JSON.stringify(record));
  } catch {
    // Logging must never throw or alter the API response.
  }
}

module.exports = {
  logSiaEvent,
  SIA_LOG_EVENTS,
};
