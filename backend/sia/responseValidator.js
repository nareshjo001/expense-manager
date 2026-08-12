// Grounded-response validation -- Batch 2 architecture closure, extended to
// all seven supported intents in Batch 3D.
//
// System prompts alone do not enforce anything; a provider can still
// return unsupported figures, leaked identifiers, fraud language, false
// certainty, or out-of-scope advice despite being instructed not to. This
// module is the deterministic gate Controllers/SiaControllers/ask.js runs
// every answer through, for every SIA-supported intent, before it can
// reach the user -- a failed check is treated exactly like a
// failed/unusable provider result (the existing generic 503 branch), never
// partially shown.
//
// Deliberately NOT a "reject every digit" filter: harmless formatting or
// count language ("3 categories", "signal count: 2") is never flagged.
// Only currency-marked monetary figures (a number prefixed with a
// currency symbol) are checked against the numbers actually present in
// the structured context that grounded this answer -- everything else is
// left alone.
//
// This module validates defined, deterministic invariants only (leaked
// identifiers, raw internal field names, echoed JSON structure, and
// currency figures unsupported by the real context, plus a small number of
// intent-specific language checks below). It does not, and cannot,
// mathematically prove every natural-language claim in an answer.
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";
const BUDGET_STATUS_EXPLANATION = "BUDGET_STATUS_EXPLANATION";
const CATEGORY_SPENDING_EXPLANATION = "CATEGORY_SPENDING_EXPLANATION";
const ANOMALY_EXPLANATION = "ANOMALY_EXPLANATION";
const SPENDING_FORECAST_EXPLANATION = "SPENDING_FORECAST_EXPLANATION";
const FINANCIAL_RISK_EXPLANATION = "FINANCIAL_RISK_EXPLANATION";

// Batch 3D: all seven SIA-supported intents now receive the shared generic
// checks below -- leaked-Mongo-identifier detection, raw internal-field-
// token detection, echoed-JSON-structure detection, and the
// unsupported-currency-figure cross-check against the real narrowed
// context. Batch 2's three intent-specific checks (fraud-language for
// anomaly; certainty/probability language for risk and forecast; advice
// language for risk) remain scoped to exactly the same intents they always
// were -- Batch 3D deliberately does NOT add a causal-language rule for
// SPENDING_CHANGE_EXPLANATION/CATEGORY_SPENDING_EXPLANATION, or an advice-
// language rule for BUDGET_STATUS_EXPLANATION, or any rule for
// HEALTH_EXPLANATION beyond the shared generic checks. That is a
// deliberate, separately-evidenced decision (see the Batch 3D report), not
// an oversight: broad keyword matching risks rejecting valid explanations,
// and extending it needs its own evidence and design.
const VALIDATED_INTENTS = new Set([
  HEALTH_EXPLANATION,
  SPENDING_CHANGE_EXPLANATION,
  BUDGET_STATUS_EXPLANATION,
  CATEGORY_SPENDING_EXPLANATION,
  ANOMALY_EXPLANATION,
  SPENDING_FORECAST_EXPLANATION,
  FINANCIAL_RISK_EXPLANATION,
]);

// A 24-character lowercase hex string is the shape of a Mongo ObjectId --
// never a legitimate word in a natural-language financial explanation.
const MONGO_ID_PATTERN = /\b[a-f0-9]{24}\b/i;

// A small, explicit blocklist of internal-only field/variable names that
// have no reason to appear verbatim in a natural-language answer. Not
// exhaustive by design -- this catches a provider echoing internal
// structure back, not every conceivable word.
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

// A percentage explicitly framed as a chance/likelihood/certainty --
// risk's real contract never carries a calibrated probability at all, so
// this framing is always unsupported regardless of what number precedes
// it.
const PROBABILITY_LANGUAGE_PATTERN = /\b\d{1,3}(\.\d+)?\s?%\s*(chance|probability|likely|likelihood|certain|sure)\b/i;

