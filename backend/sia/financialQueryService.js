// SIA financial query service -- the ONLY module SIA controllers may use
// to read expense/income/budget data directly from MongoDB for a
// semantically-routed direct lookup/breakdown question. Every exported
// function requires a server-owned, authenticated `userId` (never a
// client-supplied identity) and every query is scoped to it. Returns
// aggregates ONLY -- never a raw record, _id, description, merchant name,
// or ML field. Dates are always start-inclusive/end-exclusive
// ($gte start, $lt end), matching periodResolver.js's contract exactly.
// Deliberately does NOT reuse Services/GetExpenseControllers or
// fetchBudgets.js-equivalent read paths, does NOT persist any monthly
// snapshot, and NEVER calls into report.controller.js's
// recovery/refresh/sync logic -- this is a new, narrow, read-only layer,
// not a rewrite of existing report generation.
"use strict";

const mongoose = require("mongoose");
const { ExpenseModel, IncomeModel, BudgetModel } = require("../config/Schemas");

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
// a literal, case-insensitive, EXACT string, never interpreted as a
// pattern. Prevents both ReDoS and any attempt to smuggle a regex/operator
// through a "category name".
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
// expenses is a legitimate, present answer (value: 0), never "no data" --
// that distinction is reserved for metrics like BUDGET_* where the
// absence of a configured document is a genuinely different state.
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
    value: row ? Math.round(row.total * 100) / 100 : 0,
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
  return { hasData: true, value: Math.round(average * 100) / 100, spanDays };
}

// Bounded, aggregate-only per-category totals -- capped at
// MAX_CATEGORY_RESULTS, largest-first, so a user with many categories can
// never grow an unbounded result set.
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
      total: Math.round(r.total * 100) / 100,
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
// name -- never a substring/regex/path. `categoryFilter` must already be
// the queryPlan-validated, bounded, plain-string value (see
// queryPlan.js's isValidCategoryFilter) -- this function re-validates
// defensively rather than trusting the caller.
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
    value: row ? Math.round(row.total * 100) / 100 : 0,
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
    value: row ? Math.round(row.total * 100) / 100 : 0,
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
    value: Math.round((incomeResult.value - expenseResult.value) * 100) / 100,
    incomeTotal: incomeResult.value,
    expenseTotal: expenseResult.value,
  };
}

// ---- budget -----------------------------------------------------------

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// budgetSchema.month is a free-form "MMM YYYY" string keyed to a single
// calendar month (config/Schemas.js) -- this service only supports a
// budget lookup when the resolved period represents exactly one whole
// calendar month (periodLabel + explicit year/month passed in), never a
// multi-month/custom range, which has no single matching budget document.
function monthKeyFromZonedYearMonth(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

// Real "no budget configured" vs "0 spent" distinction lives here: a
// missing BudgetModel document for the resolved month is genuine no-data
// (hasBudget: false), never coerced to a zero value.
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
  const remaining = Math.round((budget - spent) * 100) / 100;
  const utilization = budget > 0 ? Math.round((spent / budget) * 10000) / 100 : null;

  return {
    hasData: true,
    monthKey,
    budget: Math.round(budget * 100) / 100,
    spent: Math.round(spent * 100) / 100,
    remaining,
    utilization,
    isOverspent: spent > budget,
    status: spent > budget ? "over_budget" : "within_budget",
  };
}

// V2-query execution boundary. This deliberately composes the existing
// aggregate-only helpers above instead of accepting database fields,
// pipelines, or transaction selectors from a caller. The semantic pipeline
// resolves the approved QueryPlan period first; this service only receives
// that resolved range plus, for budget metrics, its already-derived month.
async function executeFinancialQuery({ userId, query, period, budgetYearMonth } = {}) {
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
  executeFinancialQuery,
  monthKeyFromZonedYearMonth,
};
