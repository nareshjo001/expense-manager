// Grounded-response validation: since system prompts alone don't enforce anything, this is the deterministic gate ask.js runs every answer through for all eight supported intents before it reaches the user -- a failed check is treated exactly like a failed provider result (503), never partially shown. Only currency-marked monetary figures are cross-checked against the real context (harmless count language like "3 categories" is never flagged); it validates defined invariants only, not every natural-language claim.
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";
const BUDGET_STATUS_EXPLANATION = "BUDGET_STATUS_EXPLANATION";
const CATEGORY_SPENDING_EXPLANATION = "CATEGORY_SPENDING_EXPLANATION";
const ANOMALY_EXPLANATION = "ANOMALY_EXPLANATION";
const SPENDING_FORECAST_EXPLANATION = "SPENDING_FORECAST_EXPLANATION";
const FINANCIAL_RISK_EXPLANATION = "FINANCIAL_RISK_EXPLANATION";
// Additive only.
const CURRENT_SPENDING_SUMMARY = "CURRENT_SPENDING_SUMMARY";

// Matches the persisted assistant-message/request ceiling. Enforcing the
// bound before a response leaves SIA prevents an oversized provider output
// from reaching the client when persistence is unavailable or best-effort.
const MAX_ANSWER_LENGTH = 4000;

// All eight SIA-supported intents receive the shared generic checks (leaked identifiers, raw field tokens, echoed JSON, unsupported currency figures); the intent-specific checks below (fraud/certainty/advice/comparison/category/forecast/transaction-detail language) stay scoped to only the intents they've always applied to -- deliberately not extended further, since broad keyword matching risks rejecting valid explanations.
const VALIDATED_INTENTS = new Set([
  HEALTH_EXPLANATION,
  SPENDING_CHANGE_EXPLANATION,
  BUDGET_STATUS_EXPLANATION,
  CATEGORY_SPENDING_EXPLANATION,
  ANOMALY_EXPLANATION,
  SPENDING_FORECAST_EXPLANATION,
  FINANCIAL_RISK_EXPLANATION,
  CURRENT_SPENDING_SUMMARY,
]);

// A 24-character lowercase hex string is the shape of a Mongo ObjectId --
// never a legitimate word in a natural-language financial explanation.
const MONGO_ID_PATTERN = /\b[a-f0-9]{24}\b/i;

// Explicit, non-exhaustive blocklist of internal-only field/variable names that have no reason to appear verbatim in a natural-language answer -- catches a provider echoing internal structure back.
const RAW_FIELD_TOKENS = [
  "_sortMultiple",
  "recentExpensePool",
  "currentMonthExpenses",
  "forecastMonthlySeries",
  "userId",
  "_id",
  "baseline",
];

// A literal `"key":` JSON fragment in the answer text is a sign the
// provider echoed raw structured data instead of writing prose.
const JSON_KEY_FRAGMENT_PATTERN = /"[a-zA-Z_][a-zA-Z0-9_]*"\s*:/;

// Only currency-MARKED numbers are extracted as "financial claims" --
// this is what keeps the check from being a brittle "reject every digit"
// filter. A bare "3" (a count) is never touched.
const CURRENCY_AMOUNT_PATTERN = /(?:₹|\$|Rs\.?|INR)\s?(-?[\d,]+(?:\.\d{1,2})?)/gi;

// A percentage framed as a chance/likelihood/certainty -- risk's real contract never carries a calibrated probability, so this framing is always unsupported.
const PROBABILITY_LANGUAGE_PATTERN = /\b\d{1,3}(\.\d+)?\s?%\s*(chance|probability|likely|likelihood|certain|sure)\b/i;

const CERTAINTY_LANGUAGE_PATTERN =
  /\b(guarantee[sd]?|will definitely|100\s?%\s*(certain|sure|guaranteed)|certainly will|is certain to|without (a )?doubt)\b/i;

const FRAUD_LANGUAGE_PATTERN = /\b(fraud(ulent)?|theft|stolen|stole|scam(med)?|embezzle(ment)?)\b/i;