const CERTAINTY_LANGUAGE_PATTERN =
  /\b(guarantee[sd]?|will definitely|100\s?%\s*(certain|sure|guaranteed)|certainly will|is certain to|without (a )?doubt)\b/i;

const FRAUD_LANGUAGE_PATTERN = /\b(fraud(ulent)?|theft|stolen|stole|scam(med)?|embezzle(ment)?)\b/i;

const ADVICE_LANGUAGE_PATTERN =
  /\b(invest in|take out a loan|refinance your|consult (a|your) (lawyer|attorney|tax advisor)|you should (buy|sell) (stocks?|shares?|bonds?)|tax deduction advice|legal advice)\b/i;

// Reason-code-name overstatement guardrails (semantic-accuracy
// remediation). These are deliberately NOT global word bans -- each is
// gated to exactly the intent (and, for FINANCIAL_RISK_EXPLANATION, the
// specific signal actually present in THIS turn's real context) whose
// evidence can never support the flagged language. "next month" stays
// completely untouched for SPENDING_FORECAST_EXPLANATION, where it is
// accurate (that intent's context is genuinely the next calendar month --
// see sia/contextBuilder.js's nextCalendarMonthForecast); it is only
// checked against FINANCIAL_RISK_EXPLANATION answers that were grounded on
// a FORECASTED_FINANCIAL_PRESSURE signal, whose evidence
// (analytics/analyzers/riskAnalyzer.js's evaluateForecastedPressure) is
// sourced from the LEGACY forecast.nextMonthForecast field --
// forecastAnalyzer.js's own documentation confirms that field projects the
// ANCHOR ordinal (the current, in-progress month), never next month.
const NEXT_MONTH_LANGUAGE_PATTERN = /\bnext\s+(calendar\s+)?month\b/i;

// PERSISTENT_SPENDING_GROWTH's evidence (riskAnalyzer.js's
// evaluatePersistentSpendingGrowth) and SPENDING_CHANGE_EXPLANATION's own
// context (trends.monthlyTrend) are both exactly one
// current-vs-previous-month comparison, never a multi-period series.
const PERSISTENCE_LANGUAGE_PATTERN = /\b(persistent(ly)?|sustained|long[- ]term|multi[- ]month|repeated(ly)?)\b/i;

// DETERIORATING_HEALTH's evidence (riskAnalyzer.js's
// evaluateDeterioratingHealth) and HEALTH_EXPLANATION's own context both
// carry only the CURRENT financial-health score, never a historical
// series.
const DECLINE_LANGUAGE_PATTERN = /\b(declin(?:e|es|ing|ed)|deteriorat(?:e|es|ing|ed)|falling|worsen(?:ing|ed|s)?)\b/i;

// A completed zero-signal risk result (hasData:true, signals:[]) means no
// active rule-based signal was detected from currently available data --
// never that the user has no financial risk. Narrowly scoped to explicit
// "no financial risk"/"not at risk" framing (with a negative lookahead for
// "signals"/"indicators") so the REQUIRED, accurate "no risk signals were
// found" wording the risk prompt itself uses is never flagged.
const NO_RISK_CLAIM_PATTERNS = [
  /\bno\s+financial\s+risk\b(?!\s*(?:signals?|indicators?))/i,
  /\byou\s+(?:are|have)\s+no\s+financial\s+risk\b/i,
  /\bnot\s+at\s+(?:any\s+)?financial\s+risk\b/i,
];

// True only when contextFields.risk.signals[] (the exact, bounded array
// sia/contextBuilder.js's copyRiskSignal supplied for this turn) contains a
// signal whose reasonCode matches -- never a guess, never derived from the
// answer text itself.
function hasRiskSignal(contextFields, reasonCode) {
  const signals = contextFields && contextFields.risk && Array.isArray(contextFields.risk.signals) ? contextFields.risk.signals : [];
  return signals.some((signal) => signal && signal.reasonCode === reasonCode);
}

