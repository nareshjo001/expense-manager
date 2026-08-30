// SIA context builder -- retrieves a user's existing Financial Report via reportService.getReport(userId) (the same service GET /report uses) and narrows it to only the fields a known SIA intent needs. Never queries MongoDB/Redis/any model directly, never calls reportGenerator or an analyzer directly, never returns the whole Report object, and performs no calculation/transformation/reinterpretation -- every returned value passes through exactly as reportService returned it.
"use strict";

const reportService = require("../Services/reportService");

const SUPPORTED_INTENTS = new Set([
  "HEALTH_EXPLANATION",
  "SPENDING_CHANGE_EXPLANATION",
  "BUDGET_STATUS_EXPLANATION",
  "CATEGORY_SPENDING_EXPLANATION",
  // Additive only -- every existing intent above is unchanged.
  "ANOMALY_EXPLANATION",
  "SPENDING_FORECAST_EXPLANATION",
  "FINANCIAL_RISK_EXPLANATION",
  // Additive only -- a bare current-month total lookup, the smallest
  // possible context of the eight supported intents.
  "CURRENT_SPENDING_SUMMARY",
]);

// -- shared helpers -----------------------------------------------

const isFiniteNumberCtx = (value) => typeof value === "number" && Number.isFinite(value);
const isPlainObjectCtx = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// Bounded copy of one public anomaly record -- only the exact fields expenseAnomalyAnalyzer.js's frozen output contract guarantees (already free of userId/raw expense objects/sort keys); a newly constructed object every time, so no reference to the stored Report is ever retained.
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

// Bounded copy of one forecast horizon's public fields -- estimate/range only, always paired with `isEstimate: true` so the LLM can never mistake a statistical projection for a recorded fact.
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

// Bounded per-category forecast breakdown -- only category NAME, predicted amount and share are copied (already-aggregated monthly projections, never a transaction/merchant/id/date). Capped at MAX_FORECAST_CATEGORIES so many categories can't grow the prompt unbounded; the analyzer's output is already sorted largest-first, so the cap keeps exactly the categories a "which category will be highest" question needs.
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

// Forecast-vs-budget risk for the target month, copied field-by-field from forecastBudgetRisk.js's bounded output -- carries no budget document, month history, or user identifier.
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

// Descriptive data-quality summary, so SIA can explain WHY a forecast is limited/unavailable instead of inventing a prediction. `warnings` are fixed, developer-authored reason codes from forecastRules.js -- never free text derived from user data.
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

// Bounded copy of one risk signal's public fields -- reasonCode/severity plus its own already-bounded evidence object (riskAnalyzer.js's contract never carries a raw record or user identifier inside evidence).
function copyRiskSignal(signal) {
  if (!isPlainObjectCtx(signal)) return null;
  return {
    reasonCode: typeof signal.reasonCode === "string" ? signal.reasonCode : null,
    severity: typeof signal.severity === "string" ? signal.severity : null,
    evidence: isPlainObjectCtx(signal.evidence) ? JSON.parse(JSON.stringify(signal.evidence)) : {},
  };
}

// Deliberately `!== undefined && !== null`, not a truthiness check -- a valid `0` or other falsy-but-real value must never be treated as "missing".
function isPresent(value) {
  return value !== undefined && value !== null;
}

function noDataResult(intent) {
  return { intent, fields: null, reason: "no_data" };
}

// The report's own generation timestamp -- reportGenerator.js sets `metadata.generatedAt` once, at generation time; the only authoritative "when was this generated" value in the Report shape. This module never generates a replacement timestamp of its own.
function getSourceReportGeneratedAt(report) {
  return report.metadata && report.metadata.generatedAt;
}

