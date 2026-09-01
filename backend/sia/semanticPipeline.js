// SIA semantic pipeline -- orchestrates the NEW layer ask.js falls back to
"use strict";

const { routeQuestion } = require("./semanticRouter");
const { validateQueryPlan } = require("./queryPlan");
const { resolvePeriod, getZonedYMD } = require("./periodResolver");
const defaultFinancialQueryService = require("./financialQueryService");
const { createFactSetBuilder } = require("./factSet");
const { validateCitedAnswer } = require("./responseValidator");
const { askLlm: defaultAskLlm } = require("./llmService");
const { isClearlyProhibited } = require("./prohibitedPhrases");
const config = require("./config");

const DETERMINISTIC_METRICS = new Set([
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
]);

const EXPLANATION_INTENT_METRICS = new Set([
  "HEALTH_EXPLANATION",
  "ANOMALY_EXPLANATION",
  "SPENDING_FORECAST_EXPLANATION",
  "FINANCIAL_RISK_EXPLANATION",
]);

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

function formatInr(value) {
  return CURRENCY_FORMATTER.format(value);
}

const SEMANTIC_EXPLANATION_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. You are given a small " +
  "bounded set of FACTS (each with a factId, metric, period, value, unit) and the user's " +
  "question. Respond with ONLY a JSON object of the exact shape " +
  '{"answer": <string>, "citedFactIds": [<factId>, ...]}. Use ONLY the numbers in the ' +
  "supplied facts -- never invent a value. Cite every fact you rely on by its factId. Frame " +
  "any estimate/forecast fact as an estimate, never as a certainty. Never describe unusual " +
  "spending as fraud. Never give financial, investment, tax, or legal advice. Never include a " +
  "raw identifier, JSON key, or any fact not in the supplied set. Respond with JSON only, no " +
  "prose, no markdown.";

const SEMANTIC_ANSWER_STRUCTURED_OUTPUT = Object.freeze({
  name: "sia_grounded_answer",
  schema: Object.freeze({
    type: "object",
    properties: {
      answer: { type: "string" },
      citedFactIds: { type: "array", items: { type: "string" } },
    },
    required: ["answer", "citedFactIds"],
    additionalProperties: false,
  }),
});

function safeParseJson(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch (_err) {
    return null;
  }
}

function deriveYearMonthForBudget(plan, period, timeZone) {
  if (plan.period.type === "EXPLICIT_MONTH") {
    return { year: plan.period.year, month: plan.period.month };
  }
  if (plan.period.type === "CURRENT_MONTH" || plan.period.type === "PREVIOUS_MONTH") {
    return getZonedYMD(period.start, timeZone || config.appTimeZone);
  }
  return null;
}

