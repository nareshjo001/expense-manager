"use strict";

// NOT-003-T04 -- shared IANA-time-zone helpers.
//
// resolveTimeZone below is a straight extraction of
// Services/RecurringServices/upcomingProjection.js's own function of the
// same name -- that file's header already flagged this exact move as "the
// right follow-up" once a second feature needed the same validation (REC-003
// only needed it for calendar-date presentation; NOT-003-T04 needs it again
// for quiet-hours evaluation). upcomingProjection.js now delegates to this
// module instead of duplicating the logic; its own `resolveTimeZone` export
// is preserved (re-exported, same reference) so nothing that already
// imports it from there breaks.
const siaConfig = require("../sia/config");

// Throws a RangeError for an unrecognized IANA zone, which is the only
// reliable way to validate one. A bad zone falls back rather than failing
// the caller: a projection or a quiet-hours check with the wrong offset is
// recoverable, a 500 is not.
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

// Current local time-of-day in `timeZone`, as "HH:mm" (24h, zero-padded,
// 00-23). hourCycle: "h23" is passed explicitly -- some ICU builds render
// midnight as "24:00" under the default hour cycle for a 24h locale, which
// would silently break the "start === end -> no window" and
// minutes-since-midnight comparisons below.
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

// Whether `date` falls inside the [start, end) quiet-hours window, evaluated
// in `timeZone`. The window may wrap past midnight (e.g. 22:00 -> 07:00),
// which is the common case for "quiet hours" -- so this is NOT a simple
// start < end comparison; see the branch below.
//
// start === end is treated as "no window" (always false) rather than "24
// hours of quiet" -- an admin/user typo that sets both fields identically
// should not accidentally silence every notification type with no way to
// tell why nothing is arriving.
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
