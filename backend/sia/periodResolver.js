// SIA timezone-aware period resolver -- turns a QueryPlan period
"use strict";

const config = require("./config");

// ---- timezone-aware wall-clock <-> UTC instant conversion ---------------

function zonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  // Some Intl/Node combinations report midnight as hour "24" under
  // hour12:false -- normalize to 0 so downstream Date.UTC math is exact.
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

// The timeZone's offset from UTC (in ms, positive = ahead of UTC) AT the
function offsetMsAt(instant, timeZone) {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - instant.getTime();
}

// Converts a desired LOCAL wall-clock date/time in `timeZone` into the
function zonedTimeToUtc(year, month, day, hour, minute, second, timeZone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = offsetMsAt(new Date(guess), timeZone);
  return new Date(guess - offset);
}

function getZonedYMD(date, timeZone) {
  const p = zonedParts(date, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

// ---- calendar helpers -----------------------------------------------

const MONTH_NAMES = [
  null,
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function addMonths(year, month, delta) {
  const total = year * 12 + (month - 1) + delta;
  const y = Math.floor(total / 12);
  const m = (total % 12 + 12) % 12 + 1;
  return { year: y, month: m };
}

function monthBoundary(year, month, timeZone) {
  const start = zonedTimeToUtc(year, month, 1, 0, 0, 0, timeZone);
  const next = addMonths(year, month, 1);
  const end = zonedTimeToUtc(next.year, next.month, 1, 0, 0, 0, timeZone);
  return { start, end };
}

function monthLabel(year, month) {
  return `${MONTH_NAMES[month]} ${year}`;
}

const MAX_LAST_N_MONTHS = 12;

/* Deterministic "most recent non-future occurrence" rule for a bare month */
function resolveMostRecentMonthOccurrence(month, { now, timeZone } = {}) {
  const zone = timeZone || config.appTimeZone;
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return { ok: false, reason: "INVALID_MONTH" };
  }
  const { year: currentYear, month: currentMonth } = getZonedYMD(clock, zone);
  const year = month <= currentMonth ? currentYear : currentYear - 1;
  return { ok: true, year, month };
}

/* Resolves a QueryPlan period descriptor into */
function resolvePeriod(periodSpec, opts = {}) {
  try {
    const timeZone = opts.timeZone || config.appTimeZone;
    const now = opts.now instanceof Date && !Number.isNaN(opts.now.getTime()) ? opts.now : new Date();

    if (!periodSpec || typeof periodSpec !== "object" || Array.isArray(periodSpec)) {
      return { ok: false, reason: "INVALID_PERIOD" };
    }

    const { year: nowY, month: nowM, day: nowD } = getZonedYMD(now, timeZone);

    switch (periodSpec.type) {
      case "TODAY": {
        const start = zonedTimeToUtc(nowY, nowM, nowD, 0, 0, 0, timeZone);
        const end = zonedTimeToUtc(nowY, nowM, nowD + 1, 0, 0, 0, timeZone);
        return { ok: true, start, end, label: "today" };
      }

      case "YESTERDAY": {
        const start = zonedTimeToUtc(nowY, nowM, nowD - 1, 0, 0, 0, timeZone);
        const end = zonedTimeToUtc(nowY, nowM, nowD, 0, 0, 0, timeZone);
        return { ok: true, start, end, label: "yesterday" };
      }

      case "CURRENT_WEEK": {
        // Monday-start week, matching analyticsContext.js's existing
        const localDow = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
        const DOW_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const dow = DOW_INDEX[localDow];
        const daysSinceMonday = (dow - 1 + 7) % 7;
        const start = zonedTimeToUtc(nowY, nowM, nowD - daysSinceMonday, 0, 0, 0, timeZone);
        const end = zonedTimeToUtc(nowY, nowM, nowD - daysSinceMonday + 7, 0, 0, 0, timeZone);
        return { ok: true, start, end, label: "this week" };
      }

      case "PREVIOUS_WEEK": {
        const localDow = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(now);
        const DOW_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const dow = DOW_INDEX[localDow];
        const daysSinceMonday = (dow - 1 + 7) % 7;
        const start = zonedTimeToUtc(nowY, nowM, nowD - daysSinceMonday - 7, 0, 0, 0, timeZone);
        const end = zonedTimeToUtc(nowY, nowM, nowD - daysSinceMonday, 0, 0, 0, timeZone);
        return { ok: true, start, end, label: "last week" };
      }

      case "CURRENT_MONTH": {
        const { start, end } = monthBoundary(nowY, nowM, timeZone);
        return { ok: true, start, end, label: "this month" };
      }

      case "PREVIOUS_MONTH": {
        const prev = addMonths(nowY, nowM, -1);
        const { start, end } = monthBoundary(prev.year, prev.month, timeZone);
        return { ok: true, start, end, label: "last month" };
      }

      case "CURRENT_YEAR": {
        const start = zonedTimeToUtc(nowY, 1, 1, 0, 0, 0, timeZone);
        const end = zonedTimeToUtc(nowY + 1, 1, 1, 0, 0, 0, timeZone);
        return { ok: true, start, end, label: `${nowY}` };
      }

      case "PREVIOUS_YEAR": {
        const start = zonedTimeToUtc(nowY - 1, 1, 1, 0, 0, 0, timeZone);
        const end = zonedTimeToUtc(nowY, 1, 1, 0, 0, 0, timeZone);
        return { ok: true, start, end, label: `${nowY - 1}` };
      }

      case "EXPLICIT_MONTH": {
        const month = periodSpec.month;
        const year = periodSpec.year;
        if (!Number.isInteger(month) || month < 1 || month > 12) {
          return { ok: false, reason: "INVALID_MONTH" };
        }
        if (!Number.isInteger(year)) {
          return { ok: false, reason: "MISSING_YEAR" };
        }
        const { start, end } = monthBoundary(year, month, timeZone);
        return { ok: true, start, end, label: monthLabel(year, month) };
      }

      case "LAST_N_MONTHS": {
        const monthsCount = periodSpec.monthsCount;
        if (!Number.isInteger(monthsCount) || monthsCount < 1) {
          return { ok: false, reason: "INVALID_MONTHS_COUNT" };
        }
        if (monthsCount > MAX_LAST_N_MONTHS) {
          return { ok: false, reason: "MONTHS_COUNT_EXCEEDS_CAP" };
        }
        // Ends at the start of the CURRENT in-progress month (exclusive) --
        // the window is the N most recent COMPLETE calendar months.
        const end = zonedTimeToUtc(nowY, nowM, 1, 0, 0, 0, timeZone);
        const startOfWindow = addMonths(nowY, nowM, -monthsCount);
        const start = zonedTimeToUtc(startOfWindow.year, startOfWindow.month, 1, 0, 0, 0, timeZone);
        const endOfLastIncludedMonth = addMonths(nowY, nowM, -1);
        const label = `${monthLabel(startOfWindow.year, startOfWindow.month)} to ${monthLabel(
          endOfLastIncludedMonth.year,
          endOfLastIncludedMonth.month
        )}`;
        return { ok: true, start, end, label };
      }

      case "CUSTOM_RANGE": {
        const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
        if (!DATE_ONLY_PATTERN.test(periodSpec.startDate || "") || !DATE_ONLY_PATTERN.test(periodSpec.endDate || "")) {
          return { ok: false, reason: "INVALID_CUSTOM_RANGE_DATES" };
        }
        const [sy, sm, sd] = periodSpec.startDate.split("-").map(Number);
        const [ey, em, ed] = periodSpec.endDate.split("-").map(Number);
        const start = zonedTimeToUtc(sy, sm, sd, 0, 0, 0, timeZone);
        const end = zonedTimeToUtc(ey, em, ed, 0, 0, 0, timeZone);
        if (end <= start) return { ok: false, reason: "CUSTOM_RANGE_NOT_POSITIVE" };
        const spanDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
        if (spanDays > 366) return { ok: false, reason: "CUSTOM_RANGE_TOO_LONG" };
        return { ok: true, start, end, label: `${periodSpec.startDate} to ${periodSpec.endDate}` };
      }

      default:
        return { ok: false, reason: "UNSUPPORTED_PERIOD_TYPE" };
    }
  } catch (_err) {
    return { ok: false, reason: "INTERNAL_RESOLUTION_ERROR" };
  }
}

module.exports = {
  resolvePeriod,
  resolveMostRecentMonthOccurrence,
  getZonedYMD,
  zonedTimeToUtc,
  monthLabel,
  addMonths,
  MAX_LAST_N_MONTHS,
};