async function executeMetricToFactSet({ userId, plan, period, financialQueryService, now, timeZone }) {
  const builder = createFactSetBuilder();
  const metric = plan.metrics[0];
  const periodLabel = period.label;
  const common = { periodStart: period.start, periodEnd: period.end, periodLabel };

  switch (metric) {
    case "EXPENSE_TOTAL": {
      const r = await financialQueryService.getExpenseTotal(userId, period);
      if (!r.hasData) return { ok: false, reasonCode: r.reasonCode || "NO_DATA" };
      builder.add({ ...common, metric, value: r.value, unit: "INR", source: "EXPENSE" });
      break;
    }
    case "EXPENSE_COUNT": {
      const r = await financialQueryService.getExpenseCount(userId, period);
      if (!r.hasData) return { ok: false, reasonCode: r.reasonCode || "NO_DATA" };
      builder.add({ ...common, metric, value: r.value, unit: "COUNT", source: "EXPENSE" });
      break;
    }
    case "DAILY_SPENDING_AVERAGE": {
      const r = await financialQueryService.getDailySpendingAverage(userId, period);
      if (!r.hasData) return { ok: false, reasonCode: r.reasonCode || "NO_DATA" };
      builder.add({ ...common, metric, value: r.value, unit: "INR", source: "DERIVED" });
      break;
    }
    case "CATEGORY_TOTAL": {
      if (!plan.categoryFilter) return { ok: false, reasonCode: "MISSING_CATEGORY_FILTER" };
      const r = await financialQueryService.getCategoryTotal(userId, period, plan.categoryFilter);
      if (!r.hasData) return { ok: false, reasonCode: r.reasonCode || "NO_DATA" };
      builder.add({ ...common, metric, value: r.value, unit: "INR", source: "EXPENSE", groupKey: plan.categoryFilter });
      break;
    }
    case "CATEGORY_BREAKDOWN": {
      const r = await financialQueryService.getCategoryBreakdown(userId, period);
      if (!r.hasData) return { ok: false, reasonCode: r.reasonCode || "NO_DATA" };
      if (r.categories.length === 0) {
        return { ok: false, reasonCode: "NO_EXPENSES_IN_PERIOD" };
      }
      for (const c of r.categories) {
        builder.add({ ...common, metric, value: c.total, unit: "INR", source: "EXPENSE", groupKey: c.category });
      }
      break;
    }
    case "TOP_CATEGORY": {
      const r = await financialQueryService.getTopCategory(userId, period);
      if (!r.hasData) return { ok: false, reasonCode: r.reasonCode || "NO_DATA" };
      if (!r.category) {
        return { ok: false, reasonCode: "NO_EXPENSES_IN_PERIOD" };
      }
      builder.add({ ...common, metric, value: r.category.total, unit: "INR", source: "EXPENSE", groupKey: r.category.category });
      break;
    }
    case "INCOME_TOTAL": {
      const r = await financialQueryService.getIncomeTotal(userId, period);
      if (!r.hasData) return { ok: false, reasonCode: r.reasonCode || "NO_DATA" };
      builder.add({ ...common, metric, value: r.value, unit: "INR", source: "INCOME" });
      break;
    }
    case "INCOME_COUNT": {
      const r = await financialQueryService.getIncomeCount(userId, period);
      if (!r.hasData) return { ok: false, reasonCode: r.reasonCode || "NO_DATA" };
      builder.add({ ...common, metric, value: r.value, unit: "COUNT", source: "INCOME" });
      break;
    }
    case "NET_CASH_FLOW": {
      const r = await financialQueryService.getNetCashFlow(userId, period);
      if (!r.hasData) return { ok: false, reasonCode: r.reasonCode || "NO_DATA" };
      builder.add({ ...common, metric, value: r.value, unit: "INR", source: "DERIVED" });
      break;
    }
    case "BUDGET_AMOUNT":
    case "BUDGET_SPENT":
    case "BUDGET_REMAINING":
    case "BUDGET_UTILIZATION":
    case "BUDGET_STATUS": {
      const ym = deriveYearMonthForBudget(plan, period, timeZone);
      if (!ym) return { ok: false, reasonCode: "PERIOD_NOT_SINGLE_MONTH" };
      const r = await financialQueryService.getBudgetSnapshot(userId, ym);
      if (!r.hasData) return { ok: false, reasonCode: r.reasonCode || "NO_DATA" };
      if (metric === "BUDGET_STATUS") {
        builder.add({ ...common, metric, value: r.spent, unit: "INR", source: "BUDGET", reasonCode: r.status });
      } else {
        const valueByMetric = {
          BUDGET_AMOUNT: r.budget,
          BUDGET_SPENT: r.spent,
          BUDGET_REMAINING: r.remaining,
          BUDGET_UTILIZATION: r.utilization,
        };
        const unit = metric === "BUDGET_UTILIZATION" ? "PERCENT" : "INR";
        builder.add({ ...common, metric, value: valueByMetric[metric], unit, source: "BUDGET" });
      }
      break;
    }
    default:
      return { ok: false, reasonCode: "UNSUPPORTED_METRIC" };
  }

  const factSet = builder.build();
  if (factSet.facts.length === 0) return { ok: false, reasonCode: "NO_DATA" };
  return { ok: true, factSet };
}