// True only for a genuine completed zero-signal result -- contextFields.risk
// present with a real (possibly empty) signals array. A malformed/absent
// risk object is left alone here (ask.js's buildContext already routes a
// truly missing/invalid risk section to the separate no-data path before
// the provider is ever called, so this function only ever sees a real,
// hasData:true risk object at this layer).
function isZeroSignalRiskResult(contextFields) {
  const risk = contextFields && contextFields.risk;
  if (!risk || !Array.isArray(risk.signals)) return false;
  return risk.signals.length === 0;
}

const round2 = (value) => Math.round(value * 100) / 100;

// Recursively collects every finite numeric leaf value out of the
// structured context that grounded this answer, rounded to 2 decimals so
// a currency claim can be compared against it without floating-point
// false negatives. Deliberately numbers only -- a string leaf is never
// coerced here, no matter how numeric-looking, because this function has
// no notion of WHICH field it is looking at (a category literally named
// "500", a period label, a description) and treating every clean numeric
// string anywhere in the context as a supported currency figure would be
// exactly the kind of broad, field-blind rule this module's existing
// "reject every digit" caution (see the module header) warns against. See
// collectKnownStringAmounts() below for the one, narrowly-scoped
// exception this module actually needs.
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

// Batch 3D follow-up (verified against backend/analytics/analyzers/
// budgetAnalyzer.js): its `analyze()` output's `budget` and `spent`
// fields are passed through UNCHANGED from the stored Budget document --
// `budget: currentMonth.budget, spent: currentMonth.spent` -- with no
// toSafeNumber()/round2() coercion applied, unlike every other derived
// budget or category value (exceededBy, remainingBudget, budgetLeft,
// projectedSpent, projectedOverspend, utilization,
// projectedOverspendPercent, and every categoryAnalyzer.js field are all
// confirmed real `number`s). So `budget`/`spent` are the only two fields
// anywhere in the seven intents' real context shapes not type-guaranteed
// to be a JS `number` at this layer.
//
// contextBuilder.js and budgetAnalyzer.js are out of this batch's scope
// (see the Batch 3D report), so this is handled here instead -- but
// narrowly, by EXACT field path, not by a general "any numeric string
// anywhere" rule. BUDGET_STATUS_EXPLANATION's context shape (see
// contextBuilder.js) is always `{ budget: { budget, spent, ... } }`, so
// only `contextFields.budget.budget` and `contextFields.budget.spent`
// are ever read here. Every other field on that same object (category,
// status, projectionStatus, or any other string) is left completely
// alone -- a numeric-looking string in any of THOSE fields must never
// authorize a currency claim, only these two exact, verified,
// unnormalized monetary fields may.
const NUMERIC_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

function coerceKnownStringAmount(value, out) {
  if (typeof value === "string" && NUMERIC_STRING_PATTERN.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) out.add(round2(parsed));
  }
}

// Adds `contextFields.budget.budget` / `contextFields.budget.spent` to
// `out` when either is a string (a genuine JS number in that same
// position is already covered by collectNumericValues() above -- this
// function only ever ADDS the string case, it never duplicates or
// overrides the number case). Safe against a missing/malformed
// `contextFields.budget` (any non-BUDGET_STATUS_EXPLANATION context, or a
// context whose `budget` sub-object is absent) -- both are left as a
// no-op rather than throwing.
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

  // Reason-code-name overstatement guardrails. Each check below is gated
  // to the exact intent (and, for FINANCIAL_RISK_EXPLANATION, the exact
  // signal present in contextFields.risk.signals) whose evidence can never
  // support the flagged language -- see the pattern/helper definitions
  // above for the full source-cited rationale. None of these apply to
  // ANOMALY_EXPLANATION, BUDGET_STATUS_EXPLANATION,
  // CATEGORY_SPENDING_EXPLANATION, or SPENDING_FORECAST_EXPLANATION, whose
  // existing behavior (including SPENDING_FORECAST_EXPLANATION's accurate
  // use of "next month") is unchanged.
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

module.exports = {
  validateGroundedAnswer,
};
