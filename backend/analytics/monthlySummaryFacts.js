"use strict";

// AI-001-T02 -- the eligible-fact catalog AI-001-T01's contract defines,
// turned into code. Each entry is a stable, hand-assigned dotted-path fact
// ID versioned against reportContractVersion.js's CURRENT_REPORT_VERSION:
// AI-001-T01 decided fact IDs must be a derived view of the report
// contract, never SIA's ephemeral per-request factSet.js IDs, so a
// narrative's citedFacts are only ever interpreted against the exact
// contract version they were generated from (see this module's
// CONTRACT_VERSION export and monthlySummaryService.js's use of it).
//
// Per AI-001-T01's contract, `budgets.budgetInsights.{title,message,tip}`
// and `financialHealth.signals[].message` are canned template text, not
// computed facts, and are deliberately absent below. Where a signal's
// `id`/`metric`/`value` triple is eligible (financialHealth.topStrength /
// topWeakness), the resolver reads only those three fields and never `.message`.
//
// Every entry's `eligible(report)` mirrors its source analyzer's own
// hasData/reasonCode/hasBudget convention -- a fact is only ever returned
// when its source section is actually populated, never fabricated. This
// module does no formatting/wording and never calls a database or an LLM;
// monthlySummaryService.js (AI-001-T02's template baseline, and later
// AI-001-T03's LLM path) is responsible for turning eligible facts into
// prose.

const { CURRENT_REPORT_VERSION } = require("./reportContractVersion");

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

// financialHealth.signals[] carries {type, id, metric, value, message} --
// see backend/analytics/analyzers/scores/healthSignals.js. This reads only
// id/metric/value, exactly the triple AI-001-T01's contract allowlists.
const firstSignalOfType = (report, type) => {
  const signals = report?.financialHealth?.signals;
  if (!Array.isArray(signals)) return null;
  const found = signals.find((s) => s && s.type === type);
  return found ?? null;
};

