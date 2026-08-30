// Transaction-to-aggregate boundary for the current-month nowcast. Raw
// expense fields are inspected only here; the analyzer receives bounded
// monthly/category totals, completion ratios and explainable adjustments.
"use strict";

const { forecast: RULES } = require("./analyzers/scores/forecastRules");
const { anomaly: ANOMALY_RULES } = require("./analyzers/scores/expenseAnomalyRules");
const { normalizeCategoryForGrouping } = require("../utils/categoryNormalization");

const round2 = (value) => Number(Number(value).toFixed(2));
const median = (values) => {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mad = (values, center) => median(values.map((value) => Math.abs(value - center)));

const toFiniteAmount = (value) => {
  try {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  } catch {
    return null;
  }
};

const parseDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const monthKeyOf = (date) => `${date.getFullYear()}-${date.getMonth()}`;

const normalizeExpenseName = (value) => {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
};

function toRow(record, earliestAllowed, endExclusive) {
  if (!record || typeof record !== "object") return null;
  const date = parseDate(record.expenseDate);
  const amount = toFiniteAmount(record.expenseAmount);
  if (!date || amount === null || date < earliestAllowed || date >= endExclusive) return null;
  return {
    source: record,
    date,
    monthKey: monthKeyOf(date),
    amount,
    category: normalizeCategoryForGrouping(record.expenseCategory),
    normalizedName: normalizeExpenseName(record.expenseName),
    displayName:
      typeof record.expenseName === "string" && record.expenseName.trim()
        ? record.expenseName.trim()
        : "Unnamed expense",
    isRecurring: record.isRecurring === true,
  };
}

function aggregateMonthly(rows) {
  const totals = new Map();
  rows.forEach((row) => totals.set(row.monthKey, (totals.get(row.monthKey) ?? 0) + row.adjustedAmount));
  return [...totals.entries()]
    .map(([monthKey, totalAmount]) => ({ monthKey, totalAmount: round2(totalAmount) }))
    .sort((a, b) => {
      const [ay, am] = a.monthKey.split("-").map(Number);
      const [by, bm] = b.monthKey.split("-").map(Number);
      return ay * 12 + am - (by * 12 + bm);
    });
}

function aggregateCategories(rows, canonicalMonthKeys) {
  const byCategory = new Map();
  rows.forEach((row) => {
    if (!byCategory.has(row.category)) byCategory.set(row.category, new Map());
    const months = byCategory.get(row.category);
    months.set(row.monthKey, (months.get(row.monthKey) ?? 0) + row.adjustedAmount);
  });
  return [...byCategory.entries()]
    .map(([category, months]) => ({
      category,
      monthlySeries: canonicalMonthKeys.map((monthKey) => ({
        monthKey,
        totalAmount: round2(months.get(monthKey) ?? 0),
      })),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function aggregateCurrentCategories(rows, field) {
  const totals = new Map();
  rows.forEach((row) => totals.set(row.category, (totals.get(row.category) ?? 0) + row[field]));
  return [...totals.entries()]
    .map(([category, amount]) => ({ category, amount: round2(amount) }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

function buildCurrentMonthForecastInput({
  recentExpensePool = [],
  currentMonthExpenses = [],
  currentMonthStart,
  asOfDate,
} = {}) {
  if (!(currentMonthStart instanceof Date) || Number.isNaN(currentMonthStart.getTime())) return null;
  const now = asOfDate instanceof Date && !Number.isNaN(asOfDate.getTime()) ? asOfDate : currentMonthStart;
  const earliestAllowed = new Date(
    currentMonthStart.getFullYear(),
    currentMonthStart.getMonth() - RULES.maxHistoryMonths,
    1
  );

  const historicalRows = (Array.isArray(recentExpensePool) ? recentExpensePool : [])
    .map((record) => toRow(record, earliestAllowed, currentMonthStart))
    .filter(Boolean);
  const monthEnd = new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() + 1, 1);
  const currentRows = (Array.isArray(currentMonthExpenses) ? currentMonthExpenses : [])
    .map((record) => toRow(record, currentMonthStart, monthEnd))
    .filter(Boolean);

  const rawMonthlyTotals = new Map();
  const nameMonths = new Map();
  historicalRows.forEach((row) => {
    rawMonthlyTotals.set(row.monthKey, (rawMonthlyTotals.get(row.monthKey) ?? 0) + row.amount);
    if (row.normalizedName) {
      if (!nameMonths.has(row.normalizedName)) nameMonths.set(row.normalizedName, new Set());
      nameMonths.get(row.normalizedName).add(row.monthKey);
    }
  });
  const typicalMonthlyTotal = median(
    [...rawMonthlyTotals.values()].filter((amount) => Number.isFinite(amount) && amount > 0)
  );

  const classify = (row, isCurrent) => {
    const unchanged = { ...row, adjustedAmount: row.amount, adjustment: null };
    if (row.isRecurring || row.amount <= 0 || !row.normalizedName || typicalMonthlyTotal <= 0) return unchanged;

    const previousNameMonths = nameMonths.get(row.normalizedName)?.size ?? 0;
    const isRareName = isCurrent
      ? previousNameMonths === 0
      : previousNameMonths <= RULES.currentMonth.maxHistoricalMonthsForRareName;
    if (!isRareName) return unchanged;

    const otherPositiveRows = historicalRows.filter(
      (candidate) => candidate !== row && candidate.amount > 0
    );
    const categoryAmounts = otherPositiveRows
      .filter((candidate) => candidate.category === row.category)
      .map((candidate) => candidate.amount);
    const overallAmounts = otherPositiveRows.map((candidate) => candidate.amount);
    let baselineAmounts = null;
    let baselineScope = null;
    if (categoryAmounts.length >= RULES.currentMonth.minCategoryBaselineRecords) {
      baselineAmounts = categoryAmounts;
      baselineScope = "category";
    } else if (overallAmounts.length >= RULES.currentMonth.minOverallBaselineRecords) {
      baselineAmounts = overallAmounts;
      baselineScope = "overall";
    }
    if (!baselineAmounts) return unchanged;

    const center = median(baselineAmounts);
    if (!(center > 0)) return unchanged;
    const dispersion = mad(baselineAmounts, center);
    const amountRatio = row.amount / center;
    let extreme = false;
    let robustUpper = center * ANOMALY_RULES.medianRatio.threshold;
    if (dispersion > 0) {
      const modifiedZ =
        (ANOMALY_RULES.modifiedZ.constant * (row.amount - center)) / dispersion;
      extreme =
        modifiedZ >= ANOMALY_RULES.modifiedZ.threshold &&
        amountRatio >= ANOMALY_RULES.modifiedZ.minAmountRatio;
      robustUpper =
        center + (ANOMALY_RULES.modifiedZ.threshold * dispersion) / ANOMALY_RULES.modifiedZ.constant;
    } else {
      extreme = amountRatio >= ANOMALY_RULES.medianRatio.threshold;
    }
    const material = row.amount >= typicalMonthlyTotal * RULES.currentMonth.minMonthlyMaterialityRatio;
    if (!extreme || !material) return unchanged;

    const adjustedAmount = Math.max(0, Math.min(row.amount, robustUpper));
    const excludedAmount = row.amount - adjustedAmount;
    if (!(excludedAmount > 0)) return unchanged;
    return {
      ...row,
      adjustedAmount,
      adjustment: {
        expenseName: row.displayName,
        category: row.category,
        originalAmount: round2(row.amount),
        baselineAmount: round2(adjustedAmount),
        excludedAmount: round2(excludedAmount),
        baselineScope,
        reasonCode: RULES.currentMonth.reasonCodes.rareHighValueExpense,
        treatment: isCurrent ? "INCLUDED_NOT_EXTRAPOLATED" : "HISTORICAL_EXCESS_NOT_CARRIED_FORWARD",
      },
    };
  };

  const adjustedHistoricalRows = historicalRows.map((row) => classify(row, false));
  const adjustedCurrentRows = currentRows.map((row) => classify(row, true));
  const monthlySeries = aggregateMonthly(adjustedHistoricalRows);
  const canonicalMonthKeys = monthlySeries.map((entry) => entry.monthKey);

  const completionRatios = canonicalMonthKeys
    .map((monthKey) => {
      const rows = adjustedHistoricalRows.filter((row) => row.monthKey === monthKey);
      const total = rows.reduce((sum, row) => sum + row.adjustedAmount, 0);
      if (!(total > 0)) return null;
      const [year, monthIndex] = monthKey.split("-").map(Number);
      const comparableDay = Math.min(now.getDate(), new Date(year, monthIndex + 1, 0).getDate());
      const throughDay = rows
        .filter((row) => row.date.getDate() <= comparableDay)
        .reduce((sum, row) => sum + row.adjustedAmount, 0);
      return Math.min(1, Math.max(0, throughDay / total));
    })
    .filter((ratio) => Number.isFinite(ratio));

  const spentSoFar = currentRows.reduce((sum, row) => sum + row.amount, 0);
  const forecastableSpentSoFar = adjustedCurrentRows.reduce(
    (sum, row) => sum + row.adjustedAmount,
    0
  );
  const historicalAdjustments = adjustedHistoricalRows
    .map((row) => row.adjustment)
    .filter(Boolean)
    .sort((a, b) => b.excludedAmount - a.excludedAmount)
    .slice(0, 10);
  const currentAdjustments = adjustedCurrentRows
    .map((row) => row.adjustment)
    .filter(Boolean)
    .sort((a, b) => b.excludedAmount - a.excludedAmount)
    .slice(0, 10);

  return {
    monthlySeries,
    categorySeries: aggregateCategories(adjustedHistoricalRows, canonicalMonthKeys),
    completionRatios,
    spentSoFar: round2(spentSoFar),
    forecastableSpentSoFar: round2(forecastableSpentSoFar),
    currentCategoryActuals: aggregateCurrentCategories(currentRows, "amount"),
    historicalAdjustments,
    currentAdjustments,
    asOfDate: now.toISOString(),
    elapsedDay: now.getDate(),
    daysInMonth: new Date(currentMonthStart.getFullYear(), currentMonthStart.getMonth() + 1, 0).getDate(),
  };
}

module.exports = { buildCurrentMonthForecastInput };
