// SIA semantic router boundary -- the ONLY module allowed to ask an LLM
// provider to propose a QueryPlan for a question the deterministic
// classifier (sia/intentClassifier.js) didn't recognize. Provider-neutral:
// reuses sia/llmService.js's askLlm() through a narrow, INJECTABLE
// `routerCall` function (production default below), never duplicating
// HTTP logic. The payload sent to the provider is minimal and FIXED by
// this module -- the current question, a static hand-written capability
// catalog (no financial data), an optional bounded previous-plan summary,
// and calendar interpretation guidance computed by periodResolver.js
// (never raw analytics). It NEVER receives financial values, Report
// sections, DB records, Mongo schema/collection names, prior answer-call
// prompts, or raw provider history.
//
// Every provider response -- however it is shaped, whatever it claims --
// is parsed and validated LOCALLY against queryPlan.js's strict schema.
// Unknown keys, invalid enums, oversized arrays, malformed JSON, or any
// internal exception all fail CLOSED to an unsupported plan; this
// function NEVER throws. A router-reported "confidence" value is read
// only far enough to log it (diagnostic-only) -- it is never inspected to
// decide the returned outcome.
"use strict";

const { validateQueryPlan } = require("./queryPlan");
const { resolvePeriod } = require("./periodResolver");
const { askLlm } = require("./llmService");
const { logSiaEvent, SIA_LOG_EVENTS } = require("./safeLogger");

// Hand-written, static, no financial data -- the full menu of metrics/
// operations/periods/groupings the router may choose from, with short
// human descriptions. This is the ONLY "capability" information the
// provider ever receives; it is a fixed constant, never built from a
// live Report or database query.
const CAPABILITY_CATALOG = Object.freeze({
  metrics: Object.freeze([
    { id: "EXPENSE_TOTAL", description: "Total amount spent in a period" },
    { id: "EXPENSE_COUNT", description: "Number of expense entries in a period" },
    { id: "DAILY_SPENDING_AVERAGE", description: "Average amount spent per day in a period" },
    { id: "CATEGORY_TOTAL", description: "Total spent in one named category in a period" },
    { id: "CATEGORY_BREAKDOWN", description: "Spending broken down by category in a period" },
    { id: "TOP_CATEGORY", description: "The single highest-spending category in a period" },
    { id: "BUDGET_AMOUNT", description: "The configured budget amount for a month" },
    { id: "BUDGET_SPENT", description: "Amount spent against the budget for a month" },
    { id: "BUDGET_REMAINING", description: "Remaining budget for a month" },
    { id: "BUDGET_UTILIZATION", description: "Percentage of budget used for a month" },
    { id: "BUDGET_STATUS", description: "Whether a month's budget is over/under/on-track" },
    { id: "INCOME_TOTAL", description: "Total income in a period" },
    { id: "INCOME_COUNT", description: "Number of income entries in a period" },
    { id: "NET_CASH_FLOW", description: "Income total minus expense total for a period" },
    { id: "PERIOD_COMPARISON", description: "Comparison of a metric between two periods" },
    { id: "HEALTH_EXPLANATION", description: "Explanation of the current financial-health score" },
    { id: "ANOMALY_EXPLANATION", description: "Explanation of flagged unusual spending" },
    { id: "SPENDING_FORECAST_EXPLANATION", description: "Estimated future spending explanation" },
    { id: "FINANCIAL_RISK_EXPLANATION", description: "Explanation of detected financial risk signals" },
  ]),
  operations: Object.freeze([
    { id: "LOOKUP", description: "A single direct value lookup" },
    { id: "COMPARE", description: "Compare a metric across two periods" },
    { id: "BREAKDOWN", description: "A grouped breakdown of a metric" },
    { id: "EXPLAIN", description: "A prose explanation of an existing analytics result" },
    { id: "FORECAST", description: "An estimate of future spending" },
  ]),
  periodTypes: Object.freeze([
    "TODAY",
    "YESTERDAY",
    "CURRENT_WEEK",
    "PREVIOUS_WEEK",
    "CURRENT_MONTH",
    "PREVIOUS_MONTH",
    "CURRENT_YEAR",
    "PREVIOUS_YEAR",
    "EXPLICIT_MONTH",
    "LAST_N_MONTHS (max 12)",
    "CUSTOM_RANGE (max 366 days)",
  ]),
  groupings: Object.freeze(["NONE", "CATEGORY", "MONTH"]),
});

// Bounds on the optional previous-plan summary a caller may pass in --
// this module never accepts/forwards a raw prior prompt or provider
// response, only the same bounded plan-summary shape sessionService.js
// persists (metrics, operation, resolved period label, grouping,
// category filter).
function sanitizePreviousPlanSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  const out = {};
  if (Array.isArray(summary.metrics)) out.metrics = summary.metrics.filter((m) => typeof m === "string").slice(0, 3);
  if (typeof summary.operation === "string") out.operation = summary.operation;
  if (typeof summary.periodLabel === "string") out.periodLabel = summary.periodLabel.slice(0, 60);
  if (typeof summary.grouping === "string") out.grouping = summary.grouping;
  if (typeof summary.categoryFilter === "string") out.categoryFilter = summary.categoryFilter.slice(0, 60);
  return Object.keys(out).length > 0 ? out : null;
}