// FACTS: id -> { label, unit, eligible(report) => boolean, resolve(report) => value }.
// `unit` is descriptive metadata for a future renderer (AI-001-T06), not
// used for any calculation here.
const FACTS = {
  "summary.totalSpent": {
    label: "Total spent this month",
    unit: "currency",
    eligible: (r) => r?.spending?.hasData === true,
    resolve: (r) => r.summary.totalSpent,
  },
  "summary.transactionCount": {
    label: "Number of transactions this month",
    unit: "count",
    eligible: (r) => r?.spending?.hasData === true,
    resolve: (r) => r.summary.transactionCount,
  },
  "summary.dailyAverage": {
    label: "Average daily spend this month",
    unit: "currency",
    eligible: (r) => r?.spending?.hasData === true,
    resolve: (r) => r.summary.dailyAverage,
  },
  "trends.monthlyTrend.direction": {
    label: "Direction of change vs. last month",
    unit: "enum",
    eligible: (r) => r?.trends?.hasData === true,
    resolve: (r) => r.trends.monthlyTrend.direction,
  },
  "trends.monthlyTrend.percentageChange": {
    label: "Percentage change in total spend vs. last month",
    unit: "percent",
    eligible: (r) => r?.trends?.hasData === true && isFiniteNumber(r.trends.monthlyTrend?.percentageChange),
    resolve: (r) => r.trends.monthlyTrend.percentageChange,
  },
  "trends.monthlyTrend.isNewSpending": {
    label: "Whether this month is new spending vs. a zero baseline",
    unit: "boolean",
    eligible: (r) => r?.trends?.hasData === true,
    resolve: (r) => r.trends.monthlyTrend.isNewSpending,
  },
  "spending.largestExpense.amount": {
    label: "Amount of the largest single expense this month",
    unit: "currency",
    // Never cites .expenseDescription/.expenseName/.expenseDate -- only
    // amount/category are eligible, matching SIA-001-T01's disclosure of
    // what financialSnapshotService.js's copySafe() already allows through.
    eligible: (r) => r?.spending?.hasData === true && r.spending.largestExpense != null,
    resolve: (r) => r.spending.largestExpense.expenseAmount,
  },
  "spending.largestExpense.category": {
    label: "Category of the largest single expense this month",
    unit: "string",
    eligible: (r) => r?.spending?.hasData === true && r.spending.largestExpense != null,
    resolve: (r) => r.spending.largestExpense.expenseCategory,
  },
  "spending.stability.coefficientOfVariation": {
    label: "Week-to-week spending volatility (coefficient of variation)",
    unit: "ratio",
    eligible: (r) => r?.spending?.hasData === true && isFiniteNumber(r.spending.stability?.coefficientOfVariation),
    resolve: (r) => r.spending.stability.coefficientOfVariation,
  },
  "budgets.status": {
    label: "This month's budget status",
    unit: "enum",
    eligible: (r) => r?.budgets?.hasBudget === true,
    resolve: (r) => r.budgets.status,
  },
  "budgets.utilization": {
    label: "Percentage of budget used this month",
    unit: "percent",
    eligible: (r) => r?.budgets?.hasBudget === true && isFiniteNumber(r.budgets.utilization),
    resolve: (r) => r.budgets.utilization,
  },
  "budgets.remainingBudget": {
    label: "Budget remaining this month",
    unit: "currency",
    eligible: (r) => r?.budgets?.hasBudget === true && isFiniteNumber(r.budgets.remainingBudget),
    resolve: (r) => r.budgets.remainingBudget,
  },
  "budgets.exceededBy": {
    label: "Amount the budget has been exceeded by",
    unit: "currency",
    eligible: (r) => r?.budgets?.hasBudget === true && r.budgets.isOverspent === true,
    resolve: (r) => r.budgets.exceededBy,
  },
  "budgets.projectedOverspendPercent": {
    label: "Projected budget overspend, at the current pace",
    unit: "percent",
    eligible: (r) =>
      r?.budgets?.hasBudget === true &&
      r.budgets.projectionReliable === true &&
      r.budgets.projectionStatus === "ProjectedOverspend",
    resolve: (r) => r.budgets.projectedOverspendPercent,
  },
  "budgets.daysUntilExhaustion": {
    label: "Days until the budget runs out, at the current pace",
    unit: "days",
    eligible: (r) => r?.budgets?.hasBudget === true && isFiniteNumber(r.budgets.daysUntilExhaustion),
    resolve: (r) => r.budgets.daysUntilExhaustion,
  },
  "categories.monthly.topCategory.category": {
    label: "This month's top spending category",
    unit: "string",
    eligible: (r) => r?.categories?.monthly?.hasData === true && r.categories.monthly.topCategory != null,
    resolve: (r) => r.categories.monthly.topCategory.category,
  },
  "categories.monthly.topCategory.total": {
    label: "Total spent in this month's top category",
    unit: "currency",
    eligible: (r) => r?.categories?.monthly?.hasData === true && r.categories.monthly.topCategory != null,
    resolve: (r) => r.categories.monthly.topCategory.total,
  },
  "categories.monthly.top3Concentration": {
    label: "Share of spend held by the top 3 categories",
    unit: "percent",
    eligible: (r) => r?.categories?.monthly?.hasData === true && isFiniteNumber(r.categories.monthly.top3Concentration),
    resolve: (r) => r.categories.monthly.top3Concentration,
  },
  "categories.monthly.biggestJump.category": {
    label: "Category with the biggest month-over-month percentage increase",
    unit: "string",
    eligible: (r) => r?.categories?.monthly?.hasData === true && r.categories.monthly.biggestJump != null,
    resolve: (r) => r.categories.monthly.biggestJump.category,
  },
  "categories.monthly.biggestJump.growthPercentage": {
    label: "Percentage increase of that category vs. last month",
    unit: "percent",
    eligible: (r) => r?.categories?.monthly?.hasData === true && r.categories.monthly.biggestJump != null,
    resolve: (r) => r.categories.monthly.biggestJump.growthPercentage,
  },
  "insights.weeklyChange.changeRatio": {
    label: "This week's spend change vs. last week",
    unit: "ratio",
    eligible: (r) => r?.insights?.weeklyChange?.hasData === true && isFiniteNumber(r.insights.weeklyChange.changeRatio),
    resolve: (r) => r.insights.weeklyChange.changeRatio,
  },
  "insights.weeklyChange.direction": {
    label: "Direction of this week's spend change vs. last week",
    unit: "enum",
    eligible: (r) => r?.insights?.weeklyChange?.hasData === true,
    resolve: (r) => r.insights.weeklyChange.direction,
  },
  "insights.weeklyChange.isSignificant": {
    label: "Whether this week's change is significant given recent volatility",
    unit: "boolean",
    eligible: (r) => r?.insights?.weeklyChange?.hasData === true,
    resolve: (r) => r.insights.weeklyChange.isSignificant,
  },
  "insights.stability.tier": {
    label: "Spending stability tier",
    unit: "enum",
    eligible: (r) => r?.insights?.stability?.hasData === true,
    resolve: (r) => r.insights.stability.tier,
  },
  "insights.categoryPattern.classification": {
    label: "Whether the dominant category looks like a steady habit or a one-off spike",
    unit: "enum",
    eligible: (r) => r?.insights?.categoryPattern?.hasData === true && r.insights.categoryPattern.classification != null,
    resolve: (r) => r.insights.categoryPattern.classification,
  },
  "insights.categoryPattern.dominantCategory": {
    label: "The dominant spending category identified by the pattern analyzer",
    unit: "string",
    eligible: (r) => r?.insights?.categoryPattern?.hasData === true && r.insights.categoryPattern.dominantCategory != null,
    resolve: (r) => r.insights.categoryPattern.dominantCategory,
  },
  "financialHealth.overall": {
    label: "Overall financial health score",
    unit: "score",
    eligible: (r) => isFiniteNumber(r?.financialHealth?.overall),
    resolve: (r) => r.financialHealth.overall,
  },
  "financialHealth.risk": {
    label: "Overall financial risk level",
    unit: "enum",
    eligible: (r) => isNonEmptyString(r?.financialHealth?.risk),
    resolve: (r) => r.financialHealth.risk,
  },
  "financialHealth.topStrength.metric": {
    label: "Metric behind this month's strongest positive signal",
    unit: "string",
    eligible: (r) => firstSignalOfType(r, "strength") != null,
    resolve: (r) => firstSignalOfType(r, "strength").metric,
  },
  "financialHealth.topStrength.value": {
    label: "Value behind this month's strongest positive signal",
    unit: "mixed",
    eligible: (r) => firstSignalOfType(r, "strength") != null,
    resolve: (r) => firstSignalOfType(r, "strength").value,
  },
  "financialHealth.topWeakness.metric": {
    label: "Metric behind this month's most significant weakness signal",
    unit: "string",
    eligible: (r) => firstSignalOfType(r, "weakness") != null,
    resolve: (r) => firstSignalOfType(r, "weakness").metric,
  },
  "financialHealth.topWeakness.value": {
    label: "Value behind this month's most significant weakness signal",
    unit: "mixed",
    eligible: (r) => firstSignalOfType(r, "weakness") != null,
    resolve: (r) => firstSignalOfType(r, "weakness").value,
  },
  "anomalies.flaggedCount": {
    label: "Number of unusual transactions flagged this month",
    unit: "count",
    eligible: (r) => r?.anomalies?.hasData === true && isFiniteNumber(r.anomalies.flaggedCount),
    resolve: (r) => r.anomalies.flaggedCount,
  },
  "forecast.nextMonthEstimate": {
    label: "Projected total spend for next month",
    unit: "currency",
    eligible: (r) => r?.forecast?.hasData === true && r.forecast.nextCalendarMonthForecast?.hasData === true,
    resolve: (r) => r.forecast.nextCalendarMonthForecast.estimate,
  },
};

