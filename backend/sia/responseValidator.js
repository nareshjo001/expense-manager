// Grounded-response validation: since system prompts alone don't enforce anything, this is the deterministic gate ask.js runs every answer through for all seven supported intents before it reaches the user -- a failed check is treated exactly like a failed provider result (503), never partially shown. Only currency-marked monetary figures are cross-checked against the real context (harmless count language like "3 categories" is never flagged); it validates defined invariants only, not every natural-language claim.
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";
const BUDGET_STATUS_EXPLANATION = "BUDGET_STATUS_EXPLANATION";
const CATEGORY_SPENDING_EXPLANATION = "CATEGORY_SPENDING_EXPLANATION";
const ANOMALY_EXPLANATION = "ANOMALY_EXPLANATION";
const SPENDING_FORECAST_EXPLANATION = "SPENDING_FORECAST_EXPLANATION";
const FINANCIAL_RISK_EXPLANATION = "FINANCIAL_RISK_EXPLANATION";

// All seven SIA-supported intents receive the shared generic checks (leaked identifiers, raw field tokens, echoed JSON, unsupported currency figures); the three intent-specific checks below (fraud/certainty/advice language) stay scoped to only the intents they've always applied to -- deliberately not extended further, since broad keyword matching risks rejecting valid explanations.
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

// budgetAnalyzer.js's `budget`/`spent` fields pass through unchanged from the stored Budget document with no numeric coercion, unlike every other derived value -- so they're the only two fields in the seven intents' context shapes not type-guaranteed to be a JS number. Handled here by exact field path only (never a general "any numeric string" rule), since contextBuilder.js/budgetAnalyzer.js are out of scope for this fix.
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