const ADVICE_LANGUAGE_PATTERN =
  /\b(invest in|take out a loan|refinance your|consult (a|your) (lawyer|attorney|tax advisor)|you should (buy|sell) (stocks?|shares?|bonds?)|tax deduction advice|legal advice)\b/i;

// Reason-code-name overstatement guardrails -- not global word bans, each gated to the exact intent/signal whose evidence can't support the flagged language. "next month" stays untouched for SPENDING_FORECAST_EXPLANATION (genuinely accurate there); only checked against a FINANCIAL_RISK_EXPLANATION answer grounded on FORECASTED_FINANCIAL_PRESSURE, whose evidence field actually projects the current month, not next.
const NEXT_MONTH_LANGUAGE_PATTERN = /\bnext\s+(calendar\s+)?month\b/i;

// PERSISTENT_SPENDING_GROWTH's and SPENDING_CHANGE_EXPLANATION's evidence are both exactly one current-vs-previous-month comparison, never a multi-period series.
const PERSISTENCE_LANGUAGE_PATTERN = /\b(persistent(ly)?|sustained|long[- ]term|multi[- ]month|repeated(ly)?)\b/i;

// DETERIORATING_HEALTH's and HEALTH_EXPLANATION's context both carry only the current financial-health score, never a historical series.
const DECLINE_LANGUAGE_PATTERN = /\b(declin(?:e|es|ing|ed)|deteriorat(?:e|es|ing|ed)|falling|worsen(?:ing|ed|s)?)\b/i;

// A completed zero-signal risk result means no active rule-based signal was detected, never that the user has no financial risk -- narrowly scoped so the required "no risk signals were found" wording is never flagged.
const NO_RISK_CLAIM_PATTERNS = [
  /\bno\s+financial\s+risk\b(?!\s*(?:signals?|indicators?))/i,
  /\byou\s+(?:are|have)\s+no\s+financial\s+risk\b/i,
  /\bnot\s+at\s+(?:any\s+)?financial\s+risk\b/i,
];

// CURRENT_SPENDING_SUMMARY's context carries exactly one figure --
// summary.totalSpent -- and nothing else: no prior-month comparison, no
// category breakdown, no forecast, no transaction-level detail. Each
// pattern below is narrow and gated to only this intent, mirroring the
// existing reason-code-scoped guardrails above.
const SUMMARY_COMPARISON_CLAIM_PATTERN =
  /\b(increased|decreased|higher than|lower than|more than last|less than last|compared to|compared with|change[ds]? from|vs\.?\s+last|versus last)\b/i;