function renderDeterministicAnswer(plan, factSet, period) {
  const metric = plan.metrics[0];
  const fact = factSet.facts[0];

  switch (metric) {
    case "EXPENSE_TOTAL":
      return `You spent ${formatInr(fact.value)} ${period.label}.`;
    case "EXPENSE_COUNT":
      return `You logged ${fact.value} expense${fact.value === 1 ? "" : "s"} ${period.label}.`;
    case "DAILY_SPENDING_AVERAGE":
      return `Your average daily spending ${period.label} was ${formatInr(fact.value)}.`;
    case "CATEGORY_TOTAL":
      return `You spent ${formatInr(fact.value)} on ${fact.groupKey} ${period.label}.`;
    case "CATEGORY_BREAKDOWN": {
      const lines = factSet.facts.map((f) => `${f.groupKey}: ${formatInr(f.value)}`);
      return `Here is your category spending breakdown ${period.label}: ${lines.join(", ")}.`;
    }
    case "TOP_CATEGORY":
      return `Your top spending category ${period.label} was ${fact.groupKey} at ${formatInr(fact.value)}.`;
    case "INCOME_TOTAL":
      return `Your total income ${period.label} was ${formatInr(fact.value)}.`;
    case "INCOME_COUNT":
      return `You logged ${fact.value} income entr${fact.value === 1 ? "y" : "ies"} ${period.label}.`;
    case "NET_CASH_FLOW":
      return `Your net cash flow ${period.label} was ${formatInr(fact.value)} (income minus expenses).`;
    case "BUDGET_AMOUNT":
      return `Your configured budget ${period.label} is ${formatInr(fact.value)}.`;
    case "BUDGET_SPENT":
      return `You have spent ${formatInr(fact.value)} against your budget ${period.label}.`;
    case "BUDGET_REMAINING":
      return `You have ${formatInr(fact.value)} remaining in your budget ${period.label}.`;
    case "BUDGET_UTILIZATION":
      return `You have used ${fact.value}% of your budget ${period.label}.`;
    case "BUDGET_STATUS":
      return `Your budget status ${period.label} is ${fact.reasonCode === "over_budget" ? "over budget" : "within budget"}.`;
    default:
      return "";
  }
}

function buildDeterministicGrounding() {
  return { sources: [{ key: "financialQueryService", label: "Direct financial query" }] };
}

function buildPlanSummary(plan, period) {
  return {
    metrics: [...plan.metrics],
    operation: plan.operation,
    periodLabel: period.label,
    grouping: plan.grouping,
    categoryFilter: plan.categoryFilter || null,
  };
}

// The persisted session summary stays in the existing bounded schema. It
function buildV2PlanSummary(plan, factSet) {
  const queries = Array.isArray(plan.queries) ? plan.queries : [];
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const metrics = unique(queries.map((query) => query.metric)).slice(0, 5);
  const groupings = unique(queries.map((query) => query.grouping));
  const categoryFilters = unique(queries.map((query) => query.categoryFilter));
  const periodLabels = unique((factSet && factSet.facts ? factSet.facts : []).map((fact) => fact.periodLabel));

  return {
    metrics,
    operation: "MULTI_QUERY",
    periodLabel: periodLabels.length === 1 ? periodLabels[0] : "multiple periods",
    grouping: groupings.length === 1 ? groupings[0] : "MIXED",
    categoryFilter: categoryFilters.length === 1 ? categoryFilters[0] : null,
  };
}

function normalizeSemanticAnswer(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return safeParseJson(value);
}

function deriveYearMonthForBudgetQuery(query, period, timeZone) {
  return deriveYearMonthForBudget({ period: query.period }, period, timeZone);
}

function isV2DeterministicQuery(query) {
  return (
    DETERMINISTIC_METRICS.has(query.metric) &&
    ["LOOKUP", "BREAKDOWN", "EXPLAIN", "COMPARE"].includes(query.operation)
  );
}

