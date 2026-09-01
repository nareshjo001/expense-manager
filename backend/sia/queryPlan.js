// SIA QueryPlan contract -- a versioned, CLOSED schema describing exactly
"use strict";

// Version 1 remains the active wire format until semanticRouter.js and
const QUERY_PLAN_VERSION = 1;
const QUERY_PLAN_V2_VERSION = 2;
const SUPPORTED_QUERY_PLAN_VERSIONS = Object.freeze([QUERY_PLAN_VERSION, QUERY_PLAN_V2_VERSION]);

const OUTCOMES = Object.freeze(["supported", "unsupported", "clarification"]);

// Direct, deterministically-answerable financial metrics, plus the four
const METRICS = Object.freeze([
  "EXPENSE_TOTAL",
  "EXPENSE_COUNT",
  "DAILY_SPENDING_AVERAGE",
  "CATEGORY_TOTAL",
  "CATEGORY_BREAKDOWN",
  "TOP_CATEGORY",
  "BUDGET_AMOUNT",
  "BUDGET_SPENT",
  "BUDGET_REMAINING",
  "BUDGET_UTILIZATION",
  "BUDGET_STATUS",
  "INCOME_TOTAL",
  "INCOME_COUNT",
  "NET_CASH_FLOW",
  "PERIOD_COMPARISON",
  "INCOME_BREAKDOWN",
  "TREND_SERIES",
  // Existing deterministic explanation intents -- reused, never reinvented.
  "HEALTH_EXPLANATION",
  "ANOMALY_EXPLANATION",
  "SPENDING_FORECAST_EXPLANATION",
  "FINANCIAL_RISK_EXPLANATION",
]);

const OPERATIONS = Object.freeze(["LOOKUP", "COMPARE", "BREAKDOWN", "EXPLAIN", "FORECAST"]);

const PERIOD_TYPES = Object.freeze([
  "TODAY",
  "YESTERDAY",
  "CURRENT_WEEK",
  "PREVIOUS_WEEK",
  "CURRENT_MONTH",
  "PREVIOUS_MONTH",
  "CURRENT_YEAR",
  "PREVIOUS_YEAR",
  "EXPLICIT_MONTH",
  "LAST_N_MONTHS",
  "CUSTOM_RANGE",
]);

const GROUPINGS = Object.freeze(["NONE", "CATEGORY", "MONTH"]);

// A metric x operation CAPABILITY contract -- not every operation is
const FORECAST_CAPABLE_METRICS = Object.freeze(["SPENDING_FORECAST_EXPLANATION"]);

const RESPONSE_MODES = Object.freeze(["DETERMINISTIC", "PROSE"]);

const MAX_METRICS_PER_PLAN = 3;
const MAX_QUERIES_PER_PLAN = 5;
const MAX_LAST_N_MONTHS = 12;
const MAX_CATEGORY_FILTER_LENGTH = 60;
const MAX_CLARIFICATION_OPTIONS = 5;
const MAX_CLARIFICATION_PROMPT_LENGTH = 300;
const MAX_CLARIFICATION_REASON_LENGTH = 60;
const MAX_CLARIFICATION_OPTION_LABEL_LENGTH = 80;
const MAX_CLARIFICATION_OPTION_ID_LENGTH = 40;
const MAX_SAFE_INTERPRETATION_NOTE_LENGTH = 160;
// A custom range is capped at the same 12-month/366-day ceiling as
// LAST_N_MONTHS -- "max 12-month history" applies uniformly.
const MAX_CUSTOM_RANGE_DAYS = 366;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

// Rejects anything shaped like a Mongo field path, operator, or injection
const SAFE_CATEGORY_PATTERN = /^[\p{L}\p{N} '&/(),-]+$/u;

function isValidCategoryFilter(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CATEGORY_FILTER_LENGTH) return false;
  if (trimmed.includes("$") || trimmed.includes("{") || trimmed.includes("}")) return false;
  if (trimmed.includes("..") || /^\.|\.$/.test(trimmed)) return false;
  return SAFE_CATEGORY_PATTERN.test(trimmed);
}

function fail(reason) {
  return { valid: false, reason };
}

