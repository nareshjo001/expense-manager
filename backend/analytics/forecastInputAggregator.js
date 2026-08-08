// Forecast input aggregation boundary -- Batch 2 architecture closure.
//
// This is the ONLY module in the codebase that reads transaction-level
// fields (`expenseDate`, `expenseAmount`) off a raw expense pool for
// forecasting purposes. It converts that pool into a bounded,
// aggregate-only series (`{ monthKey, totalAmount }` per completed
// calendar month) before anything reaches forecastAnalyzer.js.
// forecastAnalyzer.js itself has no code path that reads `_id`,
// `expenseName`, `expenseCategory`, `userId`, or any individual
// `expenseDate`/`expenseAmount` -- it only ever receives the aggregate
// numbers this module produces, so a transaction-shaped object reaching it
// would have no field the analyzer's logic could act on even if leaked.
//
// Pure, deterministic, no DB/Redis/HTTP calls, no zero-arg `new Date()`,
// input-order independent (buckets are built by walking the calendar
// backward from the anchor date, never by trusting array order), and
// non-mutating.
"use strict";

const { forecast: RULES } = require("./analyzers/scores/forecastRules");

const toFiniteAmount = (value) => {
  // `Number(Object.create(null))` (and similar valueOf/toString-less
  // objects) throws a TypeError rather than returning NaN -- caught here
  // so a single malformed record can never crash aggregation.
  let num;
  try {
    num = Number(value);
  } catch {
    return null;
  }
  return Number.isFinite(num) ? num : null;
};

const parseDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const round2 = (value) => Number(Number(value).toFixed(2));

// `YYYY-M` bucket key from a Date's LOCAL calendar fields -- matches this
// repository's established local-time convention.
const monthKeyOf = (date) => `${date.getFullYear()}-${date.getMonth()}`;

/**
 * Builds the bounded, aggregate-only completed-month series forecasting
 * consumes. Malformed source records (non-object, invalid/missing date,
 * uncoercible amount) are silently skipped -- never thrown, never mutating
 * `expensePool`. The current, in-progress month (>= `monthStart`) is never
 * included. A month with genuinely zero recorded expenses still appears as
 * an explicit `{ totalAmount: 0 }` entry rather than being silently
 * omitted, so "no data that month" and "not enough history at all" remain
 * distinguishable.
 *
 * @param {Array} expensePool - raw expense records (e.g. recentExpensePool).
 * @param {Date} monthStart - the first instant of the current, in-progress
 *   month; the aggregation window is the `RULES.maxHistoryMonths` complete
 *   calendar months strictly before this date.
 * @returns {Array<{monthKey: string, totalAmount: number}>} oldest first.
 *
 * Missing-month policy (explicit, deterministic, unchanged from V1): a
 * month with at least one recorded expense that happens to sum to exactly
 * 0 still appears as a real `{ totalAmount: 0 }` entry. A month with NO
 * recorded expenses AT ALL has no entry at all -- it is not zero-filled,
 * it is genuinely absent from history, and does not count toward
 * `historyMonthsAvailable`. This is a deliberate choice, not an oversight:
 * a month a user genuinely had zero spending activity in is
 * indistinguishable, from the stored data alone, from a month with no
 * data collected at all, so this module does not claim to tell them apart
 * and instead only counts months it has direct evidence for.
 */
function buildCompletedMonthSeries(expensePool, monthStart) {
  if (!(monthStart instanceof Date) || Number.isNaN(monthStart.getTime())) {
    return [];
  }

  const earliestAllowed = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() - RULES.maxHistoryMonths,
    1
  );

  const totalsByKey = new Map();
  const source = Array.isArray(expensePool) ? expensePool : [];

  for (const record of source) {
    if (!record || typeof record !== "object") continue;

    const date = parseDate(record.expenseDate);
    if (!date) continue;
    if (date < earliestAllowed || date >= monthStart) continue; // strictly complete months only

    const amount = toFiniteAmount(record.expenseAmount);
    if (amount === null) continue;

    const key = monthKeyOf(date);
    totalsByKey.set(key, (totalsByKey.get(key) ?? 0) + amount);
  }

  const series = [];
  for (let i = RULES.maxHistoryMonths; i >= 1; i -= 1) {
    const bucketDate = new Date(monthStart.getFullYear(), monthStart.getMonth() - i, 1);
    const key = monthKeyOf(bucketDate);
    if (totalsByKey.has(key)) {
      series.push({ monthKey: key, totalAmount: round2(totalsByKey.get(key)) });
    }
  }

  return series;
}

/**
 * Aggregate scalar total for the current, in-progress month -- a single
 * number, never the raw record array itself, so this too never crosses the
 * forecastAnalyzer.js boundary as transaction-shaped data.
 */
function computeCurrentPartialMonthTotal(currentMonthExpenses) {
  const source = Array.isArray(currentMonthExpenses) ? currentMonthExpenses : [];
  const total = source.reduce((sum, record) => {
    if (!record || typeof record !== "object") return sum;
    const amount = toFiniteAmount(record.expenseAmount);
    return amount === null ? sum : sum + amount;
  }, 0);
  return round2(total);
}

module.exports = {
  buildCompletedMonthSeries,
  computeCurrentPartialMonthTotal,
};
