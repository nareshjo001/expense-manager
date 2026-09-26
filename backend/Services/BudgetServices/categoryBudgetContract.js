"use strict";

// BUD-001-T01 -- the single, pure (no I/O) home of every rule in
// docs/budgets/BUD-001-T01-category-budget-invariants.md that more than one
// module needs. The service (T03), analyzer (T04), alert service (T06) and
// tests (T07) all import from here instead of re-declaring constants.

const { getMonthRange } = require("../HelperServices/datecal.service");
const { parseAmountInput, toMinorUnits, toRupees } = require("../../utils/money");
const { normalizeCategory, UNCATEGORIZED } = require("../../utils/categoryNormalization");
const { STATUS_THRESHOLDS } = require("../../analytics/analyzers/budgetAnalyzer");
const { MONTH_PATTERN } = require("../../models/CategoryBudget");

const CONTRACT_VERSION = 1; // I16
const ROLLOVER_POLICY = "none"; // I11
const MAX_CATEGORY_BUDGETS_PER_MONTH = 25; // I5
const MAX_CATEGORY_LENGTH = 50; // I3
const MAX_AMOUNT_RUPEES = 1000000000; // I4
const WRITABLE_MONTHS_AHEAD = 11; // I6
const MIN_READABLE_YEAR = 2000;
const MAX_READABLE_YEAR = 2099;

// I14
const ALERT_LEVELS = Object.freeze({ NONE: 0, CRITICAL: 1, OVERSPENT: 2 });

const ERROR_CODES = Object.freeze({
  INVALID_MONTH: "INVALID_MONTH",
  MONTH_NOT_WRITABLE: "MONTH_NOT_WRITABLE",
  INVALID_CATEGORY: "INVALID_CATEGORY",
  RESERVED_CATEGORY: "RESERVED_CATEGORY",
  INVALID_AMOUNT: "INVALID_AMOUNT",
  AMOUNT_OUT_OF_RANGE: "AMOUNT_OUT_OF_RANGE",
  TOO_MANY_CATEGORY_BUDGETS: "TOO_MANY_CATEGORY_BUDGETS",
  CATEGORY_BUDGET_EXCEEDS_TOTAL: "CATEGORY_BUDGET_EXCEEDS_TOTAL",
  CATEGORY_BUDGET_NOT_FOUND: "CATEGORY_BUDGET_NOT_FOUND",
  INVALID_ID: "INVALID_ID",
});

// Server-local calendar month, matching getMonthRange() (and therefore the
// total budget's own month boundaries).
function formatMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentMonth(now = new Date()) {
  return formatMonth(now);
}

// Returns { ok: true, month } or { ok: false, reason }.
function parseMonth(raw) {
  if (typeof raw !== "string" || !MONTH_PATTERN.test(raw.trim())) {
    return { ok: false, reason: ERROR_CODES.INVALID_MONTH };
  }
  const month = raw.trim();
  const year = Number(month.slice(0, 4));
  if (year < MIN_READABLE_YEAR || year > MAX_READABLE_YEAR) {
    return { ok: false, reason: ERROR_CODES.INVALID_MONTH };
  }
  return { ok: true, month };
}

// First instant of the month, server-local.
function monthToDate(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1);
}

// { monthStart, monthEnd } -- same boundaries recalculateBudget() uses.
function monthToRange(month) {
  return getMonthRange(monthToDate(month));
}

// Whole-month distance, b - a, for "YYYY-MM" strings.
function monthDiff(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

// I6 -- current month through WRITABLE_MONTHS_AHEAD months ahead.
function isWritableMonth(month, now = new Date()) {
  const diff = monthDiff(currentMonth(now), month);
  return diff >= 0 && diff <= WRITABLE_MONTHS_AHEAD;
}

// I2/I3 -- returns { ok: true, category } or { ok: false, reason }.
function normalizeBudgetCategory(raw) {
  const category = normalizeCategory(raw);
  if (category === null) {
    return { ok: false, reason: ERROR_CODES.INVALID_CATEGORY };
  }
  if (category.length > MAX_CATEGORY_LENGTH) {
    return { ok: false, reason: ERROR_CODES.INVALID_CATEGORY };
  }
  if (category.toLowerCase() === UNCATEGORIZED.toLowerCase()) {
    return { ok: false, reason: ERROR_CODES.RESERVED_CATEGORY };
  }
  return { ok: true, category };
}

// I4 -- returns { ok: true, amount, amountMinor } or { ok: false, reason }.
function parseBudgetAmount(raw) {
  const value = parseAmountInput(raw);
  if (value === null) {
    return { ok: false, reason: ERROR_CODES.INVALID_AMOUNT };
  }
  const scaled = value * 100;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-6) {
    // More than 2 decimal places -- rejected rather than silently rounded.
    return { ok: false, reason: ERROR_CODES.INVALID_AMOUNT };
  }
  if (value <= 0 || value > MAX_AMOUNT_RUPEES) {
    return { ok: false, reason: ERROR_CODES.AMOUNT_OUT_OF_RANGE };
  }
  const amountMinor = toMinorUnits(value);
  return { ok: true, amount: toRupees(amountMinor), amountMinor };
}

// I10 -- percent, 2 dp. amountMinor is always >= 1 for a stored allocation.
function utilizationPercent(spentMinor, amountMinor) {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return null;
  return Math.round((spentMinor / amountMinor) * 10000) / 100;
}

// I10 -- reuses budgetAnalyzer's tiers rather than re-declaring them.
function statusFor(utilization) {
  if (!Number.isFinite(utilization)) return null;
  return STATUS_THRESHOLDS.find((tier) => utilization <= tier.max).status;
}

// I14 -- 0 below Critical, 1 at Critical, 2 at Overspent.
function alertLevelFor(utilization) {
  const status = statusFor(utilization);
  if (status === "Overspent") return ALERT_LEVELS.OVERSPENT;
  if (status === "Critical") return ALERT_LEVELS.CRITICAL;
  return ALERT_LEVELS.NONE;
}

module.exports = {
  CONTRACT_VERSION,
  ROLLOVER_POLICY,
  MAX_CATEGORY_BUDGETS_PER_MONTH,
  MAX_CATEGORY_LENGTH,
  MAX_AMOUNT_RUPEES,
  WRITABLE_MONTHS_AHEAD,
  ALERT_LEVELS,
  ERROR_CODES,
  formatMonth,
  currentMonth,
  parseMonth,
  monthToDate,
  monthToRange,
  monthDiff,
  isWritableMonth,
  normalizeBudgetCategory,
  parseBudgetAmount,
  utilizationPercent,
  statusFor,
  alertLevelFor,
};
