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

/**
 * Prediction Layer V1: the per-CATEGORY equivalent of
 * buildCompletedMonthSeries() above, and the only place transaction-level
 * `expenseCategory` is read for forecasting purposes. Emits aggregate-only
 * `{ category, monthlySeries: [{ monthKey, totalAmount }] }` entries --
 * never a raw record, never an amount attributable to a single expense.
 *
 * Categories are discovered ENTIRELY from the data: there is no fixed list,
 * no fixed count, and no hard-coded category name anywhere in this
 * function. A record whose category is missing/blank/non-string is skipped
 * rather than being bucketed under a guessed default, so the breakdown
 * never invents a category the user does not actually have.
 *
 * Same window, same exclusions and same skip-don't-throw policy as
 * buildCompletedMonthSeries(): complete calendar months strictly before
 * `monthStart` only, bounded to `RULES.maxHistoryMonths`, malformed records
 * silently dropped, input never mutated, output order deterministic
 * (categories sorted by name ascending; each series oldest-first).
 *
 * TIMELINE ALIGNMENT (Prediction Layer V1 correction). Every category is
 * aligned against ONE canonical completed-month timeline -- exactly the
 * months buildCompletedMonthSeries() emitted, i.e. the months in which the
 * user had ANY eligible spending. A month that is on that timeline but in
 * which this category recorded nothing is emitted as an explicit
 * `totalAmount: 0` point, not omitted.
 *
 * This is the fix for a real misallocation defect: previously a category
 * seen in only 3 scattered months of a 12-month active timeline produced a
 * 3-point series, so its own trend fit (and the sparse smoothed-share
 * fallback) treated those 3 observations as the category's ENTIRE history
 * and predicted as if it spent that much every month -- over-predicting an
 * intermittent category roughly 4x in the observed case and, because the
 * breakdown reconciles to a fixed total, under-predicting the regular
 * categories by the same amount. Zero-filling against the canonical
 * timeline makes "this category was absent that month" a real observation
 * of zero, which is what it actually is.
 *
 * Deliberately bounded: zeros are inserted ONLY for months already on the
 * canonical timeline. The current partial month is never added (it is not
 * on that timeline), months outside the usable history window are never
 * added, and a month in which the user genuinely recorded nothing at all
 * stays absent for every category -- this function never invents activity
 * the user did not have.
 *
 * @param {Array} expensePool - raw expense records (e.g. recentExpensePool).
 * @param {Date} monthStart - first instant of the current, in-progress month.
 * @returns {Array<{category: string, monthlySeries: Array<{monthKey: string, totalAmount: number}>}>}
 */
function buildCompletedMonthCategorySeries(expensePool, monthStart) {
  if (!(monthStart instanceof Date) || Number.isNaN(monthStart.getTime())) {
    return [];
  }

  const earliestAllowed = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() - RULES.maxHistoryMonths,
    1
  );

  // category -> (monthKey -> total)
  const byCategory = new Map();
  const source = Array.isArray(expensePool) ? expensePool : [];

  for (const record of source) {
    if (!record || typeof record !== "object") continue;

    const category = typeof record.expenseCategory === "string" ? record.expenseCategory.trim() : "";
    if (category === "") continue;

    const date = parseDate(record.expenseDate);
    if (!date) continue;
    if (date < earliestAllowed || date >= monthStart) continue;

    const amount = toFiniteAmount(record.expenseAmount);
    if (amount === null) continue;

    const key = monthKeyOf(date);
    if (!byCategory.has(category)) byCategory.set(category, new Map());
    const months = byCategory.get(category);
    months.set(key, (months.get(key) ?? 0) + amount);
  }

  // The canonical completed-month timeline: exactly the months
  // buildCompletedMonthSeries() emits for this same pool and anchor -- the
  // months the user had ANY eligible spending in. Derived by calling that
  // function rather than re-deriving the rule here, so the two can never
  // disagree about which months are eligible.
  const canonicalMonthKeys = buildCompletedMonthSeries(expensePool, monthStart).map(
    (point) => point.monthKey
  );

  return [...byCategory.entries()]
    .map(([category, months]) => ({
      category,
      // Aligned against every canonical month: a month on the timeline in
      // which this category recorded nothing becomes an explicit 0, so an
      // intermittent category is evaluated over its true timeline rather
      // than only the months it happened to appear in.
      monthlySeries: canonicalMonthKeys.map((key) => ({
        monthKey: key,
        totalAmount: months.has(key) ? round2(months.get(key)) : 0,
      })),
    }))
    .filter((entry) => entry.monthlySeries.length > 0)
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}

/**
 * Prediction Layer V1: count of DISTINCT calendar days carrying at least
 * one valid expense inside the same completed-month window. A single
 * descriptive scalar for the forecast's data-quality summary -- never a
 * date list, never a per-day breakdown, so nothing transaction-shaped
 * crosses this boundary.
 *
 * "Active days" deliberately counts days with recorded activity, not the
 * calendar span: a user who logged expenses on 12 days spread across 6
 * months has 12 active days, not ~180.
 */
function countActiveDays(expensePool, monthStart) {
  if (!(monthStart instanceof Date) || Number.isNaN(monthStart.getTime())) {
    return 0;
  }

  const earliestAllowed = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() - RULES.maxHistoryMonths,
    1
  );

  const days = new Set();
  const source = Array.isArray(expensePool) ? expensePool : [];

  for (const record of source) {
    if (!record || typeof record !== "object") continue;

    const date = parseDate(record.expenseDate);
    if (!date) continue;
    if (date < earliestAllowed || date >= monthStart) continue;

    if (toFiniteAmount(record.expenseAmount) === null) continue;

    days.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
  }

  return days.size;
}

module.exports = {
  buildCompletedMonthSeries,
  computeCurrentPartialMonthTotal,
  buildCompletedMonthCategorySeries,
  countActiveDays,
};