function addV2ResultFacts({ builder, query, period, result }) {
  const common = { periodStart: period.start, periodEnd: period.end, periodLabel: period.label };
  const metric = query.metric;

  if (metric === "CATEGORY_BREAKDOWN") {
    if (!Array.isArray(result.categories) || result.categories.length === 0) {
      return { ok: false, reasonCode: "NO_EXPENSES_IN_PERIOD" };
    }
    for (const category of result.categories) {
      const added = builder.add({
        ...common,
        metric,
        value: category.total,
        unit: "INR",
        source: "EXPENSE",
        groupKey: category.category,
      });
      if (!added.ok) return { ok: false, reasonCode: added.reason || "FACT_SET_BUILD_FAILED" };
    }
    return { ok: true };
  }

  if (metric === "TOP_CATEGORY") {
    if (!result.category) return { ok: false, reasonCode: "NO_EXPENSES_IN_PERIOD" };
    const added = builder.add({
      ...common,
      metric,
      value: result.category.total,
      unit: "INR",
      source: "EXPENSE",
      groupKey: result.category.category,
    });
    return added.ok ? { ok: true } : { ok: false, reasonCode: added.reason || "FACT_SET_BUILD_FAILED" };
  }

  if (metric === "INCOME_BREAKDOWN") {
    if (!Array.isArray(result.sources) || result.sources.length === 0) {
      return { ok: false, reasonCode: "NO_INCOME_IN_PERIOD" };
    }
    for (const source of result.sources) {
      const added = builder.add({
        ...common,
        metric,
        value: source.total,
        unit: "INR",
        source: "INCOME",
        groupKey: source.source,
      });
      if (!added.ok) return { ok: false, reasonCode: added.reason || "FACT_SET_BUILD_FAILED" };
    }
    return { ok: true };
  }

  if (metric === "TREND_SERIES") {
    if (!Array.isArray(result.series) || result.series.length === 0) {
      return { ok: false, reasonCode: "NO_TREND_DATA" };
    }
    for (const point of result.series) {
      const pointStart = new Date(Date.UTC(point.year, point.month - 1, 1));
      const pointEnd = new Date(Date.UTC(point.year, point.month, 1));
      const added = builder.add({
        periodStart: pointStart,
        periodEnd: pointEnd,
        periodLabel: point.monthLabel,
        metric,
        value: point.total,
        unit: "INR",
        source: "DERIVED",
        groupKey: point.monthLabel,
      });
      if (!added.ok) return { ok: false, reasonCode: added.reason || "FACT_SET_BUILD_FAILED" };
    }
    return { ok: true };
  }

  if (metric === "PERIOD_COMPARISON") {
    const reasonCode = result.percentChange !== null ? `${result.direction}:${result.percentChange}%` : result.direction;
    const added = builder.add({
      ...common,
      metric,
      value: result.delta,
      unit: "INR",
      source: "DERIVED",
      reasonCode: reasonCode,
    });
    return added.ok ? { ok: true } : { ok: false, reasonCode: added.reason || "FACT_SET_BUILD_FAILED" };
  }

  const metadataByMetric = {
    EXPENSE_TOTAL: { value: result.value, unit: "INR", source: "EXPENSE" },
    EXPENSE_COUNT: { value: result.value, unit: "COUNT", source: "EXPENSE" },
    DAILY_SPENDING_AVERAGE: { value: result.value, unit: "INR", source: "DERIVED" },
    CATEGORY_TOTAL: { value: result.value, unit: "INR", source: "EXPENSE", groupKey: query.categoryFilter },
    INCOME_TOTAL: { value: result.value, unit: "INR", source: "INCOME" },
    INCOME_COUNT: { value: result.value, unit: "COUNT", source: "INCOME" },
    NET_CASH_FLOW: { value: result.value, unit: "INR", source: "DERIVED" },
    BUDGET_AMOUNT: { value: result.budget, unit: "INR", source: "BUDGET" },
    BUDGET_SPENT: { value: result.spent, unit: "INR", source: "BUDGET" },
    BUDGET_REMAINING: { value: result.remaining, unit: "INR", source: "BUDGET" },
    BUDGET_UTILIZATION: { value: result.utilization, unit: "PERCENT", source: "BUDGET" },
    BUDGET_STATUS: { value: result.spent, unit: "INR", source: "BUDGET", reasonCode: result.status },
  };

  const metadata = metadataByMetric[metric];
  if (!metadata) return { ok: false, reasonCode: "UNSUPPORTED_METRIC" };
  const added = builder.add({ ...common, metric, ...metadata });
  return added.ok ? { ok: true } : { ok: false, reasonCode: added.reason || "FACT_SET_BUILD_FAILED" };
}