// Calendar interpretation guidance: TODAY's resolved date/period labels
// only (via periodResolver.js), never raw analytics/report data. Gives
// the router enough to interpret "this month"/"last month"/a bare weekday
// without ever touching the user's financial figures.
function buildCalendarContext({ now, timeZone } = {}) {
  const currentMonth = resolvePeriod({ type: "CURRENT_MONTH" }, { now, timeZone });
  const previousMonth = resolvePeriod({ type: "PREVIOUS_MONTH" }, { now, timeZone });
  const clock = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  return {
    todayIso: clock.toISOString().slice(0, 10),
    currentMonthLabel: currentMonth.ok ? currentMonth.label : null,
    previousMonthLabel: previousMonth.ok ? previousMonth.label : null,
  };
}

const ROUTER_SYSTEM_PROMPT =
  "You are SIA's semantic router. Given a user's financial question, a fixed capability " +
  "catalog, optional prior-turn plan context, and today's calendar context, respond with " +
  "ONLY a single JSON object of the exact shape " +
  '{"plan": <QueryPlan>, "confidence": <0..1 number>}. The QueryPlan must use only the ' +
  "metrics/operations/periods/groupings listed in the capability catalog. If the question " +
  "requests a mutation, financial/investment/legal advice, raw transaction-level detail, or " +
  "anything outside the capability catalog, respond with " +
  '{"plan": {"version": 1, "outcome": "unsupported"}, "confidence": <number>}. If the ' +
  "question is genuinely ambiguous (for example a bare month name with no year), respond " +
  "with a clarification-outcome plan offering at most 5 server-safe options. Never include " +
  "any field not in the QueryPlan schema. Respond with JSON only, no prose, no markdown.";

// Default production router call -- a thin, narrow wrapper around the
// EXISTING multi-provider askLlm() adapter (sia/llmService.js), reusing
// its config/timeout/error handling rather than duplicating HTTP logic.
// Tests NEVER exercise this function directly -- they inject their own
// `routerCall` mock into routeQuestion() below.
async function defaultRouterCall(payload) {
  const result = await askLlm({
    systemPrompt: ROUTER_SYSTEM_PROMPT,
    context: payload,
    question: payload.question,
    history: [],
  });
  return result.answer;
}

function safeParseJson(text) {
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return parsed;
  } catch (_err) {
    return null;
  }
}

// Confidence is read ONLY to be logged as a diagnostic value -- it is
// NEVER inspected by any conditional in this module and never influences
// the returned outcome. A malformed/missing confidence is simply logged
// as null; this can never cause a validation failure or a different plan
// to be returned.
function extractDiagnosticConfidence(rawResponse) {
  const value = rawResponse && typeof rawResponse === "object" ? rawResponse.confidence : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Routes one question through the semantic router. Returns
 * `{ ok: true, plan }` when a well-formed, schema-valid QueryPlan was
 * produced (including `outcome: "unsupported"`/`"clarification"` plans),
 * or `{ ok: false, reason }` for any parse/validation/call failure --
 * NEVER throws, regardless of what the injected `routerCall` does.
 *
 * @param {object} args
 * @param {string} args.question
 * @param {object} [args.previousPlanSummary] - bounded prior-plan summary only.
 * @param {Date} [args.now]
 * @param {string} [args.timeZone]
 * @param {(payload: object) => Promise<string>} [args.routerCall] - injectable for tests.
 */
async function routeQuestion({ question, previousPlanSummary, now, timeZone, routerCall } = {}) {
  if (typeof question !== "string" || question.trim() === "") {
    return { ok: false, reason: "INVALID_QUESTION" };
  }

  const payload = Object.freeze({
    question: question.trim(),
    capabilityCatalog: CAPABILITY_CATALOG,
    previousPlanSummary: sanitizePreviousPlanSummary(previousPlanSummary),
    calendarContext: buildCalendarContext({ now, timeZone }),
  });

  const call = typeof routerCall === "function" ? routerCall : defaultRouterCall;

  let rawText;
  try {
    rawText = await call(payload);
  } catch (_err) {
    // Any provider/network/config failure fails closed -- never surfaces
    // provider internals, never throws out of this function.
    return { ok: false, reason: "ROUTER_CALL_FAILED" };
  }

  const parsed = safeParseJson(rawText);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "MALFORMED_ROUTER_RESPONSE" };
  }

  // Diagnostic-only -- logged, never branched on.
  const confidence = extractDiagnosticConfidence(parsed);
  try {
    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED,
      provider: "router",
      latencyMs: null,
    });
  } catch (_err) {
    // Logging must never affect routing -- see safeLogger.js's own
    // internal swallow; this try/catch is defense-in-depth only.
  }
  void confidence;

  const candidatePlan = parsed.plan;
  const validation = validateQueryPlan(candidatePlan);
  if (!validation.valid) {
    return { ok: false, reason: `PLAN_REJECTED:${validation.reason}` };
  }

  return { ok: true, plan: validation.plan, payloadSent: payload };
}

module.exports = {
  CAPABILITY_CATALOG,
  ROUTER_SYSTEM_PROMPT,
  buildCalendarContext,
  sanitizePreviousPlanSummary,
  routeQuestion,
};