// True only when `factId` is both a known ID and eligible against this
// specific report -- never returns a value for an ineligible fact.
const isFactEligible = (report, factId) => {
  const entry = FACTS[factId];
  if (!entry) return false;
  try {
    return entry.eligible(report) === true;
  } catch {
    // A malformed/partial report shape fails closed (not eligible), same
    // as every analyzer's own hasData convention -- never throws up into
    // the narrative generator.
    return false;
  }
};

// Returns { factId, label, unit, value, contractVersion } for one fact, or
// null when the fact is unknown or not eligible against this report. This
// is the ONLY way monthlySummaryService.js (and, later, AI-001-T04's
// numeric-claim validator) may read a fact value -- never a raw report
// property access, so every citation is guaranteed to have passed its
// analyzer's own hasData/reasonCode gate.
const getFact = (report, factId) => {
  if (!isFactEligible(report, factId)) return null;
  const entry = FACTS[factId];
  let value;
  try {
    value = entry.resolve(report);
  } catch {
    return null;
  }
  if (value === undefined) return null;
  return {
    factId,
    label: entry.label,
    unit: entry.unit,
    value,
    contractVersion: CURRENT_REPORT_VERSION,
  };
};

// Every fact ID currently eligible against this report, in catalog order.
const listEligibleFactIds = (report) => Object.keys(FACTS).filter((factId) => isFactEligible(report, factId));

module.exports = {
  FACT_IDS: Object.keys(FACTS),
  CONTRACT_VERSION: CURRENT_REPORT_VERSION,
  isFactEligible,
  getFact,
  listEligibleFactIds,
};