const SUMMARY_CATEGORY_CLAIM_PATTERN = /\bcategor(?:y|ies)\b/i;
const SUMMARY_FORECAST_CLAIM_PATTERN =
  /\b(forecast(?:ed|ing)?|predict(?:ed|ion)?|projected|projection|next month|next quarter|next year|will spend|expected to spend|estimate[d]?\s+(?:you'll|you will))\b/i;
const SUMMARY_TRANSACTION_DETAIL_PATTERN =
  /\b(transaction id|expense id|merchant|receipt|line item|individual (?:expense|transaction|purchase))\b/i;
const SUMMARY_ADVICE_CLAIM_PATTERN =
  /\b(you should|i recommend|i suggest|consider (?:cutting|reducing|saving|spending))\b/i;

// True only when contextFields.risk.signals[] actually contains a matching reasonCode -- never a guess, never derived from the answer text itself.
function hasRiskSignal(contextFields, reasonCode) {
  const signals = contextFields && contextFields.risk && Array.isArray(contextFields.risk.signals) ? contextFields.risk.signals : [];
  return signals.some((signal) => signal && signal.reasonCode === reasonCode);
}

// True only for a genuine completed zero-signal result; a malformed/absent risk object is left alone (ask.js already routes that case to the no-data path before the provider is called).
function isZeroSignalRiskResult(contextFields) {
  const risk = contextFields && contextFields.risk;
  if (!risk || !Array.isArray(risk.signals)) return false;
  return risk.signals.length === 0;
}

const round2 = (value) => Math.round(value * 100) / 100;

// Recursively collects every finite numeric leaf value from the structured context, rounded to 2 decimals to avoid floating-point false negatives. Numbers only -- a numeric-looking string is never coerced here (this function has no notion of which field it's in), see collectKnownStringAmounts() below for the one narrow exception needed.
function collectNumericValues(node, out) {
  if (typeof node === "number" && Number.isFinite(node)) {
    out.add(round2(node));
  } else if (Array.isArray(node)) {
    for (const child of node) collectNumericValues(child, out);
  } else if (node && typeof node === "object") {
    for (const key of Object.keys(node)) collectNumericValues(node[key], out);
  }
  return out;
}

// budgetAnalyzer.js's `budget`/`spent` fields pass through unchanged from the stored Budget document with no numeric coercion, unlike every other derived value -- so they're the only two fields across the eight intents' context shapes not type-guaranteed to be a JS number. Handled here by exact field path only (never a general "any numeric string" rule), since contextBuilder.js/budgetAnalyzer.js are out of scope for this fix.
const NUMERIC_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

function coerceKnownStringAmount(value, out) {
  if (typeof value === "string" && NUMERIC_STRING_PATTERN.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) out.add(round2(parsed));
  }
}

// Adds contextFields.budget.budget/spent to `out` only when they're strings (the number case is already covered by collectNumericValues()); a missing/malformed contextFields.budget is a safe no-op.
function collectKnownStringAmounts(contextFields, out) {
  const budget = contextFields && contextFields.budget;
  if (!budget || typeof budget !== "object") return out;

  coerceKnownStringAmount(budget.budget, out);
  coerceKnownStringAmount(budget.spent, out);

  return out;
}

function extractCurrencyAmounts(text) {
  const amounts = [];
  const pattern = new RegExp(CURRENCY_AMOUNT_PATTERN.source, CURRENCY_AMOUNT_PATTERN.flags);
  let match = pattern.exec(text);
  while (match !== null) {
    const num = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(num)) amounts.push(round2(num));
    match = pattern.exec(text);
  }
  return amounts;
}

/**
 * @param {object} input
 * @param {string} input.intent
 * @param {string} input.answer - the provider's raw answer text.
 * @param {object} input.contextFields - the exact `fields` object
 *   sia/contextBuilder.js supplied for this turn -- the only source of
 *   truth a currency claim is checked against.
 * @returns {{ valid: true } | { valid: false, reasonCode: string }}
 */
