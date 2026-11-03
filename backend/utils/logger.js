// Generalized structured logger for OBS-001 (Production observability).
"use strict";

const MAX_SAFE_STRING_LENGTH = 500;
const MAX_ROUTE_LENGTH = 200;
// Structured values (metrics_snapshot's jobs/operations, a migration report's examples) are serialized to JSON text.
const MAX_STRUCTURED_LENGTH = 2000;

function safeStructured(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
  return safeString(text, MAX_STRUCTURED_LENGTH);
}

// Collapses newlines (log-injection risk) and truncates so a single field
// can never dominate or corrupt a log line.
function safeString(value, maxLength = MAX_SAFE_STRING_LENGTH) {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text === "") return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// requestId is attacker/upstream-influenced (client header) -- constrain to
// a short, plain identifier shape before it ever reaches a log line.
function safeRequestId(value) {
  const text = safeString(value, 128);
  if (!text || !/^[A-Za-z0-9._-]{1,128}$/.test(text)) return null;
  return text;
}

// Emits one structured JSON log line.
function logEvent({ level = "info", scope, event, requestId, ...fields } = {}) {
  try {
    const record = {
      timestamp: new Date().toISOString(),
      level: ["info", "warn", "error"].includes(level) ? level : "info",
      scope: safeString(scope, 50) || "app",
      event: safeString(event, 100) || "unknown_event",
      requestId: safeRequestId(requestId),
    };

    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "number") {
        record[key] = safeNumber(value);
      } else if (typeof value === "boolean") {
        record[key] = value;
      } else if (value !== null && typeof value === "object") {
        record[key] = safeStructured(value);
      } else if (value !== undefined) {
        record[key] = key === "route" || key === "path"
          ? safeString(value, MAX_ROUTE_LENGTH)
          : safeString(value);
      }
    }

    const line = JSON.stringify(record);
    if (level === "error") {
      console.error(line);
    } else {
      console.log(line);
    }
  } catch {
    // Logging must never throw or alter the caller's control flow.
  }
}

module.exports = { logEvent, safeString, safeNumber, safeRequestId };
