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
  // Batch 2: additive only -- every existing intent above is unchanged.
  "ANOMALY_EXPLANATION",
  "SPENDING_FORECAST_EXPLANATION",
  "FINANCIAL_RISK_EXPLANATION",
]);

// -- Batch 2 shared helpers -----------------------------------------------

const isFiniteNumberCtx = (value) => typeof value === "number" && Number.isFinite(value);
const isPlainObjectCtx = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// Bounded copy of one public anomaly record -- only the exact fields
// expenseAnomalyAnalyzer.js's own frozen output contract guarantees
// (already free of userId/raw expense objects/internal sort keys). A newly
// constructed object every time, so no reference to the stored Report is
// ever retained.
function copyAnomalyRecord(record) {
  if (!isPlainObjectCtx(record)) return null;
  return {
    expenseId: typeof record.expenseId === "string" ? record.expenseId : null,
    category: typeof record.category === "string" ? record.category : null,
    amount: isFiniteNumberCtx(record.amount) ? record.amount : null,
    expenseDate: typeof record.expenseDate === "string" ? record.expenseDate : null,
    severity: typeof record.severity === "string" ? record.severity : null,
    reasonCode: typeof record.reasonCode === "string" ? record.reasonCode : null,
  };
}

// Bounded copy of one forecast horizon's public fields -- estimate/range
// only, always paired with `isEstimate: true` so the LLM (and, downstream,
// the user-facing prompt) can never mistake a statistical projection for an
// authoritative recorded fact.
function copyForecastHorizon(horizon) {
  if (!isPlainObjectCtx(horizon)) return null;
  return {
    hasData: horizon.hasData === true,
    reasonCode: typeof horizon.reasonCode === "string" ? horizon.reasonCode : null,
    isEstimate: true,
    estimate: isFiniteNumberCtx(horizon.estimate) ? horizon.estimate : null,
    range: isPlainObjectCtx(horizon.range)
      ? {
          lower: isFiniteNumberCtx(horizon.range.lower) ? horizon.range.lower : null,
          upper: isFiniteNumberCtx(horizon.range.upper) ? horizon.range.upper : null,
        }
      : null,
    historyMonthsUsed: isFiniteNumberCtx(horizon.historyMonthsUsed) ? horizon.historyMonthsUsed : null,
    horizonMonths: isFiniteNumberCtx(horizon.horizonMonths) ? horizon.horizonMonths : null,
  };
}

// Prediction Layer V1: the bounded per-category forecast breakdown.
//
// Only the category NAME, its predicted amount and its share are copied --
// these are already-aggregated monthly projections, never a transaction,
// never a merchant/expense name, never an id or date. Capped at
// MAX_FORECAST_CATEGORIES so an account with many categories cannot grow
// the prompt without bound; the analyzer's own output is already sorted
// largest-first, so the cap keeps exactly the categories a "which category
// will be highest" question is about.
const MAX_FORECAST_CATEGORIES = 5;

function copyForecastCategories(categories) {
  if (!Array.isArray(categories)) return [];
  return categories
    .filter(isPlainObjectCtx)
    .slice(0, MAX_FORECAST_CATEGORIES)
    .map((entry) => ({
      category: typeof entry.category === "string" ? entry.category : null,
      predictedAmount: isFiniteNumberCtx(entry.predictedAmount) ? entry.predictedAmount : null,
      sharePercentage: isFiniteNumberCtx(entry.sharePercentage) ? entry.sharePercentage : null,
      isEstimate: true,
    }))
    .filter((entry) => entry.category !== null);
}

