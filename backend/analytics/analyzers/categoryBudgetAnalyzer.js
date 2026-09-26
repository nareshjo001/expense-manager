"use strict";

// BUD-001-T04 -- deterministic threshold/risk facts for category budgets.
// Produces the `<summary>` shape documented in section 3 of
// docs/budgets/BUD-001-T01-category-budget-invariants.md.
//
// PURE: no I/O, no Date.now()/new Date() -- `now` is injected by the caller
// (service/controller), so the same inputs always yield the same output.
// Every threshold and month rule comes from categoryBudgetContract.js
// (which in turn reuses budgetAnalyzer.js's STATUS_THRESHOLDS); nothing is
// re-declared here.

const {
  ROLLOVER_POLICY,
  currentMonth,
  monthDiff,
  monthToRange,
  utilizationPercent,
  statusForMinor,
} = require("../../Services/BudgetServices/categoryBudgetContract");

const DAY_MS = 24 * 60 * 60 * 1000;
const AT_RISK_PROJECTED_STATUSES = new Set(["Critical", "Overspent"]);

const toMinor = (value) => (Number.isFinite(value) ? value : 0);

// Deterministic, locale-independent string ordering (localeCompare depends
// on the process's ICU/locale, which would make the output environment-
// dependent).
const compareStrings = (a, b) => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

// Days in a "YYYY-MM" month from the same server-local boundaries the
// total budget uses. Math.round absorbs a DST transition inside the month
// (a 23h or 25h day), which would otherwise make the raw difference a
// non-integer number of days.
const daysInMonthOf = (month) => {
  const { monthStart, monthEnd } = monthToRange(month);
  return Math.round((monthEnd.getTime() - monthStart.getTime()) / DAY_MS);
};

// Straight-line pace to month end (I10 facts, section 3):
//   current month -> spent / daysElapsed * daysInMonth
//   past month    -> spent (the month is final)
//   future month  -> null (nothing to extrapolate from)
const calculateProjectedSpentMinor = ({ spentMinor, month, now }) => {
  const offset = monthDiff(currentMonth(now), month);
  if (offset > 0) return null;
  if (offset < 0) return spentMinor;

  const daysElapsed = Math.max(1, now.getDate());
  const daysInMonth = daysInMonthOf(month);
  return Math.round((spentMinor / daysElapsed) * daysInMonth);
};

const analyzeAllocation = ({ allocation, spentByCategory, month, now }) => {
  const category = allocation.category;
  const amountMinor = toMinor(allocation.amountMinor);
  const spentMinor = toMinor(spentByCategory.get(category));
  const utilization = utilizationPercent(spentMinor, amountMinor);
  const status = statusForMinor(spentMinor, amountMinor);

  const projectedSpentMinor = calculateProjectedSpentMinor({ spentMinor, month, now });
  const projectedStatus =
    projectedSpentMinor === null ? null : statusForMinor(projectedSpentMinor, amountMinor);

  return {
    id: String(allocation._id ?? allocation.id),
    category,
    amountMinor,
    spentMinor,
    remainingMinor: amountMinor - spentMinor,
    utilization,
    status,
    projectedSpentMinor,
    projectedStatus,
    // Only a month still in progress can be "at risk": for a closed month the
    // projection equals the actual, so a finished month sitting at Critical
    // would otherwise be flagged as a live risk it can no longer act on.
    atRisk:
      month === currentMonth(now) &&
      status !== "Overspent" &&
      AT_RISK_PROJECTED_STATUSES.has(projectedStatus),
  };
};

// Utilization desc (null -- an unusable amount -- sorts last), then
// category asc, then id asc as a final tie-break.
const compareCategories = (a, b) => {
  const ua = Number.isFinite(a.utilization) ? a.utilization : -Infinity;
  const ub = Number.isFinite(b.utilization) ? b.utilization : -Infinity;
  if (ua !== ub) return ub - ua;
  return compareStrings(a.category, b.category) || compareStrings(a.id, b.id);
};

const compareUnbudgeted = (a, b) =>
  b.spentMinor - a.spentMinor || compareStrings(a.category, b.category);

// I7 reconciliation + I9 budgeted/unbudgeted split.
const calculateTotals = ({ categories, totalSpentMinor, totalBudgetMinor, spentByCategory }) => {
  const allocatedMinor = categories.reduce((sum, c) => sum + c.amountMinor, 0);

  // Summed once per DISTINCT category: the unique index makes duplicates
  // impossible for well-formed data, but a duplicate would otherwise count
  // the same spend twice and push unbudgetedSpentMinor below zero.
  const budgetedCategories = new Set(categories.map((c) => c.category));
  let budgetedSpentMinor = 0;
  for (const category of budgetedCategories) {
    budgetedSpentMinor += toMinor(spentByCategory.get(category));
  }

  // Clamped: totalSpentMinor and spentByCategory come from the same
  // aggregation today and always reconcile, but they are two independent
  // inputs -- a caller combining a total and a map from different reads
  // (an expense deleted in between) must never get a negative figure.
  const safeTotalSpentMinor = toMinor(totalSpentMinor);
  const unbudgetedSpentMinor = Math.max(0, safeTotalSpentMinor - budgetedSpentMinor);

  const hasTotal = Number.isFinite(totalBudgetMinor);
  const total = hasTotal ? totalBudgetMinor : null;
  const overAllocated = hasTotal && allocatedMinor > total;

  return {
    totalBudgetMinor: total,
    allocatedMinor,
    unallocatedMinor: hasTotal ? Math.max(0, total - allocatedMinor) : null,
    overAllocated,
    overAllocatedByMinor: overAllocated ? allocatedMinor - total : 0,
    budgetedSpentMinor,
    unbudgetedSpentMinor,
    totalSpentMinor: safeTotalSpentMinor,
  };
};

const analyzeCategoryBudgets = ({
  month,
  allocations = [],
  spentByCategory = new Map(),
  totalSpentMinor = 0,
  totalBudgetMinor = null,
  now,
  writable = false,
} = {}) => {
  const safeAllocations = Array.isArray(allocations) ? allocations : [];
  const safeSpent = spentByCategory instanceof Map ? spentByCategory : new Map();

  const categories = safeAllocations
    .map((allocation) => analyzeAllocation({ allocation, spentByCategory: safeSpent, month, now }))
    .sort(compareCategories);

  const budgetedCategories = new Set(categories.map((c) => c.category));
  const unbudgetedCategories = [];
  for (const [category, spentMinor] of safeSpent) {
    if (budgetedCategories.has(category)) continue;
    if (!(Number.isFinite(spentMinor) && spentMinor > 0)) continue;
    unbudgetedCategories.push({ category, spentMinor });
  }
  unbudgetedCategories.sort(compareUnbudgeted);

  return {
    month,
    writable: Boolean(writable),
    rolloverPolicy: ROLLOVER_POLICY,
    asOfDate: now.toISOString(),
    totals: calculateTotals({
      categories,
      totalSpentMinor,
      totalBudgetMinor,
      spentByCategory: safeSpent,
    }),
    categories,
    unbudgetedCategories,
  };
};

module.exports = {
  analyzeCategoryBudgets,
  calculateProjectedSpentMinor,
  daysInMonthOf,
};
