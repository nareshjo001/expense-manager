// Centralized date-range resolution for chart operations.
// Phase 2 of the chart architecture migration — see
// BALENISA_Chart_Architecture_Target_Design.md for the full plan.
//
// This module does NOT replace any existing controller logic yet. It only
// introduces the shared functions a later migration phase will wire
// controllers up to. No controller, route, or response behavior changes as
// a result of this file existing — nothing in the codebase imports it yet.
//
// Timezone convention: every date below is constructed with the server's
// local time zone (new Date(year, month, day, ...)), matching every
// existing date calculation this module centralizes — none of those call
// sites use Date.UTC or an explicit offset. See this phase's written
// summary for the full timezone discussion.

/**
 * Resolves the start/end of a single calendar month.
 * @param {number} year - four-digit year, e.g. 2026
 * @param {number} month - 1-indexed month (1 = January, 12 = December),
 *   matching how existing controllers already receive selectedMonth/monthNum
 *   from query parameters.
 * @returns {{startDate: Date, endDate: Date}} startDate = 1st of the month
 *   at 00:00:00.000; endDate = last day of the month at 23:59:59.999
 *   (full-precision inclusive upper bound, for use with $lte-style queries).
 */
const resolveMonthRange = (year, month) => {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    return { startDate, endDate };
};

/**
 * Resolves the start/end of a single calendar year.
 * @param {number} year - four-digit year, e.g. 2026
 * @returns {{startDate: Date, endDate: Date}} startDate = Jan 1 at
 *   00:00:00.000; endDate = Dec 31 at 23:59:59.999.
 */
const resolveYearRange = (year) => {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year + 1, 0, 0, 23, 59, 59, 999);
    return { startDate, endDate };
};

/**
 * Resolves the start/end of the current calendar month (server local time).
 * @returns {{startDate: Date, endDate: Date}}
 */
const resolveCurrentMonthRange = () => {
    const now = new Date();
    return resolveMonthRange(now.getFullYear(), now.getMonth() + 1);
};

/**
 * Resolves the start/end of the current calendar year (server local time).
 * @returns {{startDate: Date, endDate: Date}}
 */
const resolveCurrentYearRange = () => {
    const now = new Date();
    return resolveYearRange(now.getFullYear());
};

/**
 * Resolves a range spanning from the earliest to the latest of a set of years.
 * @param {number[]} years - non-empty array of four-digit years, e.g. [2023, 2025]
 * @returns {{startDate: Date, endDate: Date}} startDate = Jan 1 of the
 *   smallest year; endDate = Dec 31, 23:59:59.999 of the largest year.
 */
const resolveMultiYearRange = (years) => {
    const startDate = new Date(Math.min(...years), 0, 1);
    const endDate = new Date(Math.max(...years), 11, 31, 23, 59, 59, 999);
    return { startDate, endDate };
};

/**
 * Resolves "no date bound" — the caller should fetch across the user's
 * entire history. Returns null rather than a sentinel range so callers
 * branch explicitly instead of silently treating a huge range as a real
 * bound.
 * @returns {null}
 */
const resolveAllTime = () => null;

module.exports = {
    resolveMonthRange,
    resolveYearRange,
    resolveCurrentMonthRange,
    resolveCurrentYearRange,
    resolveMultiYearRange,
    resolveAllTime
};