// Prediction Layer V1: forecast-vs-budget risk for the target month, copied
// field-by-field from forecastBudgetRisk.js's own bounded output. Carries no
// budget document, no month history and no user identifier.
function copyForecastBudgetRisk(budgetRisk) {
  if (!isPlainObjectCtx(budgetRisk)) return null;
  return {
    status: typeof budgetRisk.status === "string" ? budgetRisk.status : null,
    budgetAmount: isFiniteNumberCtx(budgetRisk.budgetAmount) ? budgetRisk.budgetAmount : null,
    predictedUtilizationPercentage: isFiniteNumberCtx(budgetRisk.predictedUtilizationPercentage)
      ? budgetRisk.predictedUtilizationPercentage
      : null,
    predictedRemaining: isFiniteNumberCtx(budgetRisk.predictedRemaining) ? budgetRisk.predictedRemaining : null,
    isEstimate: true,
  };
}

// Prediction Layer V1: the descriptive data-quality summary, so SIA can
// explain WHY a forecast is limited or unavailable instead of inventing a
// prediction. `warnings` are fixed, developer-authored reason codes from
// forecastRules.js -- never free text derived from user data.
function copyForecastDataQuality(dataQuality) {
  if (!isPlainObjectCtx(dataQuality)) return null;
  return {
    status: typeof dataQuality.status === "string" ? dataQuality.status : null,
    completedMonths: isFiniteNumberCtx(dataQuality.completedMonths) ? dataQuality.completedMonths : null,
    activeDays: isFiniteNumberCtx(dataQuality.activeDays) ? dataQuality.activeDays : null,
    warnings: Array.isArray(dataQuality.warnings)
      ? dataQuality.warnings.filter((warning) => typeof warning === "string").slice(0, 5)
      : [],
  };
}