function validatePeriodObject(period, { fieldName }) {
  if (!isPlainObject(period)) return fail(`${fieldName}_NOT_OBJECT`);

  const allowedKeys = new Set(["type", "month", "year", "monthsCount", "startDate", "endDate"]);
  for (const key of Object.keys(period)) {
    if (!allowedKeys.has(key)) return fail(`${fieldName}_UNKNOWN_KEY:${key}`);
  }

  if (!PERIOD_TYPES.includes(period.type)) return fail(`${fieldName}_INVALID_TYPE`);

  if (period.type === "EXPLICIT_MONTH") {
    if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12) {
      return fail(`${fieldName}_INVALID_MONTH`);
    }
    if (!Number.isInteger(period.year) || period.year < 2000 || period.year > 2100) {
      return fail(`${fieldName}_INVALID_YEAR`);
    }
    if ("monthsCount" in period || "startDate" in period || "endDate" in period) {
      return fail(`${fieldName}_UNEXPECTED_FIELDS_FOR_EXPLICIT_MONTH`);
    }
  } else if (period.type === "LAST_N_MONTHS") {
    if (
      !Number.isInteger(period.monthsCount) ||
      period.monthsCount < 1 ||
      period.monthsCount > MAX_LAST_N_MONTHS
    ) {
      return fail(`${fieldName}_INVALID_MONTHS_COUNT`);
    }
    if ("month" in period || "year" in period || "startDate" in period || "endDate" in period) {
      return fail(`${fieldName}_UNEXPECTED_FIELDS_FOR_LAST_N_MONTHS`);
    }
  } else if (period.type === "CUSTOM_RANGE") {
    if (!DATE_ONLY_PATTERN.test(period.startDate || "") || !DATE_ONLY_PATTERN.test(period.endDate || "")) {
      return fail(`${fieldName}_INVALID_CUSTOM_RANGE_DATES`);
    }
    const start = new Date(`${period.startDate}T00:00:00.000Z`);
    const end = new Date(`${period.endDate}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return fail(`${fieldName}_INVALID_CUSTOM_RANGE_DATES`);
    }
    if (end <= start) return fail(`${fieldName}_CUSTOM_RANGE_NOT_POSITIVE`);
    const spanDays = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    if (spanDays > MAX_CUSTOM_RANGE_DAYS) return fail(`${fieldName}_CUSTOM_RANGE_TOO_LONG`);
    if ("month" in period || "year" in period || "monthsCount" in period) {
      return fail(`${fieldName}_UNEXPECTED_FIELDS_FOR_CUSTOM_RANGE`);
    }
  } else {
    // Every other period type is a fixed, unparameterized enum value --
    // no extra keys are ever legitimate.
    if ("month" in period || "year" in period || "monthsCount" in period || "startDate" in period || "endDate" in period) {
      return fail(`${fieldName}_UNEXPECTED_FIELDS`);
    }
  }

  return { valid: true };
}

function validateClarification(clarification) {
  if (!isPlainObject(clarification)) return fail("CLARIFICATION_NOT_OBJECT");

  const allowedKeys = new Set(["reason", "prompt", "options"]);
  for (const key of Object.keys(clarification)) {
    if (!allowedKeys.has(key)) return fail(`CLARIFICATION_UNKNOWN_KEY:${key}`);
  }

  if (!isNonEmptyString(clarification.reason, MAX_CLARIFICATION_REASON_LENGTH)) {
    return fail("CLARIFICATION_INVALID_REASON");
  }
  if (!isNonEmptyString(clarification.prompt, MAX_CLARIFICATION_PROMPT_LENGTH)) {
    return fail("CLARIFICATION_INVALID_PROMPT");
  }
  if (!Array.isArray(clarification.options) || clarification.options.length === 0) {
    return fail("CLARIFICATION_INVALID_OPTIONS");
  }
  if (clarification.options.length > MAX_CLARIFICATION_OPTIONS) {
    return fail("CLARIFICATION_TOO_MANY_OPTIONS");
  }
  const seenIds = new Set();
  for (const option of clarification.options) {
    if (!isPlainObject(option)) return fail("CLARIFICATION_OPTION_NOT_OBJECT");
    const optionKeys = new Set(Object.keys(option));
    if (optionKeys.size !== 2 || !optionKeys.has("id") || !optionKeys.has("label")) {
      return fail("CLARIFICATION_OPTION_UNKNOWN_KEY");
    }
    if (!isNonEmptyString(option.id, MAX_CLARIFICATION_OPTION_ID_LENGTH)) {
      return fail("CLARIFICATION_OPTION_INVALID_ID");
    }
    if (!isNonEmptyString(option.label, MAX_CLARIFICATION_OPTION_LABEL_LENGTH)) {
      return fail("CLARIFICATION_OPTION_INVALID_LABEL");
    }
    if (seenIds.has(option.id)) return fail("CLARIFICATION_DUPLICATE_OPTION_ID");
    seenIds.add(option.id);
  }

  return { valid: true };
}

function validateSafeInterpretation(safeInterpretation) {
  if (!isPlainObject(safeInterpretation)) return fail("SAFE_INTERPRETATION_NOT_OBJECT");
  const allowedKeys = new Set(["assumedYear", "note"]);
  for (const key of Object.keys(safeInterpretation)) {
    if (!allowedKeys.has(key)) return fail(`SAFE_INTERPRETATION_UNKNOWN_KEY:${key}`);
  }
  if ("assumedYear" in safeInterpretation) {
    const y = safeInterpretation.assumedYear;
    if (!Number.isInteger(y) || y < 2000 || y > 2100) return fail("SAFE_INTERPRETATION_INVALID_YEAR");
  }
  if ("note" in safeInterpretation) {
    if (!isNonEmptyString(safeInterpretation.note, MAX_SAFE_INTERPRETATION_NOTE_LENGTH)) {
      return fail("SAFE_INTERPRETATION_INVALID_NOTE");
    }
  }
  return { valid: true };
}

const TOP_LEVEL_ALLOWED_KEYS = new Set([
  "version",
  "outcome",
  "metrics",
  "operation",
  "period",
  "grouping",
  "categoryFilter",
  "comparisonPeriod",
  "responseMode",
  "clarification",
  "safeInterpretation",
]);

/* Pure, synchronous, side-effect-free QueryPlan validator. Fails CLOSED -- */
function validateV1QueryPlan(candidate) {
  try {
    if (!isPlainObject(candidate)) return fail("PLAN_NOT_OBJECT");

    for (const key of Object.keys(candidate)) {
      if (!TOP_LEVEL_ALLOWED_KEYS.has(key)) return fail(`UNKNOWN_KEY:${key}`);
    }

    if (candidate.version !== QUERY_PLAN_VERSION) return fail("INVALID_VERSION");
    if (!OUTCOMES.includes(candidate.outcome)) return fail("INVALID_OUTCOME");

    if (candidate.outcome === "clarification") {
      // A clarification plan carries no metric/operation/period execution
      const disallowed = ["metrics", "operation", "period", "grouping", "categoryFilter", "comparisonPeriod", "responseMode"];
      for (const key of disallowed) {
        if (key in candidate) return fail(`UNEXPECTED_FIELD_FOR_CLARIFICATION:${key}`);
      }
      if (!("clarification" in candidate)) return fail("MISSING_CLARIFICATION");
      const clarificationResult = validateClarification(candidate.clarification);
      if (!clarificationResult.valid) return clarificationResult;

      if ("safeInterpretation" in candidate) {
        const safeInterpretationResult = validateSafeInterpretation(candidate.safeInterpretation);
        if (!safeInterpretationResult.valid) return safeInterpretationResult;
      }

      return {
        valid: true,
        plan: {
          version: QUERY_PLAN_VERSION,
          outcome: "clarification",
          clarification: candidate.clarification,
          ...(candidate.safeInterpretation ? { safeInterpretation: candidate.safeInterpretation } : {}),
        },
      };
    }

    if (candidate.outcome === "unsupported") {
      // An unsupported plan carries no execution details either -- it is
      // the safe, inert terminal state.
      const disallowed = [
        "metrics",
        "operation",
        "period",
        "grouping",
        "categoryFilter",
        "comparisonPeriod",
        "responseMode",
        "clarification",
        "safeInterpretation",
      ];
      for (const key of disallowed) {
        if (key in candidate) return fail(`UNEXPECTED_FIELD_FOR_UNSUPPORTED:${key}`);
      }
      return { valid: true, plan: { version: QUERY_PLAN_VERSION, outcome: "unsupported" } };
    }

    // outcome === "supported"
    if (!Array.isArray(candidate.metrics) || candidate.metrics.length === 0) {
      return fail("INVALID_METRICS");
    }
    if (candidate.metrics.length > MAX_METRICS_PER_PLAN) return fail("TOO_MANY_METRICS");
    for (const metric of candidate.metrics) {
      if (!METRICS.includes(metric)) return fail(`INVALID_METRIC:${metric}`);
    }
    if (new Set(candidate.metrics).size !== candidate.metrics.length) return fail("DUPLICATE_METRICS");

    if (!OPERATIONS.includes(candidate.operation)) return fail("INVALID_OPERATION");

    if (candidate.operation === "FORECAST") {
      const onlyForecastCapable = candidate.metrics.every((m) => FORECAST_CAPABLE_METRICS.includes(m));
      if (!onlyForecastCapable) return fail("UNSUPPORTED_FORECAST_METRIC_COMBINATION");
    }

    if (!("period" in candidate)) return fail("MISSING_PERIOD");
    const periodResult = validatePeriodObject(candidate.period, { fieldName: "PERIOD" });
    if (!periodResult.valid) return periodResult;

    if (!GROUPINGS.includes(candidate.grouping)) return fail("INVALID_GROUPING");

    if (!RESPONSE_MODES.includes(candidate.responseMode)) return fail("INVALID_RESPONSE_MODE");

    if ("categoryFilter" in candidate && candidate.categoryFilter !== null) {
      if (!isValidCategoryFilter(candidate.categoryFilter)) return fail("INVALID_CATEGORY_FILTER");
    }

    if (candidate.operation === "COMPARE" || candidate.metrics.includes("PERIOD_COMPARISON")) {
      if (!("comparisonPeriod" in candidate)) return fail("MISSING_COMPARISON_PERIOD");
      const comparisonResult = validatePeriodObject(candidate.comparisonPeriod, { fieldName: "COMPARISON_PERIOD" });
      if (!comparisonResult.valid) return comparisonResult;
    } else if ("comparisonPeriod" in candidate) {
      return fail("UNEXPECTED_COMPARISON_PERIOD");
    }

    if ("clarification" in candidate) return fail("UNEXPECTED_FIELD_FOR_SUPPORTED:clarification");

    if ("safeInterpretation" in candidate) {
      const safeInterpretationResult = validateSafeInterpretation(candidate.safeInterpretation);
      if (!safeInterpretationResult.valid) return safeInterpretationResult;
    }

    const plan = {
      version: QUERY_PLAN_VERSION,
      outcome: "supported",
      metrics: [...candidate.metrics],
      operation: candidate.operation,
      period: { ...candidate.period },
      grouping: candidate.grouping,
      responseMode: candidate.responseMode,
    };
    if ("categoryFilter" in candidate && candidate.categoryFilter !== null) {
      plan.categoryFilter = candidate.categoryFilter.trim();
    }
    if ("comparisonPeriod" in candidate) {
      plan.comparisonPeriod = { ...candidate.comparisonPeriod };
    }
    if (candidate.safeInterpretation) {
      plan.safeInterpretation = { ...candidate.safeInterpretation };
    }

    return { valid: true, plan };
  } catch (_err) {
    // Any unexpected internal exception (e.g. a getter that throws, a
    // circular structure) fails closed rather than propagating.
    return fail("INTERNAL_VALIDATION_ERROR");
  }
}

const V2_TOP_LEVEL_ALLOWED_KEYS = new Set(["version", "outcome", "queries", "clarification", "safeInterpretation"]);
const V2_QUERY_ALLOWED_KEYS = new Set([
  "metric",
  "operation",
  "period",
  "grouping",
  "categoryFilter",
  "comparisonPeriod",
  "responseMode",
]);

function validateV2Query(candidate, index) {
  const prefix = `QUERY_${index}`;
  if (!isPlainObject(candidate)) return fail(`${prefix}_NOT_OBJECT`);

  for (const key of Object.keys(candidate)) {
    if (!V2_QUERY_ALLOWED_KEYS.has(key)) return fail(`${prefix}_UNKNOWN_KEY:${key}`);
  }

  if (!METRICS.includes(candidate.metric)) return fail(`${prefix}_INVALID_METRIC`);
  if (!OPERATIONS.includes(candidate.operation)) return fail(`${prefix}_INVALID_OPERATION`);
  if (!GROUPINGS.includes(candidate.grouping)) return fail(`${prefix}_INVALID_GROUPING`);
  if (!RESPONSE_MODES.includes(candidate.responseMode)) return fail(`${prefix}_INVALID_RESPONSE_MODE`);

  if (!("period" in candidate)) return fail(`${prefix}_MISSING_PERIOD`);
  const periodResult = validatePeriodObject(candidate.period, { fieldName: `${prefix}_PERIOD` });
  if (!periodResult.valid) return periodResult;

  if (candidate.operation === "FORECAST" && !FORECAST_CAPABLE_METRICS.includes(candidate.metric)) {
    return fail(`${prefix}_UNSUPPORTED_FORECAST_METRIC_COMBINATION`);
  }

  if ("categoryFilter" in candidate && candidate.categoryFilter !== null) {
    if (!isValidCategoryFilter(candidate.categoryFilter)) return fail(`${prefix}_INVALID_CATEGORY_FILTER`);
  }

  const needsComparisonPeriod = candidate.operation === "COMPARE" || candidate.metric === "PERIOD_COMPARISON";
  if (needsComparisonPeriod) {
    if (!("comparisonPeriod" in candidate)) return fail(`${prefix}_MISSING_COMPARISON_PERIOD`);
    const comparisonResult = validatePeriodObject(candidate.comparisonPeriod, {
      fieldName: `${prefix}_COMPARISON_PERIOD`,
    });
    if (!comparisonResult.valid) return comparisonResult;
  } else if ("comparisonPeriod" in candidate) {
    return fail(`${prefix}_UNEXPECTED_COMPARISON_PERIOD`);
  }

  const query = {
    metric: candidate.metric,
    operation: candidate.operation,
    period: { ...candidate.period },
    grouping: candidate.grouping,
    responseMode: candidate.responseMode,
  };
  if ("categoryFilter" in candidate && candidate.categoryFilter !== null) {
    query.categoryFilter = candidate.categoryFilter.trim();
  }
  if ("comparisonPeriod" in candidate) {
    query.comparisonPeriod = { ...candidate.comparisonPeriod };
  }

  return { valid: true, query };
}

function validateV2QueryPlan(candidate) {
  try {
    if (!isPlainObject(candidate)) return fail("PLAN_NOT_OBJECT");

    for (const key of Object.keys(candidate)) {
      if (!V2_TOP_LEVEL_ALLOWED_KEYS.has(key)) return fail(`UNKNOWN_KEY:${key}`);
    }

    if (candidate.version !== QUERY_PLAN_V2_VERSION) return fail("INVALID_VERSION");
    if (!OUTCOMES.includes(candidate.outcome)) return fail("INVALID_OUTCOME");

    if (candidate.outcome === "clarification") {
      for (const key of ["queries"]) {
        if (key in candidate) return fail(`UNEXPECTED_FIELD_FOR_CLARIFICATION:${key}`);
      }
      if (!("clarification" in candidate)) return fail("MISSING_CLARIFICATION");
      const clarificationResult = validateClarification(candidate.clarification);
      if (!clarificationResult.valid) return clarificationResult;
      if ("safeInterpretation" in candidate) {
        const safeInterpretationResult = validateSafeInterpretation(candidate.safeInterpretation);
        if (!safeInterpretationResult.valid) return safeInterpretationResult;
      }
      return {
        valid: true,
        plan: {
          version: QUERY_PLAN_V2_VERSION,
          outcome: "clarification",
          clarification: candidate.clarification,
          ...(candidate.safeInterpretation ? { safeInterpretation: candidate.safeInterpretation } : {}),
        },
      };
    }

    if (candidate.outcome === "unsupported") {
      for (const key of ["queries", "clarification", "safeInterpretation"]) {
        if (key in candidate) return fail(`UNEXPECTED_FIELD_FOR_UNSUPPORTED:${key}`);
      }
      return { valid: true, plan: { version: QUERY_PLAN_V2_VERSION, outcome: "unsupported" } };
    }

    if (!Array.isArray(candidate.queries) || candidate.queries.length === 0) {
      return fail("INVALID_QUERIES");
    }
    if (candidate.queries.length > MAX_QUERIES_PER_PLAN) return fail("TOO_MANY_QUERIES");
    if ("clarification" in candidate) return fail("UNEXPECTED_FIELD_FOR_SUPPORTED:clarification");

    const queries = [];
    const seenQueries = new Set();
    for (let index = 0; index < candidate.queries.length; index += 1) {
      const queryResult = validateV2Query(candidate.queries[index], index);
      if (!queryResult.valid) return queryResult;
      const fingerprint = JSON.stringify(queryResult.query);
      if (seenQueries.has(fingerprint)) return fail("DUPLICATE_QUERIES");
      seenQueries.add(fingerprint);
      queries.push(queryResult.query);
    }

    if ("safeInterpretation" in candidate) {
      const safeInterpretationResult = validateSafeInterpretation(candidate.safeInterpretation);
      if (!safeInterpretationResult.valid) return safeInterpretationResult;
    }

    return {
      valid: true,
      plan: {
        version: QUERY_PLAN_V2_VERSION,
        outcome: "supported",
        queries,
        ...(candidate.safeInterpretation ? { safeInterpretation: { ...candidate.safeInterpretation } } : {}),
      },
    };
  } catch (_err) {
    return fail("INTERNAL_VALIDATION_ERROR");
  }
}

/* Accepts persisted v1 plans and new v2 plans. The returned plan preserves */
function validateQueryPlan(candidate) {
  try {
    if (!isPlainObject(candidate)) return fail("PLAN_NOT_OBJECT");
    if (candidate.version === QUERY_PLAN_VERSION) return validateV1QueryPlan(candidate);
    if (candidate.version === QUERY_PLAN_V2_VERSION) return validateV2QueryPlan(candidate);
    return fail("INVALID_VERSION");
  } catch (_err) {
    return fail("INTERNAL_VALIDATION_ERROR");
  }
}

/* Converts either accepted plan version to the v2 execution shape without */
function normalizeQueryPlan(candidate) {
  const validation = validateQueryPlan(candidate);
  if (!validation.valid) return validation;

  const plan = validation.plan;
  if (plan.version === QUERY_PLAN_V2_VERSION) return validation;

  if (plan.outcome === "unsupported") {
    return { valid: true, plan: { version: QUERY_PLAN_V2_VERSION, outcome: "unsupported" } };
  }
  if (plan.outcome === "clarification") {
    return {
      valid: true,
      plan: {
        version: QUERY_PLAN_V2_VERSION,
        outcome: "clarification",
        clarification: plan.clarification,
        ...(plan.safeInterpretation ? { safeInterpretation: plan.safeInterpretation } : {}),
      },
    };
  }

  return {
    valid: true,
    plan: {
      version: QUERY_PLAN_V2_VERSION,
      outcome: "supported",
      queries: plan.metrics.map((metric) => {
        const query = {
          metric,
          operation: plan.operation,
          period: { ...plan.period },
          grouping: plan.grouping,
          responseMode: plan.responseMode,
        };
        if (plan.categoryFilter) query.categoryFilter = plan.categoryFilter;
        if (plan.comparisonPeriod) query.comparisonPeriod = { ...plan.comparisonPeriod };
        return query;
      }),
      ...(plan.safeInterpretation ? { safeInterpretation: { ...plan.safeInterpretation } } : {}),
    },
  };
}

module.exports = {
  QUERY_PLAN_VERSION,
  QUERY_PLAN_V2_VERSION,
  SUPPORTED_QUERY_PLAN_VERSIONS,
  OUTCOMES,
  METRICS,
  OPERATIONS,
  PERIOD_TYPES,
  GROUPINGS,
  RESPONSE_MODES,
  MAX_METRICS_PER_PLAN,
  MAX_QUERIES_PER_PLAN,
  MAX_LAST_N_MONTHS,
  MAX_CATEGORY_FILTER_LENGTH,
  MAX_CLARIFICATION_OPTIONS,
  MAX_CUSTOM_RANGE_DAYS,
  FORECAST_CAPABLE_METRICS,
  validateQueryPlan,
  normalizeQueryPlan,
  isValidCategoryFilter,
};