function validateGroundedAnswer({ intent, answer, contextFields }) {
  if (!VALIDATED_INTENTS.has(intent)) {
    return { valid: true };
  }

  if (typeof answer !== "string" || answer.trim() === "") {
    return { valid: false, reasonCode: "EMPTY_OR_MALFORMED_ANSWER" };
  }
  if (answer.length > MAX_ANSWER_LENGTH) {
    return { valid: false, reasonCode: "ANSWER_TOO_LONG" };
  }

  if (MONGO_ID_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "LEAKED_IDENTIFIER" };
  }

  for (const token of RAW_FIELD_TOKENS) {
    if (answer.includes(token)) {
      return { valid: false, reasonCode: "RAW_FIELD_LEAKAGE" };
    }
  }
  if (JSON_KEY_FRAGMENT_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "RAW_FIELD_LEAKAGE" };
  }

  // Generic across all eight validated intents, not just
  // CURRENT_SPENDING_SUMMARY: none of contextBuilder.js's per-intent
  // projections for any intent ever carry merchant/receipt/line-item/
  // transaction-id detail, so a hallucinated claim of that kind is always
  // unsupported regardless of which intent produced it. Found via
  // Workstream 5's adversarial review -- previously only checked for
  // CURRENT_SPENDING_SUMMARY, leaving the other seven intents without a
  // deterministic backstop against a fabricated transaction-level claim.
  if (SUMMARY_TRANSACTION_DETAIL_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "UNSUPPORTED_TRANSACTION_DETAIL" };
  }

  if (intent === ANOMALY_EXPLANATION && FRAUD_LANGUAGE_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "FRAUD_CLAIM" };
  }

  if (intent === FINANCIAL_RISK_EXPLANATION || intent === SPENDING_FORECAST_EXPLANATION) {
    if (PROBABILITY_LANGUAGE_PATTERN.test(answer) || CERTAINTY_LANGUAGE_PATTERN.test(answer)) {
      return { valid: false, reasonCode: "UNSUPPORTED_CERTAINTY_LANGUAGE" };
    }
  }

  if (intent === FINANCIAL_RISK_EXPLANATION && ADVICE_LANGUAGE_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "OUT_OF_SCOPE_ADVICE" };
  }

  // Reason-code-name overstatement guardrails, each gated to the exact intent/signal whose evidence can't support the flagged language -- see the pattern definitions above for the source-cited rationale.
  if (intent === FINANCIAL_RISK_EXPLANATION && hasRiskSignal(contextFields, "FORECASTED_FINANCIAL_PRESSURE")) {
    if (NEXT_MONTH_LANGUAGE_PATTERN.test(answer)) {
      return { valid: false, reasonCode: "UNSUPPORTED_TEMPORAL_CLAIM" };
    }
  }

  if (
    intent === SPENDING_CHANGE_EXPLANATION ||
    (intent === FINANCIAL_RISK_EXPLANATION && hasRiskSignal(contextFields, "PERSISTENT_SPENDING_GROWTH"))
  ) {
    if (PERSISTENCE_LANGUAGE_PATTERN.test(answer)) {
      return { valid: false, reasonCode: "UNSUPPORTED_PERSISTENCE_CLAIM" };
    }
  }

  if (
    intent === HEALTH_EXPLANATION ||
    (intent === FINANCIAL_RISK_EXPLANATION && hasRiskSignal(contextFields, "DETERIORATING_HEALTH"))
  ) {
    if (DECLINE_LANGUAGE_PATTERN.test(answer)) {
      return { valid: false, reasonCode: "UNSUPPORTED_DECLINE_CLAIM" };
    }
  }

  if (intent === CURRENT_SPENDING_SUMMARY) {
    if (SUMMARY_COMPARISON_CLAIM_PATTERN.test(answer)) {
      return { valid: false, reasonCode: "UNSUPPORTED_COMPARISON_CLAIM" };
    }
    if (SUMMARY_CATEGORY_CLAIM_PATTERN.test(answer)) {
      return { valid: false, reasonCode: "UNSUPPORTED_CATEGORY_CLAIM" };
    }
    if (SUMMARY_FORECAST_CLAIM_PATTERN.test(answer)) {
      return { valid: false, reasonCode: "UNSUPPORTED_FORECAST_CLAIM" };
    }
    // (transaction-detail check now runs generically above for all eight
    // intents -- see the comment near JSON_KEY_FRAGMENT_PATTERN.)
    if (SUMMARY_ADVICE_CLAIM_PATTERN.test(answer) || ADVICE_LANGUAGE_PATTERN.test(answer)) {
      return { valid: false, reasonCode: "OUT_OF_SCOPE_ADVICE" };
    }
  }

  if (intent === FINANCIAL_RISK_EXPLANATION && isZeroSignalRiskResult(contextFields)) {
    if (NO_RISK_CLAIM_PATTERNS.some((pattern) => pattern.test(answer))) {
      return { valid: false, reasonCode: "UNSUPPORTED_NO_RISK_CLAIM" };
    }
  }

  const contextNumbers = collectNumericValues(contextFields, new Set());
  // Narrow, exact-field-path addition -- see collectKnownStringAmounts()
  // above. A no-op for every intent/context other than
  // BUDGET_STATUS_EXPLANATION's `{ budget: { budget, spent } }` shape.
  collectKnownStringAmounts(contextFields, contextNumbers);
  const claimedAmounts = extractCurrencyAmounts(answer);
  for (const amount of claimedAmounts) {
    if (!contextNumbers.has(amount)) {
      return { valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" };
    }
  }

  return { valid: true };
}

// ---- Workstream 1: FactSet citation/claim validation ---------------------
//
// Extends this module (rather than duplicating its patterns) to validate
// an LLM explanation answer produced from a bounded FactSet
// (sia/factSet.js) instead of a full contextBuilder.js context -- the
// semantic-routing EXPLAIN/FORECAST/COMPARE path (ask.js). Reuses every
// existing pattern constant above that already covers a rule
// (PERSISTENCE_LANGUAGE_PATTERN, DECLINE_LANGUAGE_PATTERN,
// FRAUD_LANGUAGE_PATTERN, ADVICE_LANGUAGE_PATTERN, MONGO_ID_PATTERN,
// RAW_FIELD_TOKENS, JSON_KEY_FRAGMENT_PATTERN) instead of duplicating them.

