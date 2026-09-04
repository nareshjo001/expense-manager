// SIA financial query service -- the ONLY module SIA controllers may use.
// NEVER calls into report.controller.js or report recovery.
"use strict";

const mongoose = require("mongoose");
const { ExpenseModel, IncomeModel, BudgetModel } = require("../config/Schemas");
// DAT-001-T03 -- shared with every other money-rounding call site via
// backend/utils/money.js, instead of this file's own
// Math.round(x * 100) / 100 pattern.
const { roundMoney } = require("../utils/money");

const MAX_CATEGORY_RESULTS = 20;
const MAX_PERIOD_SPAN_DAYS = 366; // mirrors the 12-month history ceiling

function toObjectId(userId) {
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  if (typeof userId === "string" && mongoose.isValidObjectId(userId)) {
    return new mongoose.Types.ObjectId(userId);
  }
  return null;
}

function isValidPeriod(period) {
  return (
    period &&
    period.start instanceof Date &&
    period.end instanceof Date &&
    !Number.isNaN(period.start.getTime()) &&
    !Number.isNaN(period.end.getTime()) &&
    period.end > period.start
  );
}

function withinHistoryCap(period) {
  const spanDays = (period.end.getTime() - period.start.getTime()) / (24 * 60 * 60 * 1000);
  return spanDays <= MAX_PERIOD_SPAN_DAYS;
}

// Escapes every regex metacharacter -- categoryFilter is always matched as
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function guardCommonInputs(userId, period) {
  const objectId = toObjectId(userId);
  if (!objectId) return { ok: false, reason: "INVALID_USER_ID" };
  if (!isValidPeriod(period)) return { ok: false, reason: "INVALID_PERIOD" };
  if (!withinHistoryCap(period)) return { ok: false, reason: "PERIOD_EXCEEDS_HISTORY_CAP" };
  return { ok: true, objectId };
}

// ---- expenses -----------------------------------------------------------

// Aggregates-only total + count for the resolved period. Zero matching
async function getExpenseTotal(userId, period) {
  const guard = guardCommonInputs(userId, period);
  if (!guard.ok) return { hasData: false, reasonCode: guard.reason, value: null, count: 0 };

  const rows = await ExpenseModel.aggregate([
    { $match: { userId: guard.objectId, expenseDate: { $gte: period.start, $lt: period.end } } },
    { $group: { _id: null, total: { $sum: "$expenseAmount" }, count: { $sum: 1 } } },
  ]);

  const row = rows[0];
  return {
    hasData: true,
    value: row ? roundMoney(row.total) : 0,
    count: row ? row.count : 0,
  };
}

async function getExpenseCount(userId, period) {
  const result = await getExpenseTotal(userId, period);
  return { hasData: result.hasData, value: result.count, reasonCode: result.reasonCode };
}

async function getDailySpendingAverage(userId, period) {
  const guard = guardCommonInputs(userId, period);
  if (!guard.ok) return { hasData: false, reasonCode: guard.reason, value: null };

  const totalResult = await getExpenseTotal(userId, period);
  const spanDays = Math.max(1, Math.round((period.end.getTime() - period.start.getTime()) / (24 * 60 * 60 * 1000)));
  const average = totalResult.value / spanDays;
  return { hasData: true, value: roundMoney(average), spanDays };
}