async function executeV2PlanToFactSet({ userId, plan, financialQueryService, now, timeZone }) {
  if (!financialQueryService || typeof financialQueryService.executeFinancialQuery !== "function") {
    return { ok: false, reasonCode: "QUERY_EXECUTOR_UNAVAILABLE" };
  }

  const builder = createFactSetBuilder();
  for (const query of plan.queries) {
    if (!isV2DeterministicQuery(query)) {
      return { ok: false, reasonCode: "V2_PROSE_NOT_AVAILABLE" };
    }

    const period = resolvePeriod(query.period, { now, timeZone });
    if (!period.ok) return { ok: false, reasonCode: `PERIOD_${period.reason}` };

    const periods = [period];
    if (query.operation === "COMPARE" && query.metric !== "PERIOD_COMPARISON") {
      const comparisonPeriod = resolvePeriod(query.comparisonPeriod, { now, timeZone });
      if (!comparisonPeriod.ok) return { ok: false, reasonCode: `COMPARISON_PERIOD_${comparisonPeriod.reason}` };
      periods.push(comparisonPeriod);
    }

    for (const queryPeriod of periods) {
      let resolvedComparisonPeriod;
      if (query.metric === "PERIOD_COMPARISON" && query.comparisonPeriod) {
        const compRes = resolvePeriod(query.comparisonPeriod, { now, timeZone });
        if (!compRes.ok) return { ok: false, reasonCode: `COMPARISON_PERIOD_${compRes.reason}` };
        resolvedComparisonPeriod = compRes;
      }

      let result;
      try {
        result = await financialQueryService.executeFinancialQuery({
          userId,
          query,
          period: queryPeriod,
          budgetYearMonth: deriveYearMonthForBudgetQuery(query, queryPeriod, timeZone),
          comparisonPeriod: resolvedComparisonPeriod,
          timeZone,
        });
      } catch (_err) {
        return { ok: false, reasonCode: "FINANCIAL_QUERY_FAILED" };
      }

      if (!result || !result.hasData) return { ok: false, reasonCode: (result && result.reasonCode) || "NO_DATA" };
      const added = addV2ResultFacts({ builder, query, period: queryPeriod, result });
      if (!added.ok) return added;
    }
  }

  const factSet = builder.build();
  return factSet.facts.length > 0 ? { ok: true, factSet } : { ok: false, reasonCode: "NO_DATA" };
}

