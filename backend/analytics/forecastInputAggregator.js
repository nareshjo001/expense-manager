// Forecast input aggregation boundary -- the only module that reads transaction-level fields (expenseDate, expenseAmount) off a raw expense pool; it converts them into a bounded, aggregate-only series before anything reaches forecastAnalyzer.js, which has no code path reading individual transaction fields. Pure, deterministic, non-mutating, no DB/Redis/HTTP calls.
"use strict";

const { forecast: RULES } = require("./analyzers/scores/forecastRules");
const { normalizeCategoryForGrouping } = require("../utils/categoryNormalization");

const toFiniteAmount = (value) => {
  // Number(Object.create(null)) and similar valueOf/toString-less objects throw a TypeError rather than returning NaN -- caught so one malformed record can't crash aggregation.
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

// `YYYY-M` bucket key from a Date's local calendar fields -- matches this repository's established local-time convention.
const monthKeyOf = (date) => `${date.getFullYear()}-${date.getMonth()}`;

/* Builds the bounded, aggregate-only completed-month series forecasting consumes. Malformed records are silently skipped, never thrown. The current in-progress month is never included. A month with a recorded expense total of exactly 0 still appears as an explicit entry; a month with NO recorded expenses at all has no entry (genuinely absent from history, not zero-filled) -- these two cases are indistinguishable from stored data alone, so this module only counts months it has direct evidence for. */
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

// Aggregate scalar total for the current in-progress month -- a single number, never the raw record array, so it never crosses the forecastAnalyzer.js boundary as transaction-shaped data.
function computeCurrentPartialMonthTotal(currentMonthExpenses) {
  const source = Array.isArray(currentMonthExpenses) ? currentMonthExpenses : [];
  const total = source.reduce((sum, record) => {
    if (!record || typeof record !== "object") return sum;
    const amount = toFiniteAmount(record.expenseAmount);
    return amount === null ? sum : sum + amount;
  }, 0);
  return round2(total);
}

/* Per-category equivalent of buildCompletedMonthSeries() -- the only place transaction-level `expenseCategory` is read for forecasting, emitting aggregate-only entries. Categories are discovered entirely from the data (no fixed list); the grouping key is the shared normalizer's output (utils/categoryNormalization.js), so case/whitespace/alias variants of the same category ("Food"/"food", "Medical"/"Health") merge into one entry instead of fragmenting the trend fit. A record with a missing/blank category groups under the explicit `Uncategorized` marker rather than being skipped, so category amounts still sum to the published total. Every category is aligned against the canonical completed-month timeline buildCompletedMonthSeries() emits: a month on that timeline with nothing recorded for this category becomes an explicit 0 rather than a gap, which is what prevents an intermittent category's sparse history from over-predicting its trend. */
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

    const date = parseDate(record.expenseDate);
    if (!date) continue;
    if (date < earliestAllowed || date >= monthStart) continue;

    const amount = toFiniteAmount(record.expenseAmount);
    if (amount === null) continue;

    // Computed only for records that survive the guards above; never returns null/empty, so every record that reaches the total also reaches exactly one category bucket.
    const category = normalizeCategoryForGrouping(record.expenseCategory);

    const key = monthKeyOf(date);
    if (!byCategory.has(category)) byCategory.set(category, new Map());
    const months = byCategory.get(category);
    months.set(key, (months.get(key) ?? 0) + amount);
  }

  // Canonical completed-month timeline, derived by calling buildCompletedMonthSeries() rather than re-deriving the rule here, so the two can never disagree about which months are eligible.
  const canonicalMonthKeys = buildCompletedMonthSeries(expensePool, monthStart).map(
    (point) => point.monthKey
  );

  return [...byCategory.entries()]
    .map(([category, months]) => ({
      category,
      // Aligned against every canonical month: a month with nothing recorded becomes an explicit 0, so an intermittent category is evaluated over its true timeline, not just the months it appeared in.
      monthlySeries: canonicalMonthKeys.map((key) => ({
        monthKey: key,
        totalAmount: months.has(key) ? round2(months.get(key)) : 0,
      })),
    }))
    .filter((entry) => entry.monthlySeries.length > 0)
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}

// Count of distinct calendar days with at least one valid expense in the completed-month window -- a single scalar for the forecast's data-quality summary, never a date list. Counts days with recorded activity, not calendar span (12 days spread across 6 months is 12 active days, not ~180).
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