async function buildContext(userId, intent) {
  // No fuzzy matching -- an intent outside the supported values is handled with the same explicit, unguessed no-data result rather than coerced into a known intent.
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
    // Corrected mapping: summary.healthScore/summary.riskLevel are never populated (healthAnalyzer.js's return has no such keys, so reportGenerator.js's aliases are always undefined) -- the real source values are report.financialHealth.overall/.risk.label. The external output keys (healthScore/riskLevel) are kept unchanged, only their internal source expressions changed, as plain aliases with no calculation.
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
    // summary.comparePastMonth and summary.totalSpent are genuinely populated in real reports, so no correction applies here.
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

  // CURRENT_SPENDING_SUMMARY: context foundation only, sourced exclusively from
  // summary.totalSpent -- the same authoritative current-month total
  // SPENDING_CHANGE_EXPLANATION and FINANCIAL_RISK_EXPLANATION already carry. This
  // is the smallest bounded context of any supported intent: no trends, no
  // category breakdown, no forecast, no risk signals -- a bare total lookup
  // question can only ever be grounded on the one figure it asked for.
  if (intent === "CURRENT_SPENDING_SUMMARY") {
    const totalSpent = summary.totalSpent;

    if (!isPresent(totalSpent)) {
      return noDataResult(intent);
    }

    return {
      intent,
      fields: {
        summary: {
          totalSpent,
        },
      },
      sourceReportGeneratedAt,
    };
  }

  // BUDGET_STATUS_EXPLANATION: context foundation only, sourced exclusively from report.budgets (budgetAnalyzer.js's canonical output). summary.budgetUtilization/budgetStatus are NOT used -- confirmed duplicates of budgets.utilization/.status, so the canonical object is preferred. Deliberately excluded: budgetInsights (pre-written advisory text, not a budgetAnalyzer.js value -- passing it through risks SIA echoing financial advice); currentStreak/longestStreak/streakBrokenReason (multi-month discipline, out of scope for "current status"); daysUntilExhaustion (can legitimately be null even when hasBudget===true, unlike every other projection field, so excluded rather than guessed at).
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

    // hasBudget === false means no budget is configured (calculateBudgetUtilization legitimately returns utilization/remainingBudget/budgetLeft as null, not missing data). Treated as no-data for this intent -- a dedicated user-facing message for that state belongs to response formatting, not this context-only foundation.
    if (hasBudget !== true) {
      return noDataResult(intent);
    }

    // Gating on hasBudget === true guarantees (via budgetAnalyzer.js's calculate* functions) that utilization/remainingBudget/budgetLeft/projection fields are real values, never null -- verified explicitly here rather than assumed, matching this module's isPresent-everywhere convention.
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

  // CATEGORY_SPENDING_EXPLANATION: context foundation only, sourced exclusively from report.categories.monthly (categoryAnalyzer.js's canonical output). summary.topCategory is NOT used -- a lossy derived alias whose "N/A" fallback conflates "no data" with a real category literally named "N/A" -- the canonical monthly {category, total} object is preferred. report.categories.yearly is deliberately excluded: gating on both monthly and yearly independently having hasData would spuriously no-data a user with full current-month data but, e.g., a first year of app usage; left to a future milestone to scope. Excluded fields: biggestJump/biggestDrop (genuinely nullable even in the hasData:true branch, e.g. when every category is brand new, so not provable the way the fields below are); no pre-written insights/advisory text exists in categoryAnalyzer.js's output at all (unlike budgetAnalyzer.js).
  //
  // Every nested record below is validated against its exact analyzer contract (not just checked for top-level presence) and copied into a newly-constructed object -- an earlier draft returned records by direct reference into the stored Report, so a malformed nested record could reach the success context and a caller mutating the returned context could silently corrupt the cached Report.

  // True only for a genuine finite number (Number.isFinite never coerces, unlike global isFinite) -- accepts legitimate zero/negative/decimal values, matching categoryAnalyzer.js's real ranges (refunds can be negative).
  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  // True only for a real, non-array, non-null object -- excludes arrays and null (both `typeof === "object"`).
  function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  // Validates a categoryAnalyzer.js {category, total} record (topCategory/leastCategory) against its exact contract -- `category` accepted as-is, `total` must be a finite number.
  function isValidCategoryTotal(value) {
    return isPlainObject(value) && typeof value.category === "string" && isFiniteNumber(value.total);
  }

  // Builds a new {category, total} object with only the two approved fields -- breaks reference sharing with the stored Report and silently excludes any unexpected extra properties.
  function copyCategoryTotal(value) {
    return { category: value.category, total: value.total };
  }

  // Validates a single categoryDistribution record against calculateCategoryDistribution()'s exact {category, amount, percentage} contract.
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

  // Validates a single categoryGrowth record against calculateCategoryGrowth()'s exact contract. growthPercentage is the one field that can legitimately be null (whenever `previous <= 0`) -- accepted as null OR a finite number, nothing else.
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

    // Every nested record is validated against categoryAnalyzer.js's exact contract -- so a stale, differently-shaped, or corrupted stored Report returns no-data instead of leaking malformed data into the context.
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

    // Explicit field selection into newly-constructed objects/arrays -- shares no reference with `report`, cannot leak an unexpected extra property. Array order preserved exactly; no value coerced, rounded, or recalculated.
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

  // ANOMALY_EXPLANATION: sourced exclusively from report.anomalies (expenseAnomalyAnalyzer.js's frozen output, already free of raw records/userId/sort keys). A valid hasData:false zero-anomaly result is a legitimate, present answer -- NOT treated as "no context", distinguishing the report's own no-data state from SIA's "insufficient report data" case.
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
          // Already bounded to at most 10 by expenseAnomalyRules.js's maxAnomalies -- copied again here defensively, never trusting a stored document's array length without re-validating.
          records: anomalyList.slice(0, 10).map(copyAnomalyRecord).filter(Boolean),
        },
      },
      sourceReportGeneratedAt,
    };
  }

  // SPENDING_FORECAST_EXPLANATION: sourced exclusively from report.forecast (forecastAnalyzer.js's output). All three horizons are included (bounded, small, already public) since the classifier doesn't itself extract which horizon a question named -- every value marked `isEstimate: true` so it can never be presented as recorded fact.
  if (intent === "SPENDING_FORECAST_EXPLANATION") {
    const forecast = report.forecast;
    if (!isPresent(forecast) || typeof forecast.hasData !== "boolean") {
      return noDataResult(intent);
    }

    // Grounded on the TRUE next-calendar-month forecast -- the legacy `nextMonthForecast` field is deliberately NOT sent: despite its name it projects the CURRENT in-progress month, which would silently answer a different question. If the true field is absent (older cached report), the context reports it unavailable rather than substituting the legacy value.
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
          // The target period, data-quality summary (so a limited forecast can be explained with the real reason), per-category breakdown, and target-month budget-risk status -- every one a bounded, already-aggregated figure; no transaction, raw history series, or identifier reaches the provider.
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

  // FINANCIAL_RISK_EXPLANATION: sourced from report.risk (riskAnalyzer.js's bounded, allowlisted output) plus only the two summary fields its evidence already reflects (totalSpent, budgetStatus) -- never the complete report or raw budget/spending internals.
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

  // Unreachable: SUPPORTED_INTENTS only ever admits the eight intents handled above. Kept as an explicit, honest fallback -- if a ninth intent is ever added without a matching branch, this returns the same safe no-data shape instead of silently returning undefined.
  return noDataResult(intent);
}

module.exports = {
  buildContext,
};
