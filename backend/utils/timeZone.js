"use strict";

// Shared IANA-time-zone helpers.
const siaConfig = require("../sia/config");

// Throws a RangeError for an unrecognized IANA zone, which is the only reliable way to validate one.
function resolveTimeZone(candidate) {
  const fallback = siaConfig.appTimeZone || "Asia/Kolkata";
  if (typeof candidate !== "string" || candidate.trim() === "") return fallback;
  const trimmed = candidate.trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return trimmed;
  } catch {
    return fallback;
  }
}

// Current local time-of-day in `timeZone`, as "HH:mm" (24h, zero-padded, 00-23).
function currentTimeInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour}:${minute}`;
}

function toMinutesSinceMidnight(hhmm) {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Whether `date` falls inside the [start, end) quiet-hours window, evaluated in `timeZone`.
function isWithinQuietHours(date, { start, end, timeZone } = {}) {
  const startMin = toMinutesSinceMidnight(start);
  const endMin = toMinutesSinceMidnight(end);
  if (startMin === null || endMin === null || startMin === endMin) return false;

  const zone = resolveTimeZone(timeZone);
  const currentMin = toMinutesSinceMidnight(currentTimeInZone(date, zone));
  if (currentMin === null) return false;

  if (startMin < endMin) {
    // Same-day window, e.g. 09:00 -> 17:00.
    return currentMin >= startMin && currentMin < endMin;
  }
  // Wraps midnight, e.g. 22:00 -> 07:00.
  return currentMin >= startMin || currentMin < endMin;
}

module.exports = {
  resolveTimeZone,
  currentTimeInZone,
  isWithinQuietHours,
};
