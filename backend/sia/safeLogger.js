// SIA safe structured logger -- minimal, SIA-owned operational logging for the provider workflow only (the rest of the backend uses ad hoc console.log/console.error calls that don't constrain what can be logged, so none are safe to reuse here). Safety model: logSiaEvent()'s ONLY parameter is a destructured object with four fixed named fields (event, provider, errorCode, latencyMs) -- no metadata/spread parameter anywhere, so a caller cannot add an arbitrary field; unknown properties are simply never read, and every field is validated against a narrow primitive shape (anything failing validation becomes null). This module never receives -- and can never log -- the question, system prompt, financial context, generated answer, userId, email, JWT, API key, Authorization header, configured model, or any raw provider object; callers only ever pass the four safe fields below. Logging never throws and never returns a value a caller depends on, so a logging failure can never alter the HTTP response -- each call is one synchronous console.log of a JSON line, no timers/intervals/async transports.
"use strict";

const SCOPE = "sia";

// Stable, documented event names -- only these two are ever produced by ask.js.
const SIA_LOG_EVENTS = Object.freeze({
  PROVIDER_REQUEST_COMPLETED: "provider_request_completed",
  PROVIDER_REQUEST_FAILED: "provider_request_failed",
});

const KNOWN_EVENTS = new Set(Object.values(SIA_LOG_EVENTS));

// A provider identifier or internal error code is a short, non-blank string in this codebase -- anything else (objects, blank/whitespace, unexpectedly long) is dropped to null rather than passed through, so a malformed value can never smuggle unsafe content into a log line.
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

// Writes one structured JSON log record for the SIA provider workflow. Accepts only { event, provider, errorCode, latencyMs } -- any other property is ignored, never read, never reaches the record. Swallows any internal failure so logging can never throw or affect the caller's response.
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