// A comparison claim ("higher than", "compared to last month", etc.) is
// only supportable when the plan's operation is genuinely a comparison.
const COMPARISON_CLAIM_PATTERN =
  /\b(increased|decreased|higher than|lower than|more than last|less than last|compared to|compared with|change[ds]? from|vs\.?\s+last|versus last)\b/i;

// A forecast/estimate claim is only supportable when the plan's operation
// is genuinely FORECAST.
const FORECAST_CLAIM_PATTERN =
  /\b(forecast(?:ed|ing)?|predict(?:ed|ion)?|projected|projection|next month|next quarter|next year|will spend|expected to spend|estimate[d]?\s+(?:you'll|you will))\b/i;

// Light, generic advice-language guardrail (mirrors
// SUMMARY_ADVICE_CLAIM_PATTERN's shape) -- applies to every FactSet-cited
// answer regardless of intent/metric.
const GENERIC_ADVICE_CLAIM_PATTERN = /\b(you should|i recommend|i suggest|consider (?:cutting|reducing|saving|spending))\b/i;

function round2Cited(value) {
  return Math.round(value * 100) / 100;
}

// Extracts currency-marked amounts from an answer -- identical contract to
// the private extractCurrencyAmounts() above, exported here (additively,
// non-breaking) so a sibling caller/test can reuse the exact same
// extraction rule instead of re-implementing it.
function extractCurrencyAmountsFromAnswer(text) {
  return extractCurrencyAmounts(text);
}

/**
 * Validates an LLM explanation answer generated from a bounded FactSet
 * (sia/factSet.js) rather than a full contextBuilder.js context.
 *
 * @param {object} input
 * @param {string} input.answer
 * @param {string[]} input.citedFactIds
 * @param {{facts: object[]}} input.factSet
 * @param {{operation?: string, metrics?: string[], queries?: object[]}} [input.plan] - the
 *   QueryPlan this answer was generated for, used only to decide whether
 *   comparison/forecast framing is supportable.
 * @returns {{ valid: true } | { valid: false, reasonCode: string }}
 */
function validateCitedAnswer({ answer, citedFactIds, factSet, plan }) {
  if (typeof answer !== "string" || answer.trim() === "") {
    return { valid: false, reasonCode: "EMPTY_OR_MALFORMED_ANSWER" };
  }
  if (answer.length > MAX_ANSWER_LENGTH) {
    return { valid: false, reasonCode: "ANSWER_TOO_LONG" };
  }

  if (MONGO_ID_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "LEAKED_IDENTIFIER" };
  }
  for (const token of RAW_FIELD_TOKENS) {
    if (answer.includes(token)) {
      return { valid: false, reasonCode: "RAW_FIELD_LEAKAGE" };
    }
  }
  if (JSON_KEY_FRAGMENT_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "RAW_FIELD_LEAKAGE" };
  }
  // Same generic backstop as validateGroundedAnswer's -- a FactSet never
  // carries merchant/receipt/line-item/transaction-id detail either, for
  // any metric.
  if (SUMMARY_TRANSACTION_DETAIL_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "UNSUPPORTED_TRANSACTION_DETAIL" };
  }

  const facts = factSet && Array.isArray(factSet.facts) ? factSet.facts : [];
  const factsById = new Map(facts.map((f) => [f.factId, f]));

  const citedIds = Array.isArray(citedFactIds) ? citedFactIds : [];
  for (const id of citedIds) {
    if (typeof id !== "string" || !factsById.has(id)) {
      return { valid: false, reasonCode: "UNKNOWN_CITED_FACT" };
    }
  }

  const citedFacts = citedIds.map((id) => factsById.get(id));

  // Every currency-marked figure in the answer must belong to a fact that
  // was actually cited -- an invented amount, or a genuine-but-uncited
  // fact value being quoted, both fail here.
  const citedCurrencyValues = new Set(
    citedFacts.filter((f) => f.unit === "INR" && typeof f.value === "number").map((f) => round2Cited(f.value))
  );
  const claimedAmounts = extractCurrencyAmountsFromAnswer(answer).map(round2Cited);
  for (const amount of claimedAmounts) {
    if (!citedCurrencyValues.has(amount)) {
      return { valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" };
    }
  }

  // Every claimed percentage must belong to a cited PERCENT-unit fact.
  const citedPercentValues = new Set(
    citedFacts.filter((f) => f.unit === "PERCENT" && typeof f.value === "number").map((f) => round2Cited(f.value))
  );
  const PERCENT_PATTERN = /(-?\d+(?:\.\d{1,2})?)\s?%/g;
  let percentMatch = PERCENT_PATTERN.exec(answer);
  while (percentMatch !== null) {
    const claimed = round2Cited(Number(percentMatch[1]));
    if (!citedPercentValues.has(claimed)) {
      return { valid: false, reasonCode: "UNSUPPORTED_PERCENTAGE_CLAIM" };
    }
    percentMatch = PERCENT_PATTERN.exec(answer);
  }

  const v2Queries = plan && plan.version === 2 && Array.isArray(plan.queries) ? plan.queries : null;
  const operation = plan && typeof plan.operation === "string" ? plan.operation : null;
  const metrics = v2Queries ? v2Queries.map((query) => query && query.metric).filter(Boolean) : plan && Array.isArray(plan.metrics) ? plan.metrics : [];
  const operations = v2Queries ? v2Queries.map((query) => query && query.operation).filter(Boolean) : operation ? [operation] : [];

  const isComparisonSupported = operations.includes("COMPARE") || metrics.includes("PERIOD_COMPARISON");
  if (!isComparisonSupported && COMPARISON_CLAIM_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "UNSUPPORTED_COMPARISON_CLAIM" };
  }

  const isForecastSupported = operations.includes("FORECAST") || metrics.includes("SPENDING_FORECAST_EXPLANATION");
  if (!isForecastSupported && FORECAST_CLAIM_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "UNSUPPORTED_FORECAST_CLAIM" };
  }
  if (isForecastSupported && CERTAINTY_LANGUAGE_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "UNSUPPORTED_CERTAINTY_LANGUAGE" };
  }

  const isAnomalyRelated = metrics.includes("ANOMALY_EXPLANATION");
  if (isAnomalyRelated && FRAUD_LANGUAGE_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "FRAUD_CLAIM" };
  }

  if (PERSISTENCE_LANGUAGE_PATTERN.test(answer) && !metrics.includes("SPENDING_FORECAST_EXPLANATION")) {
    // A single-period-comparison FactSet never supports persistence
    // language, mirroring SPENDING_CHANGE_EXPLANATION's existing rule.
    return { valid: false, reasonCode: "UNSUPPORTED_PERSISTENCE_CLAIM" };
  }

  if (DECLINE_LANGUAGE_PATTERN.test(answer) && metrics.includes("HEALTH_EXPLANATION")) {
    return { valid: false, reasonCode: "UNSUPPORTED_DECLINE_CLAIM" };
  }

  if (GENERIC_ADVICE_CLAIM_PATTERN.test(answer) || ADVICE_LANGUAGE_PATTERN.test(answer)) {
    return { valid: false, reasonCode: "OUT_OF_SCOPE_ADVICE" };
  }

  return { valid: true };
}

module.exports = {
  validateGroundedAnswer,
  validateCitedAnswer,
  // Additive exports -- reused by validateCitedAnswer above and available
  // to any future sibling validator so existing rules are never
  // duplicated.
  MONGO_ID_PATTERN,
  RAW_FIELD_TOKENS,
  JSON_KEY_FRAGMENT_PATTERN,
  PERSISTENCE_LANGUAGE_PATTERN,
  DECLINE_LANGUAGE_PATTERN,
  FRAUD_LANGUAGE_PATTERN,
  ADVICE_LANGUAGE_PATTERN,
  CERTAINTY_LANGUAGE_PATTERN,
  MAX_ANSWER_LENGTH,
  extractCurrencyAmounts: extractCurrencyAmountsFromAnswer,
};