function renderV2DeterministicAnswer(factSet) {
  const sentences = [];
  for (const fact of factSet.facts) {
    switch (fact.metric) {
      case "EXPENSE_TOTAL":
        sentences.push(`You spent ${formatInr(fact.value)} ${fact.periodLabel}.`);
        break;
      case "EXPENSE_COUNT":
        sentences.push(`You logged ${fact.value} expense${fact.value === 1 ? "" : "s"} ${fact.periodLabel}.`);
        break;
      case "DAILY_SPENDING_AVERAGE":
        sentences.push(`Your average daily spending ${fact.periodLabel} was ${formatInr(fact.value)}.`);
        break;
      case "CATEGORY_TOTAL":
        sentences.push(`You spent ${formatInr(fact.value)} on ${fact.groupKey} ${fact.periodLabel}.`);
        break;
      case "CATEGORY_BREAKDOWN":
        sentences.push(`${fact.groupKey}: ${formatInr(fact.value)} ${fact.periodLabel}.`);
        break;
      case "TOP_CATEGORY":
        sentences.push(`Your top spending category ${fact.periodLabel} was ${fact.groupKey} at ${formatInr(fact.value)}.`);
        break;
      case "INCOME_TOTAL":
        sentences.push(`Your total income ${fact.periodLabel} was ${formatInr(fact.value)}.`);
        break;
      case "INCOME_COUNT":
        sentences.push(`You logged ${fact.value} income entr${fact.value === 1 ? "y" : "ies"} ${fact.periodLabel}.`);
        break;
      case "NET_CASH_FLOW":
        sentences.push(`Your net cash flow ${fact.periodLabel} was ${formatInr(fact.value)}.`);
        break;
      case "BUDGET_AMOUNT":
        sentences.push(`Your configured budget ${fact.periodLabel} is ${formatInr(fact.value)}.`);
        break;
      case "BUDGET_SPENT":
        sentences.push(`You have spent ${formatInr(fact.value)} against your budget ${fact.periodLabel}.`);
        break;
      case "BUDGET_REMAINING":
        sentences.push(`You have ${formatInr(fact.value)} remaining in your budget ${fact.periodLabel}.`);
        break;
      case "BUDGET_UTILIZATION":
        sentences.push(`You have used ${fact.value}% of your budget ${fact.periodLabel}.`);
        break;
      case "BUDGET_STATUS":
        sentences.push(`Your budget status ${fact.periodLabel} is ${fact.reasonCode === "over_budget" ? "over budget" : "within budget"}.`);
        break;
      case "PERIOD_COMPARISON": {
        const percentPart = fact.reasonCode && fact.reasonCode.includes(":") ? ` (${fact.reasonCode.split(":")[1]})` : "";
        const direction = fact.reasonCode && fact.reasonCode.includes(":") ? fact.reasonCode.split(":")[0] : fact.reasonCode;
        const dirLabel = direction === "increase" ? "increased" : direction === "decrease" ? "decreased" : "did not change";
        sentences.push(`Your spending ${dirLabel} by ${formatInr(Math.abs(fact.value))}${percentPart} compared to the previous period.`);
        break;
      }
      case "INCOME_BREAKDOWN":
        sentences.push(`${fact.groupKey}: ${formatInr(fact.value)} ${fact.periodLabel}.`);
        break;
      case "TREND_SERIES":
        sentences.push(`${fact.groupKey}: ${formatInr(fact.value)}.`);
        break;
      default:
        break;
    }
  }
  return sentences.join(" ");
}

