// SIA context builder.
//
// M1-2 scope: retrieves a user's existing Financial Report through
// reportService.getReport(userId) -- the same, unmodified service the
// authenticated GET /report route already uses -- and narrows it down to
// only the fields a known SIA intent needs. This module never queries
// MongoDB, Redis, or any model directly, never calls reportGenerator or an
// analyzer directly, and never returns the whole Report object. It performs
// no calculation, transformation, or reinterpretation of any financial
// value -- every returned value is passed through exactly as reportService
// returned it.
//
// M2-3A scope: adds a third intent, BUDGET_STATUS_EXPLANATION, sourced
// from report.budgets (the canonical analytics/analyzers/budgetAnalyzer.js
// output). Context foundation only -- no intent classification, prompts,
// controller wiring, or response formatting are added in this milestone.
//
// M2-4A scope: adds a fourth intent, CATEGORY_SPENDING_EXPLANATION, sourced
// from report.categories.monthly (the canonical
// analytics/analyzers/categoryAnalyzer.js output for the user's current
// month). Context foundation only -- same restriction as M2-3A.
"use strict";

const reportService = require("../Services/reportService");

const SUPPORTED_INTENTS = new Set([
  "HEALTH_EXPLANATION",
  "SPENDING_CHANGE_EXPLANATION",
  "BUDGET_STATUS_EXPLANATION",
  "CATEGORY_SPENDING_EXPLANATION",
]);

// Deliberately `!== undefined && !== null`, not a truthiness check -- a
// valid `0` (e.g. totalSpent, comparePastMonth, healthScore) or a valid
// falsy-but-real value must never be treated as "missing".
function isPresent(value) {
  return value !== undefined && value !== null;
}

function noDataResult(intent) {
  return { intent, fields: null, reason: "no_data" };
}

// The report's own generation timestamp -- analytics/reportGenerator.js
// sets this exact field (`metadata.generatedAt`, an ISO string produced via
// `new Date().toISOString()`) once, at generation time. It is the only
// existing, authoritative "when was this report generated" value in the
// Report shape (confirmed in analytics/reportGenerator.js and mirrored by
// the M0-2 fixtures' buildFakeCachedReport). This module never generates a
// replacement timestamp of its own.
function getSourceReportGeneratedAt(report) {
  return report.metadata && report.metadata.generatedAt;
}