// Bounded, aggregate-only per-category totals -- capped at
async function getCategoryBreakdown(userId, period, { maxCategories = MAX_CATEGORY_RESULTS } = {}) {
  const guard = guardCommonInputs(userId, period);
  if (!guard.ok) return { hasData: false, reasonCode: guard.reason, categories: [] };

  const boundedMax = Math.min(Math.max(1, Number(maxCategories) || MAX_CATEGORY_RESULTS), MAX_CATEGORY_RESULTS);

  const rows = await ExpenseModel.aggregate([
    { $match: { userId: guard.objectId, expenseDate: { $gte: period.start, $lt: period.end } } },
    { $group: { _id: "$expenseCategory", total: { $sum: "$expenseAmount" }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: boundedMax },
  ]);

  return {
    hasData: true,
    categories: rows.map((r) => ({
      category: typeof r._id === "string" ? r._id : "Uncategorized",
      total: roundMoney(r.total),
      count: r.count,
    })),
  };
}

async function getTopCategory(userId, period) {
  const breakdown = await getCategoryBreakdown(userId, period, { maxCategories: 1 });
  if (!breakdown.hasData) return { hasData: false, reasonCode: breakdown.reasonCode, category: null };
  const top = breakdown.categories[0] || null;
  return { hasData: true, category: top };
}

// Category filter is always matched as a literal, case-insensitive, EXACT
const { isValidCategoryFilter } = require("./queryPlan");

async function getCategoryTotal(userId, period, categoryFilter) {
  const guard = guardCommonInputs(userId, period);
  if (!guard.ok) return { hasData: false, reasonCode: guard.reason, value: null, count: 0 };
  if (!isValidCategoryFilter(categoryFilter)) {
    return { hasData: false, reasonCode: "INVALID_CATEGORY_FILTER", value: null, count: 0 };
  }

  const exactPattern = new RegExp(`^${escapeRegExp(categoryFilter.trim())}$`, "i");
  const rows = await ExpenseModel.aggregate([
    {
      $match: {
        userId: guard.objectId,
        expenseDate: { $gte: period.start, $lt: period.end },
        expenseCategory: exactPattern,
      },
    },
    { $group: { _id: null, total: { $sum: "$expenseAmount" }, count: { $sum: 1 } } },
  ]);

  const row = rows[0];
  return {
    hasData: true,
    value: row ? roundMoney(row.total) : 0,
    count: row ? row.count : 0,
  };
}

// ---- income ---------------------------------------------------------

async function getIncomeTotal(userId, period) {
  const guard = guardCommonInputs(userId, period);
  if (!guard.ok) return { hasData: false, reasonCode: guard.reason, value: null, count: 0 };

  const rows = await IncomeModel.aggregate([
    { $match: { userId: guard.objectId, incomeDate: { $gte: period.start, $lt: period.end } } },
    { $group: { _id: null, total: { $sum: "$incomeAmount" }, count: { $sum: 1 } } },
  ]);

  const row = rows[0];
  return {
    hasData: true,
    value: row ? roundMoney(row.total) : 0,
    count: row ? row.count : 0,
  };
}

async function getIncomeCount(userId, period) {
  const result = await getIncomeTotal(userId, period);
  return { hasData: result.hasData, value: result.count, reasonCode: result.reasonCode };
}

// NET_CASH_FLOW = income total - expense total for the SAME resolved
// period. Deliberately never called "savings" anywhere in this codebase.
async function getNetCashFlow(userId, period) {
  const guard = guardCommonInputs(userId, period);
  if (!guard.ok) return { hasData: false, reasonCode: guard.reason, value: null };

  const [incomeResult, expenseResult] = await Promise.all([
    getIncomeTotal(userId, period),
    getExpenseTotal(userId, period),
  ]);

  return {
    hasData: true,
    value: roundMoney((incomeResult.value - expenseResult.value)),
    incomeTotal: incomeResult.value,
    expenseTotal: expenseResult.value,
  };
}

// ---- budget -----------------------------------------------------------

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// budgetSchema.month is a free-form "MMM YYYY" string keyed to a single
function monthKeyFromZonedYearMonth(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// Real "no budget configured" vs "0 spent" distinction lives here: a
async function getBudgetSnapshot(userId, { year, month }) {
  const objectId = toObjectId(userId);
  if (!objectId) return { hasData: false, reasonCode: "INVALID_USER_ID" };
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return { hasData: false, reasonCode: "PERIOD_NOT_SINGLE_MONTH" };
  }

  const monthKey = monthKeyFromZonedYearMonth(year, month);
  const doc = await BudgetModel.findOne({ userId: objectId, month: monthKey }).lean();

  if (!doc) {
    return { hasData: false, reasonCode: "NO_BUDGET_CONFIGURED", monthKey };
  }

  const budget = Number(doc.budget) || 0;
  const spent = Number(doc.spent) || 0;
  const remaining = roundMoney((budget - spent));
  const utilization = budget > 0 ? Math.round((spent / budget) * 10000) / 100 : null;

  return {
    hasData: true,
    monthKey,
    budget: roundMoney(budget),
    spent: roundMoney(spent),
    remaining,
    utilization,
    isOverspent: spent > budget,
    status: spent > budget ? "over_budget" : "within_budget",
  };
}

async function getPeriodComparison(userId, period, comparisonPeriod, { categoryFilter } = {}) {
  const guardCurrent = guardCommonInputs(userId, period);
  if (!guardCurrent.ok) return { hasData: false, reasonCode: guardCurrent.reason, value: null };

  const guardComp = guardCommonInputs(userId, comparisonPeriod);
  if (!guardComp.ok) return { hasData: false, reasonCode: guardComp.reason, value: null };

  let currentResult;
  let comparisonResult;

  if (categoryFilter) {
    currentResult = await getCategoryTotal(userId, period, categoryFilter);
    comparisonResult = await getCategoryTotal(userId, comparisonPeriod, categoryFilter);
  } else {
    currentResult = await getExpenseTotal(userId, period);
    comparisonResult = await getExpenseTotal(userId, comparisonPeriod);
  }

  if (!currentResult.hasData || !comparisonResult.hasData) {
    return { hasData: false, reasonCode: "COMPARISON_DATA_MISSING" };
  }

  const currentValue = currentResult.value !== null ? currentResult.value : 0;
  const comparisonValue = comparisonResult.value !== null ? comparisonResult.value : 0;
  const delta = roundMoney((currentValue - comparisonValue));
  const percentChange = comparisonValue !== 0
    ? Math.round((delta / comparisonValue) * 10000) / 100
    : null;

  return {
    hasData: true,
    value: delta,
    currentValue,
    comparisonValue,
    delta,
    percentChange,
    direction: delta > 0 ? "increase" : delta < 0 ? "decrease" : "no_change",
  };
}

async function getIncomeBreakdown(userId, period, { maxSources = MAX_CATEGORY_RESULTS } = {}) {
  const guard = guardCommonInputs(userId, period);
  if (!guard.ok) return { hasData: false, reasonCode: guard.reason, sources: [] };

  const boundedMax = Math.min(Math.max(1, Number(maxSources) || MAX_CATEGORY_RESULTS), MAX_CATEGORY_RESULTS);

  const rows = await IncomeModel.aggregate([
    { $match: { userId: guard.objectId, incomeDate: { $gte: period.start, $lt: period.end } } },
    { $group: { _id: "$incomeSource", total: { $sum: "$incomeAmount" }, count: { $sum: 1 } } },
    { $sort: { total: -1 } },
    { $limit: boundedMax },
  ]);

  return {
    hasData: true,
    sources: rows.map((r) => ({
      source: typeof r._id === "string" ? r._id : "Other",
      total: roundMoney(r.total),
      count: r.count,
    })),
  };
}

async function getIncomeSummary(userId, period) {
  const guard = guardCommonInputs(userId, period);
  if (!guard.ok) return { hasData: false, reasonCode: guard.reason, value: null, count: 0, topSource: null };

  const breakdown = await getIncomeBreakdown(userId, period, { maxSources: 1 });
  const totalResult = await getIncomeTotal(userId, period);

  if (!totalResult.hasData) {
    return { hasData: false, reasonCode: totalResult.reasonCode, value: null, count: 0, topSource: null };
  }

  const top = (breakdown.sources && breakdown.sources[0]) || null;

  return {
    hasData: true,
    value: totalResult.value,
    count: totalResult.count,
    topSource: top ? top.source : null,
    topSourceTotal: top ? top.total : null,
  };
}

async function getTrendSeries(userId, period, { timeZone } = {}) {
  const guard = guardCommonInputs(userId, period);
  if (!guard.ok) return { hasData: false, reasonCode: guard.reason, series: [] };
  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    return { hasData: false, reasonCode: "INVALID_TIME_ZONE", series: [] };
  }

  const rows = await ExpenseModel.aggregate([
    {
      $match: {
        userId: guard.objectId,
        expenseDate: { $gte: period.start, $lt: period.end },
      },
    },
    {
      $group: {
        _id: { $dateToString: { date: "$expenseDate", format: "%Y-%m", timezone: timeZone } },
        total: { $sum: "$expenseAmount" },
        count: { $sum: 1 },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ]);

  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit" });
  const partsFor = (date) =>
    Object.fromEntries(
      formatter.formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value])
    );
  const startParts = partsFor(period.start);
  const endParts = partsFor(new Date(period.end.getTime() - 1));
  const series = [];
  let year = Number(startParts.year);
  let month = Number(startParts.month);
  const endYear = Number(endParts.year);
  const endMonth = Number(endParts.month);
  while (year < endYear || (year === endYear && month <= endMonth)) {
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const match = rows.find((r) => r._id === monthKey);

    const monthName = MONTH_NAMES[month - 1];
    series.push({
      year,
      month,
      monthLabel: `${monthName} ${year}`,
      total: match ? roundMoney(match.total) : 0,
      count: match ? match.count : 0,
    });

    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }

  return {
    hasData: true,
    series,
  };
}