/* @param {object} args */
async function runSemanticPipeline({
  question,
  userId,
  previousPlanSummary,
  now,
  timeZone,
  routerCall,
  askLlmFn = defaultAskLlm,
  financialQueryService = defaultFinancialQueryService,
  existingIntentHandler,
  resumePlan,
  onPlanResolved,
} = {}) {
  let plan;
  let routerCallsUsed;

  if (resumePlan) {
    // A checkpointed plan from a prior attempt -- re-validated defensively
    const revalidated = validateQueryPlan(resumePlan);
    if (!revalidated.valid) {
      return { kind: "unsupported", reasonCode: "INVALID_RESUME_PLAN", providerCallsUsed: { router: 0, answer: 0 } };
    }
    plan = revalidated.plan;
    routerCallsUsed = 0;
  } else {
    // Step 1: deterministic prohibited-phrase rejection -- 0 provider
    // calls, never even reaches the semantic router.
    if (isClearlyProhibited(question)) {
      return { kind: "unsupported", reasonCode: "PROHIBITED_REQUEST", providerCallsUsed: { router: 0, answer: 0 } };
    }

    // Step 2/3: semantic router call + local QueryPlan validation (inside
    // semanticRouter.js itself).
    const routing = await routeQuestion({ question, previousPlanSummary, now, timeZone, routerCall });
    if (!routing.ok) {
      return { kind: "unsupported", reasonCode: routing.reason, providerCallsUsed: { router: 1, answer: 0 } };
    }
    plan = routing.plan;
    routerCallsUsed = 1;
  }

  // Step 4: clarification -- 0 answer-generation calls.
  if (plan.outcome === "clarification") {
    if (typeof onPlanResolved === "function") {
      try {
        await onPlanResolved(plan);
      } catch (_err) {
        // Checkpointing is best-effort -- never fails the actual response.
      }
    }
    return { kind: "clarification", plan, providerCallsUsed: { router: routerCallsUsed, answer: 0 } };
  }

  // Step 5: unsupported -- 0 answer-generation calls.
  if (plan.outcome === "unsupported") {
    return { kind: "unsupported", reasonCode: "PLAN_UNSUPPORTED", providerCallsUsed: { router: routerCallsUsed, answer: 0 } };
  }

  // outcome === "supported" -- checkpoint the plan now, before any
  // execution or answer-generation call is attempted.
  if (typeof onPlanResolved === "function") {
    try {
      await onPlanResolved(plan);
    } catch (_err) {
      // Checkpointing is best-effort -- never fails the actual response.
    }
  }

  // V2 allows up to five independently validated queries. It is ready for
  if (plan.version === 2) {
    const v2Result = await executeV2PlanToFactSet({ userId, plan, financialQueryService, now, timeZone });
    if (!v2Result.ok) {
      return { kind: "no_data", reasonCode: v2Result.reasonCode, providerCallsUsed: { router: routerCallsUsed, answer: 0 } };
    }

    const needsProse = plan.queries.some(
      (query) => query.responseMode === "PROSE" || query.operation === "EXPLAIN" || query.operation === "COMPARE"
    );
    if (needsProse) {
      let llmResult;
      try {
        llmResult = await askLlmFn({
          systemPrompt: SEMANTIC_EXPLANATION_SYSTEM_PROMPT,
          context: { factSet: v2Result.factSet },
          question,
          history: [],
          structuredOutput: SEMANTIC_ANSWER_STRUCTURED_OUTPUT,
        });
      } catch (_err) {
        return { kind: "unsupported", reasonCode: "PROVIDER_FAILED", providerCallsUsed: { router: routerCallsUsed, answer: 1 } };
      }

      const parsed = normalizeSemanticAnswer(llmResult && (llmResult.structuredOutput || llmResult.answer));
      if (!parsed || typeof parsed.answer !== "string") {
        return { kind: "unsupported", reasonCode: "MALFORMED_ANSWER_RESPONSE", providerCallsUsed: { router: routerCallsUsed, answer: 1 } };
      }
      const validation = validateCitedAnswer({ answer: parsed.answer, citedFactIds: parsed.citedFactIds, factSet: v2Result.factSet, plan });
      if (!validation.valid) {
        return { kind: "unsupported", reasonCode: `GROUNDING_${validation.reasonCode}`, providerCallsUsed: { router: routerCallsUsed, answer: 1 } };
      }
      return {
        kind: "answer",
        answer: parsed.answer,
        grounding: buildDeterministicGrounding(),
        interpretation: { periodLabels: [...new Set(v2Result.factSet.facts.map((fact) => fact.periodLabel))], metrics: plan.queries.map((query) => query.metric) },
        planSummary: buildV2PlanSummary(plan, v2Result.factSet),
        providerCallsUsed: { router: routerCallsUsed, answer: 1 },
      };
    }

    return {
      kind: "answer",
      answer: renderV2DeterministicAnswer(v2Result.factSet),
      grounding: buildDeterministicGrounding(),
      interpretation: { periodLabels: [...new Set(v2Result.factSet.facts.map((fact) => fact.periodLabel))], metrics: plan.queries.map((query) => query.metric) },
      planSummary: buildV2PlanSummary(plan, v2Result.factSet),
      providerCallsUsed: { router: routerCallsUsed, answer: 0 },
    };
  }

  const period = resolvePeriod(plan.period, { now, timeZone });
  if (!period.ok) {
    return { kind: "unsupported", reasonCode: `PERIOD_${period.reason}`, providerCallsUsed: { router: routerCallsUsed, answer: 0 } };
  }

  // Step 7 (checked before the deterministic branch): one of the existing
  const explanationMetric = plan.metrics.find((m) => EXPLANATION_INTENT_METRICS.has(m));
  if (explanationMetric) {
    if (typeof existingIntentHandler !== "function") {
      return { kind: "unsupported", reasonCode: "NO_EXPLANATION_HANDLER", providerCallsUsed: { router: routerCallsUsed, answer: 0 } };
    }
    const delegated = await existingIntentHandler(explanationMetric);
    return {
      kind: "explanation_intent_delegated",
      intent: explanationMetric,
      planSummary: buildPlanSummary(plan, period),
      result: delegated,
      providerCallsUsed: { router: routerCallsUsed, answer: delegated && delegated.usedAnswerCall ? 1 : 0 },
    };
  }

  const allDeterministic = plan.metrics.every((m) => DETERMINISTIC_METRICS.has(m));
  const needsProse = plan.operation === "EXPLAIN" || plan.operation === "FORECAST" || plan.operation === "COMPARE";

  // Step 6: simple deterministic LOOKUP/BREAKDOWN metric -- executed via
  // financialQueryService.js, answered in backend code, 0 answer calls.
  if (allDeterministic && !needsProse) {
    const factSetResult = await executeMetricToFactSet({ userId, plan, period, financialQueryService, now, timeZone });
    if (!factSetResult.ok) {
      return { kind: "no_data", reasonCode: factSetResult.reasonCode, providerCallsUsed: { router: routerCallsUsed, answer: 0 } };
    }
    return {
      kind: "answer",
      answer: renderDeterministicAnswer(plan, factSetResult.factSet, period),
      grounding: buildDeterministicGrounding(),
      interpretation: { periodLabel: period.label, metrics: plan.metrics },
      planSummary: buildPlanSummary(plan, period),
      providerCallsUsed: { router: routerCallsUsed, answer: 0 },
    };
  }

  // Step 8: EXPLAIN/FORECAST/COMPARE needing prose -- ONE askLlm call,
  // given ONLY the minimal FactSet + question, never the full report.
  if (!allDeterministic) {
    return { kind: "unsupported", reasonCode: "UNSUPPORTED_METRIC_FOR_PROSE", providerCallsUsed: { router: routerCallsUsed, answer: 0 } };
  }

  const factSetResult = await executeMetricToFactSet({ userId, plan, period, financialQueryService, now, timeZone });
  if (!factSetResult.ok) {
    return { kind: "no_data", reasonCode: factSetResult.reasonCode, providerCallsUsed: { router: routerCallsUsed, answer: 0 } };
  }

  let llmResult;
  try {
    llmResult = await askLlmFn({
      systemPrompt: SEMANTIC_EXPLANATION_SYSTEM_PROMPT,
      context: { factSet: factSetResult.factSet },
      question,
      history: [],
      structuredOutput: SEMANTIC_ANSWER_STRUCTURED_OUTPUT,
    });
  } catch (_err) {
    return { kind: "unsupported", reasonCode: "PROVIDER_FAILED", providerCallsUsed: { router: routerCallsUsed, answer: 1 } };
  }

  const parsed = normalizeSemanticAnswer(llmResult && (llmResult.structuredOutput || llmResult.answer));
  if (!parsed || typeof parsed.answer !== "string") {
    return { kind: "unsupported", reasonCode: "MALFORMED_ANSWER_RESPONSE", providerCallsUsed: { router: routerCallsUsed, answer: 1 } };
  }

  const validation = validateCitedAnswer({
    answer: parsed.answer,
    citedFactIds: parsed.citedFactIds,
    factSet: factSetResult.factSet,
    plan,
  });
  if (!validation.valid) {
    return { kind: "unsupported", reasonCode: `GROUNDING_${validation.reasonCode}`, providerCallsUsed: { router: routerCallsUsed, answer: 1 } };
  }

  return {
    kind: "answer",
    answer: parsed.answer,
    grounding: buildDeterministicGrounding(),
    interpretation: { periodLabel: period.label, metrics: plan.metrics },
    planSummary: buildPlanSummary(plan, period),
    providerCallsUsed: { router: routerCallsUsed, answer: 1 },
  };
}

module.exports = {
  runSemanticPipeline,
  executeMetricToFactSet,
  renderDeterministicAnswer,
  executeV2PlanToFactSet,
  renderV2DeterministicAnswer,
  buildV2PlanSummary,
  SEMANTIC_ANSWER_STRUCTURED_OUTPUT,
  formatInr,
  DETERMINISTIC_METRICS,
  EXPLANATION_INTENT_METRICS,
};