async function buildContext(userId, intent) {
  // No intent classifier or fuzzy matching exists in this milestone (see
  // backend/sia/README.md). An intent outside the currently supported
  // values is handled with the same explicit, unguessed result as any other
  // no-data case, rather than being coerced into one of the known intents.
  if (!SUPPORTED_INTENTS.has(intent)) {
    return noDataResult(intent);
  }

  let report;
  try {
    report = await reportService.getReport(userId);
  } catch (err) {
    return noDataResult(intent);
  }

  if (!isPresent(report)) {
    return noDataResult(intent);
  }

  const sourceReportGeneratedAt = getSourceReportGeneratedAt(report);
  if (!isPresent(sourceReportGeneratedAt)) {
    return noDataResult(intent);
  }

  const summary = report.summary || {};

  if (intent === "HEALTH_EXPLANATION") {
    // Corrected mapping (M1-2 production-contract fix, Option A): the real
    // report shape never populates summary.healthScore/summary.riskLevel --
    // healthAnalyzer.js's return object has no such keys, so
    // reportGenerator.js's `healthScore: healthReport.healthScore` and
    // `riskLevel: healthReport.riskLevel` are always undefined (confirmed
    // by tracing healthAnalyzer.js -> reportGenerator.js -> Report.js).
    // The real, currently-populated source values are
    // report.financialHealth.overall and report.financialHealth.risk.label.
    // The external M1-2 output keys (`healthScore`, `riskLevel`) are kept
    // unchanged -- only their internal source expressions changed, as
    // plain aliases with no calculation or reinterpretation.
    const financialHealth = report.financialHealth;
    const overall = financialHealth && financialHealth.overall;
    const risk = financialHealth && financialHealth.risk;
    const riskLabel = risk && risk.label;

    if (
      !isPresent(financialHealth) ||
      !isPresent(overall) ||
      !isPresent(risk) ||
      !isPresent(riskLabel)
    ) {
      return noDataResult(intent);
    }

    return {
      intent,
      fields: {
        financialHealth,
        summary: {
          healthScore: overall,
          riskLevel: riskLabel,
        },
      },
      sourceReportGeneratedAt,
    };
  }

  if (intent === "SPENDING_CHANGE_EXPLANATION") {
    // Unchanged from the original M1-2 implementation; summary.comparePastMonth
    // and summary.totalSpent are genuinely populated in real reports (see the
    // M1-2 contract-gap verification), so no correction applies here.
    const trends = report.trends;
    const comparePastMonth = summary.comparePastMonth;
    const totalSpent = summary.totalSpent;

    if (!isPresent(trends) || !isPresent(comparePastMonth) || !isPresent(totalSpent)) {
      return noDataResult(intent);
    }

    return {
      intent,
      fields: {
        trends,
        summary: {
          comparePastMonth,
          totalSpent,
        },
      },
      sourceReportGeneratedAt,
    };
  }

  // intent === "BUDGET_STATUS_EXPLANATION" -- M2-3A scope (context
  // foundation only; no classifier/prompt/response-formatting work belongs
  // here). Sourced exclusively from report.budgets, the canonical
  // analytics/analyzers/budgetAnalyzer.js output for the user's current
  // month, assembled verbatim by analytics/reportGenerator.js as
  // `budgets: { ...budgetReport, budgetInsights }`. summary.budgetUtilization
  // and summary.budgetStatus are NOT used -- confirmed duplicates of
  // budgets.utilization/budgets.status (reportGenerator.js sets
  // summary.comparePastMonth etc. from the same budgetReport object at
  // generation time), so the canonical analyzer object is preferred here,
  // per this milestone's grounding rules.
  //
  // Deliberately excluded from this context, and why:
  //  - budgetInsights: not a budgetAnalyzer.js value at all -- pre-written
  //    advisory/recommendation text from
  //    Services/BudgetServices/budgetInsight.service.js, including direct
  //    instructions ("Avoid additional spending...", "Set a monthly
  //    budget..."). Passing it through would risk SIA echoing financial
  //    advice, which this milestone and M2-3 explicitly forbid.
  //  - currentStreak / longestStreak / streakBrokenReason: describe
  //    multi-month budgeting discipline, a different concept from "current
  //    budget status", out of scope for this intent.
  //  - daysUntilExhaustion: unlike every other calculateBudgetProjection()
  //    field, it can legitimately be null even when hasBudget === true
  //    (whenever the report's dailyAverage <= 0), so its presence is not
  //    provably guaranteed the way the fields below are. Excluded rather
  //    than guessed at.
  if (intent === "BUDGET_STATUS_EXPLANATION") {
    const budgets = report.budgets;

    if (!isPresent(budgets) || budgets.hasData !== true) {
      return noDataResult(intent);
    }

    const budget = budgets.budget;
    const spent = budgets.spent;
    const hasBudget = budgets.hasBudget;
    const status = budgets.status;
    const isOverspent = budgets.isOverspent;
    const exceededBy = budgets.exceededBy;
    const utilization = budgets.utilization;
    const remainingBudget = budgets.remainingBudget;
    const budgetLeft = budgets.budgetLeft;
    const projectionStatus = budgets.projectionStatus;
    const projectionReliable = budgets.projectionReliable;
    const projectedSpent = budgets.projectedSpent;
    const projectedOverspend = budgets.projectedOverspend;
    const projectedOverspendPercent = budgets.projectedOverspendPercent;

    if (!isPresent(budget) || !isPresent(spent) || !isPresent(hasBudget)) {
      return noDataResult(intent);
    }

    // hasBudget === false means no budget is configured for the current
    // month (budgetAnalyzer.js's calculateBudgetUtilization returns
    // utilization/remainingBudget/budgetLeft as null in exactly that case
    // -- a real, legitimate value, not missing data). This milestone
    // treats "no budget configured" as no-data for
    // BUDGET_STATUS_EXPLANATION: there is no budget to report a status
    // against yet, and a dedicated user-facing message for that distinct
    // state is left to the milestone that owns response formatting, not
    // this context-only foundation. This is a judgment call -- see the
    // M2-3A report.
    if (hasBudget !== true) {
      return noDataResult(intent);
    }

    // Gating on hasBudget === true above guarantees, by
    // calculateBudgetUtilization/calculateBudgetStatus/
    // calculateBudgetProjection in budgetAnalyzer.js, that utilization,
    // remainingBudget, budgetLeft, and the projection fields below are
    // real values, never null (their null branches are exactly the
    // safeBudget <= 0 branch that hasBudget === false already excludes).
    // Verified explicitly here rather than assumed, matching this
    // module's existing isPresent-everywhere convention.
    if (
      !isPresent(status) ||
      !isPresent(isOverspent) ||
      !isPresent(exceededBy) ||
      !isPresent(utilization) ||
      !isPresent(remainingBudget) ||
      !isPresent(budgetLeft) ||
      !isPresent(projectionStatus) ||
      !isPresent(projectionReliable) ||
      !isPresent(projectedSpent) ||
      !isPresent(projectedOverspend) ||
      !isPresent(projectedOverspendPercent)
    ) {
      return noDataResult(intent);
    }

    return {
      intent,
      fields: {
        budget: {
          budget,
          spent,
          hasBudget,
          status,
          isOverspent,
          exceededBy,
          utilization,
          remainingBudget,
          budgetLeft,
          projectionStatus,
          projectionReliable,
          projectedSpent,
          projectedOverspend,
          projectedOverspendPercent,
        },
      },
      sourceReportGeneratedAt,
    };
  }

  // intent === "CATEGORY_SPENDING_EXPLANATION" -- M2-4A scope (context
  // foundation only; no classifier/prompt/response-formatting work belongs
  // here). Sourced exclusively from report.categories.monthly, the
  // canonical analytics/analyzers/categoryAnalyzer.js output for the
  // user's current month vs. previous month, assembled verbatim by
  // analytics/reportAssembler.js as `categories: { monthly:
  // monthlyCategoryReport, yearly: yearlyCategoryReport }`.
  // summary.topCategory is NOT used -- confirmed to be a lossy derived
  // alias (`monthlyCategoryReport.topCategory?.category ?? "N/A"`, the
  // category NAME only, with a fallback that indistinguishably conflates
  // "no data" with a real category literally named "N/A"), so the
  // canonical monthly object (which carries the full {category, total}
  // pair and cannot be confused with a missing value) is preferred, per
  // this milestone's grounding rules.
  //
  // report.categories.yearly is deliberately NOT included in this
  // context: while it shares the exact same guaranteed, safe
  // categoryAnalyzer.js contract as monthly, every other SIA intent so
  // far (health, spending-change, budget) is scoped to the current
  // reporting period only, and gating success on *both* monthly and
  // yearly independently having hasData === true would make this intent
  // spuriously return no-data for a user who has full current-month
  // category data but, e.g., is in their first year of using the app.
  // Adding yearly is left to a future milestone that can justify and
  // scope it on its own, per "do not include data merely because it
  // exists".
  //
  // Deliberately excluded from the selected fields below, and why:
  //  - biggestJump / biggestDrop: unlike every other field
  //    categoryAnalyzer.js's analyze() returns in its hasData: true
  //    branch, these two are genuinely nullable even then (e.g. when
  //    every current category is brand new -- no previous-period data to
  //    compare against -- categoryGrowth's growthPercentage/change values
  //    exclude every entry from both the "increases" and "decreases"
  //    lists that calculateBiggestChanges filters over, so both come back
  //    null). Their absence is not provable the way the fields below are,
  //    so they are excluded rather than guessed at or used to gate the
  //    whole context to no-data over an otherwise-valid month.
  //  - No pre-written insights/recommendations/advisory text exists
  //    anywhere in categoryAnalyzer.js's output (confirmed by reading its
  //    full source) -- unlike budgetAnalyzer.js, there is no sibling
  //    "generateCategoryInsights"-style service to separately exclude
  //    here.
  //
  // M2-4A reconciliation remediation: an earlier draft of this branch only
  // validated the outer monthly-object shape (isPresent + Array.isArray on
  // the six top-level fields) and then returned topCategory/leastCategory/
  // categoryDistribution/categoryGrowth by direct reference into the
  // stored Report -- neither validating each record's own nested contract
  // (categoryAnalyzer.js's exact {category, total} /
  // {category, amount, percentage} / {category, previous, current, change,
  // growthPercentage, isNewCategory, trend} shapes) nor copying them, so a
  // malformed nested record could reach the success context and a caller
  // mutating the returned context could silently corrupt the
  // cached/stored Report. The isFiniteNumber/isPlainObject/isValid*/copy*
  // helpers below fix both: every nested record is validated against its
  // exact analyzer contract before being trusted, and every returned
  // object/array is a newly-constructed, explicit-field-selection copy
  // that shares no reference with `report`.

  // True only for a genuine finite number -- rejects undefined, null,
  // NaN, +/-Infinity, and numeric strings (Number.isFinite never coerces,
  // unlike the global isFinite). Accepts legitimate zero, negative, and
  // decimal values, matching categoryAnalyzer.js's real value ranges
  // (e.g. total/amount/change/previous/current can all be negative --
  // refunds -- or exactly 0).
  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  // True only for a real, non-array, non-null object -- excludes arrays
  // (which a naive `typeof value === "object"` check would wrongly admit)
  // and null (also `typeof null === "object"`).
  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // Validates a categoryAnalyzer.js {category, total} record (topCategory
  // or leastCategory) against its exact contract. `category` is accepted
  // as-is -- no trimming, normalization, or allowlist -- and `total` must
  // be a finite number (zero/negative/decimal all valid).
  function isValidCategoryTotal(value) {
    return isPlainObject(value) && typeof value.category === "string" && isFiniteNumber(value.total);
  }

  // Builds a new {category, total} object containing only the two
  // approved fields -- breaks reference sharing with the stored Report
  // and silently excludes any unexpected/extra properties from leaking.
  function copyCategoryTotal(value) {
    return { category: value.category, total: value.total };
  }

  // Validates a single categoryDistribution record against
  // calculateCategoryDistribution()'s exact {category, amount, percentage}
  // contract.
  function isValidDistributionRecord(value) {
    return (
      isPlainObject(value) &&
      typeof value.category === "string" &&
      isFiniteNumber(value.amount) &&
      isFiniteNumber(value.percentage)
    );
  }

  function copyDistributionRecord(value) {
    return { category: value.category, amount: value.amount, percentage: value.percentage };
  }

  const VALID_CATEGORY_TRENDS = new Set(["up", "down", "same"]);

  // Validates a single categoryGrowth record against
  // calculateCategoryGrowth()'s exact contract. growthPercentage is the
  // one field analyzer.js can legitimately leave null (whenever
  // `previous <= 0`) -- accepted as null OR a finite number, nothing else.
  function isValidGrowthRecord(value) {
    return (
      isPlainObject(value) &&
      typeof value.category === "string" &&
      isFiniteNumber(value.previous) &&
      isFiniteNumber(value.current) &&
      isFiniteNumber(value.change) &&
      (value.growthPercentage === null || isFiniteNumber(value.growthPercentage)) &&
      typeof value.isNewCategory === "boolean" &&
      VALID_CATEGORY_TRENDS.has(value.trend)
    );
  }

  function copyGrowthRecord(value) {
    return {
      category: value.category,
      previous: value.previous,
      current: value.current,
      change: value.change,
      growthPercentage: value.growthPercentage,
      isNewCategory: value.isNewCategory,
      trend: value.trend,
    };
  }

  if (intent === "CATEGORY_SPENDING_EXPLANATION") {
    const monthlyCategories = report.categories && report.categories.monthly;

    if (!isPresent(monthlyCategories) || monthlyCategories.hasData !== true) {
      return noDataResult(intent);
    }

    const topCategory = monthlyCategories.topCategory;
    const leastCategory = monthlyCategories.leastCategory;
    const categoryDistribution = monthlyCategories.categoryDistribution;
    const concentrationIndex = monthlyCategories.concentrationIndex;
    const top3Concentration = monthlyCategories.top3Concentration;
    const categoryGrowth = monthlyCategories.categoryGrowth;

    // Every nested record is validated against categoryAnalyzer.js's exact
    // contract -- not just checked for top-level presence -- so a stale,
    // differently-shaped, or partially-corrupted stored Report document
    // returns no-data instead of leaking malformed data into the context.
    if (
      !isValidCategoryTotal(topCategory) ||
      !isValidCategoryTotal(leastCategory) ||
      !isFiniteNumber(concentrationIndex) ||
      !isFiniteNumber(top3Concentration) ||
      !Array.isArray(categoryDistribution) ||
      categoryDistribution.length === 0 ||
      !categoryDistribution.every(isValidDistributionRecord) ||
      !Array.isArray(categoryGrowth) ||
      categoryGrowth.length === 0 ||
      !categoryGrowth.every(isValidGrowthRecord)
    ) {
      return noDataResult(intent);
    }

    // Explicit field selection into newly-constructed objects/arrays --
    // shares no reference with `report`, and cannot leak any unexpected or
    // sensitive extra property a stored record might carry. Array order is
    // preserved exactly (.map() never reorders); no value is coerced,
    // rounded, formatted, or recalculated.
    return {
      intent,
      fields: {
        categories: {
          topCategory: copyCategoryTotal(topCategory),
          leastCategory: copyCategoryTotal(leastCategory),
          categoryDistribution: categoryDistribution.map(copyDistributionRecord),
          concentrationIndex,
          top3Concentration,
          categoryGrowth: categoryGrowth.map(copyGrowthRecord),
        },
      },
      sourceReportGeneratedAt,
    };
  }

  // Unreachable: SUPPORTED_INTENTS above only ever admits the four
  // intents handled explicitly above. Kept as an explicit, honest
  // fallback rather than an assumption, matching this module's existing
  // "never assume" convention -- if a fifth intent is ever added to
  // SUPPORTED_INTENTS without a matching branch here, this returns the
  // same safe no-data shape instead of silently returning undefined.
  return noDataResult(intent);
}

module.exports = {
  buildContext,
};