// V2-query execution boundary. This deliberately composes the existing
async function executeFinancialQuery({ userId, query, period, budgetYearMonth, comparisonPeriod, timeZone } = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query) || typeof query.metric !== "string") {
    return { hasData: false, reasonCode: "INVALID_QUERY" };
  }

  let result;
  switch (query.metric) {
    case "EXPENSE_TOTAL":
      result = await getExpenseTotal(userId, period);
      break;
    case "EXPENSE_COUNT":
      result = await getExpenseCount(userId, period);
      break;
    case "DAILY_SPENDING_AVERAGE":
      result = await getDailySpendingAverage(userId, period);
      break;
    case "CATEGORY_TOTAL":
      if (typeof query.categoryFilter !== "string") return { hasData: false, reasonCode: "MISSING_CATEGORY_FILTER" };
      result = await getCategoryTotal(userId, period, query.categoryFilter);
      break;
    case "CATEGORY_BREAKDOWN":
      result = await getCategoryBreakdown(userId, period);
      break;
    case "TOP_CATEGORY":
      result = await getTopCategory(userId, period);
      break;
    case "INCOME_TOTAL":
      result = await getIncomeTotal(userId, period);
      break;
    case "INCOME_COUNT":
      result = await getIncomeCount(userId, period);
      break;
    case "NET_CASH_FLOW":
      result = await getNetCashFlow(userId, period);
      break;
    case "BUDGET_AMOUNT":
    case "BUDGET_SPENT":
    case "BUDGET_REMAINING":
    case "BUDGET_UTILIZATION":
    case "BUDGET_STATUS":
      if (!budgetYearMonth || typeof budgetYearMonth !== "object") {
        return { hasData: false, reasonCode: "PERIOD_NOT_SINGLE_MONTH" };
      }
      result = await getBudgetSnapshot(userId, budgetYearMonth);
      break;
    case "PERIOD_COMPARISON":
      if (!comparisonPeriod) return { hasData: false, reasonCode: "MISSING_COMPARISON_PERIOD" };
      result = await getPeriodComparison(userId, period, comparisonPeriod, query);
      break;
    case "INCOME_BREAKDOWN":
      result = await getIncomeBreakdown(userId, period);
      break;
    case "TREND_SERIES":
      result = await getTrendSeries(userId, period, { timeZone });
      break;
    default:
      return { hasData: false, reasonCode: "UNSUPPORTED_METRIC" };
  }

  return { ...result, metric: query.metric };
}

module.exports = {
  MAX_CATEGORY_RESULTS,
  MAX_PERIOD_SPAN_DAYS,
  getExpenseTotal,
  getExpenseCount,
  getDailySpendingAverage,
  getCategoryBreakdown,
  getTopCategory,
  getCategoryTotal,
  getIncomeTotal,
  getIncomeCount,
  getNetCashFlow,
  getBudgetSnapshot,
  getPeriodComparison,
  getIncomeBreakdown,
  getIncomeSummary,
  getTrendSeries,
  executeFinancialQuery,
  monthKeyFromZonedYearMonth,
};
