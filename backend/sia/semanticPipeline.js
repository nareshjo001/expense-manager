// SIA semantic pipeline -- orchestrates the NEW layer ask.js falls back to
// only after the existing deterministic classifyIntent() returns null.
// Implements the pipeline order this milestone requires:
//   1. Deterministic prohibited-phrase rejection (0 provider calls).
//   2. Semantic router call (1 router call).
//   3. QueryPlan validation (already done inside semanticRouter.js).
//   4. `clarification` outcome -> return immediately, 0 answer calls.
//   5. `unsupported` outcome -> return immediately, 0 answer calls.
//   6. `supported` + a simple deterministic metric -> execute via
//      financialQueryService.js, build a FactSet, answer DETERMINISTICALLY
//      in backend code (0 answer-generation calls) with INR/en-IN
//      formatting.
//   7. `supported` + one of the four existing analytics explanation
//      intents (HEALTH/ANOMALY/FORECAST/RISK) -> delegate to the
//      CALLER-supplied `existingIntentHandler`, which runs the existing,
//      UNCHANGED buildContext -> askLlm -> validateGroundedAnswer pipeline
//      (at most 1 answer call) -- never reinvented here.
//   8. `supported` + EXPLAIN/FORECAST/COMPARE needing prose -> call
//      askLlm ONCE with ONLY the minimal FactSet + question, then
//      validate via responseValidator.js's validateCitedAnswer.
//
// Every external effect (the router call, askLlm, financialQueryService,
// the existing-intent delegate) is INJECTABLE so callers/tests can count
// invocations precisely and never touch a live provider.
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

/**
 * @param {object} args
 * @param {string} args.question
 * @param {string} args.userId
 * @param {object} [args.previousPlanSummary]
 * @param {Date} [args.now]
 * @param {string} [args.timeZone]
 * @param {Function} [args.routerCall] - injected, forwarded to semanticRouter.routeQuestion.
 * @param {Function} [args.askLlmFn] - injected in place of llmService.askLlm.
 * @param {object} [args.financialQueryService] - injected in place of the real service.
 * @param {(explanationIntent: string) => Promise<object>} [args.existingIntentHandler] -
 *   delegate to the EXISTING deterministic-intent pipeline for the 4
 *   analytics explanation intents. Must return
 *   `{ result: <response payload>, usedAnswerCall: boolean }`.
 * @param {object} [args.resumePlan] - an idempotency plan CHECKPOINT
 *   (idempotencyService.js) from a prior attempt whose router call
 *   already succeeded but whose answer generation failed before
 *   completion. When supplied, the router is NEVER called again -- the
 *   checkpointed plan is re-validated (defense in depth) and used
 *   directly, so a retry with the same idempotency key never re-pays the
 *   router's provider cost.
 * @param {(plan: object) => Promise<void>} [args.onPlanResolved] - invoked
 *   ONCE, immediately after a `supported`/`clarification` plan is
 *   obtained (from the router OR from `resumePlan`) and BEFORE any
 *   financialQueryService execution or answer-generation call. The
 *   caller (ask.js) uses this to persist the idempotency plan checkpoint
 *   before risking an answer-generation failure. Errors thrown here are
 *   swallowed -- checkpointing is best-effort and must never break the
 *   actual answer.
 * @returns {Promise<{ kind: string, providerCallsUsed: { router: number, answer: number }, [key: string]: any }>}
 */
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
    // (never half-trusted just because it came from storage) but the
    // router is deliberately NEVER called again.
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

  const period = resolvePeriod(plan.period, { now, timeZone });
  if (!period.ok) {
    return { kind: "unsupported", reasonCode: `PERIOD_${period.reason}`, providerCallsUsed: { router: routerCallsUsed, answer: 0 } };
  }

  // Step 7 (checked before the deterministic branch): one of the existing
  // four analytics explanation intents -- delegate to the CALLER-supplied
  // handler, which runs the UNCHANGED existing pipeline. Never reinvented
  // here, never given a FactSet.
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
    });
  } catch (_err) {
    return { kind: "unsupported", reasonCode: "PROVIDER_FAILED", providerCallsUsed: { router: routerCallsUsed, answer: 1 } };
  }

  const parsed = safeParseJson(llmResult && llmResult.answer);
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
  formatInr,
  DETERMINISTIC_METRICS,
  EXPLANATION_INTENT_METRICS,
};