// Bounded copy of one risk signal's public fields -- reasonCode/severity
// plus its own already-bounded evidence object (riskAnalyzer.js's own
// contract never carries a raw record or user identifier inside evidence).
function copyRiskSignal(signal) {
  if (!isPlainObjectCtx(signal)) return null;
  return {
    reasonCode: typeof signal.reasonCode === "string" ? signal.reasonCode : null,
    severity: typeof signal.severity === "string" ? signal.severity : null,
    evidence: isPlainObjectCtx(signal.evidence) ? JSON.parse(JSON.stringify(signal.evidence)) : {},
  };
}

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

  // intent === "ANOMALY_EXPLANATION" -- Batch 2. Sourced exclusively from
  // report.anomalies (expenseAnomalyAnalyzer.js's own frozen output,
  // already free of raw expense records/userId/internal sort keys). A
  // valid hasData:false no-data/zero-anomaly result is a legitimate,
  // present answer -- NOT treated as "no context" here, per the explicit
  // requirement that a report's own no-data/zero-anomaly state must be
  // distinguished from SIA's "insufficient report data" no-data case.
  if (intent === "ANOMALY_EXPLANATION") {
    const anomalies = report.anomalies;
    if (!isPresent(anomalies) || typeof anomalies.hasData !== "boolean") {
      return noDataResult(intent);
    }

    const anomalyList = Array.isArray(anomalies.anomalies) ? anomalies.anomalies : [];

    return {
      intent,
      fields: {
        anomalies: {
          hasData: anomalies.hasData,
          reasonCode: typeof anomalies.reasonCode === "string" ? anomalies.reasonCode : null,
          flaggedCount: isFiniteNumberCtx(anomalies.flaggedCount) ? anomalies.flaggedCount : 0,
          // Already bounded to at most 10 by expenseAnomalyRules.js's
          // maxAnomalies -- copied again here defensively (never trusts a
          // stored document's array length without re-validating).
          records: anomalyList.slice(0, 10).map(copyAnomalyRecord).filter(Boolean),
        },
      },
      sourceReportGeneratedAt,
    };
  }

  // intent === "SPENDING_FORECAST_EXPLANATION" -- Batch 2. Sourced
  // exclusively from report.forecast (forecastAnalyzer.js's own output).
  // All three horizons are included (bounded, small, already public) since
  // the classifier does not itself extract which specific horizon a
  // question named -- every value is explicitly marked `isEstimate: true`
  // so it can never be presented as a recorded fact.
  if (intent === "SPENDING_FORECAST_EXPLANATION") {
    const forecast = report.forecast;
    if (!isPresent(forecast) || typeof forecast.hasData !== "boolean") {
      return noDataResult(intent);
    }

    // Prediction Layer V1 (corrected): the answer is grounded on the TRUE
    // next-calendar-month forecast. The legacy `nextMonthForecast` field is
    // deliberately NOT sent -- despite its name it projects the CURRENT,
    // in-progress month, so grounding a "how much might I spend next month"
    // answer on it would silently answer a different question. If the true
    // field is absent (e.g. an older cached report), the context reports it
    // as unavailable rather than substituting the legacy value.
    const nextCalendarMonth = copyForecastHorizon(forecast.nextCalendarMonthForecast);

    return {
      intent,
      fields: {
        forecast: {
          hasData: forecast.hasData,
          method: typeof forecast.method === "string" ? forecast.method : null,
          historyMonthsAvailable: isFiniteNumberCtx(forecast.historyMonthsAvailable)
            ? forecast.historyMonthsAvailable
            : 0,
          // The target period, the data-quality summary (so an unavailable/
          // limited forecast can be explained with the real reason rather
          // than guessed at), the per-category breakdown and the
          // target-month budget-risk status. Every one of these is a
          // bounded, already-aggregated figure -- no transaction, no raw
          // history series, no identifier reaches the provider.
          targetMonth: typeof forecast.targetMonth === "string" ? forecast.targetMonth : null,
          dataQuality: copyForecastDataQuality(forecast.dataQuality),
          nextCalendarMonthForecast: nextCalendarMonth
            ? {
                ...nextCalendarMonth,
                targetMonth:
                  typeof forecast.nextCalendarMonthForecast?.targetMonth === "string"
                    ? forecast.nextCalendarMonthForecast.targetMonth
                    : null,
                categories: copyForecastCategories(forecast.nextCalendarMonthForecast?.categories),
              }
            : null,
          nextQuarterForecast: copyForecastHorizon(forecast.nextQuarterForecast),
          nextYearForecast: copyForecastHorizon(forecast.nextYearForecast),
          budgetRisk: copyForecastBudgetRisk(forecast.budgetRisk),
        },
      },
      sourceReportGeneratedAt,
    };
  }

  // intent === "FINANCIAL_RISK_EXPLANATION" -- Batch 2. Sourced from
  // report.risk (riskAnalyzer.js's own bounded, allowlisted output) plus
  // only the two directly-referenced summary fields riskAnalyzer.js's own
  // evidence already reflects (totalSpent, budgetStatus) -- never the
  // complete report, never raw budget/spending internals.
  if (intent === "FINANCIAL_RISK_EXPLANATION") {
    const risk = report.risk;
    if (!isPresent(risk) || typeof risk.hasData !== "boolean") {
      return noDataResult(intent);
    }

    const signalList = Array.isArray(risk.signals) ? risk.signals : [];

    return {
      intent,
      fields: {
        risk: {
          hasData: risk.hasData,
          reasonCode: typeof risk.reasonCode === "string" ? risk.reasonCode : null,
          riskLevel: typeof risk.riskLevel === "string" ? risk.riskLevel : "none",
          signalCount: isFiniteNumberCtx(risk.signalCount) ? risk.signalCount : 0,
          signals: signalList.slice(0, 10).map(copyRiskSignal).filter(Boolean),
        },
        summary: {
          totalSpent: isFiniteNumberCtx(summary.totalSpent) ? summary.totalSpent : null,
          budgetStatus: typeof summary.budgetStatus === "string" ? summary.budgetStatus : null,
        },
      },
      sourceReportGeneratedAt,
    };
  }

  // Unreachable: SUPPORTED_INTENTS above only ever admits the seven
  // intents handled explicitly above. Kept as an explicit, honest
  // fallback rather than an assumption, matching this module's existing
  // "never assume" convention -- if an eighth intent is ever added to
  // SUPPORTED_INTENTS without a matching branch here, this returns the
  // same safe no-data shape instead of silently returning undefined.
  return noDataResult(intent);
}

module.exports = {
  buildContext,
};
