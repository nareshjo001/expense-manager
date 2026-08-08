// Grounded-response validation -- Batch 2 architecture closure.
//
// System prompts alone do not enforce anything; a provider can still
// return unsupported figures, leaked identifiers, fraud language, false
// certainty, or out-of-scope advice despite being instructed not to. This
// module is the deterministic gate Controllers/SiaControllers/ask.js runs
// every ANOMALY_EXPLANATION / SPENDING_FORECAST_EXPLANATION /
// FINANCIAL_RISK_EXPLANATION answer through before it can reach the user --
// a failed check is treated exactly like a failed/unusable provider
// result (the existing generic 503 branch), never partially shown.
//
// Deliberately NOT a "reject every digit" filter: harmless formatting or
// count language ("3 categories", "signal count: 2") is never flagged.
// Only currency-marked monetary figures (a number prefixed with a
// currency symbol) are checked against the numbers actually present in
// the structured context that grounded this answer -- everything else is
// left alone.
"use strict";

const ANOMALY_EXPLANATION = "ANOMALY_EXPLANATION";
const SPENDING_FORECAST_EXPLANATION = "SPENDING_FORECAST_EXPLANATION";
const FINANCIAL_RISK_EXPLANATION = "FINANCIAL_RISK_EXPLANATION";

// Only these three intents are grounded-response-validated. The four
// original intents (HEALTH_EXPLANATION, SPENDING_CHANGE_EXPLANATION,
// BUDGET_STATUS_EXPLANATION, CATEGORY_SPENDING_EXPLANATION) are
// deliberately untouched by this module -- validateGroundedAnswer()
// always returns `{ valid: true }` for them, so their pre-existing
// behavior (proven by tests/sia.ask.test.js's 80 tests) is unaffected.
const VALIDATED_INTENTS = new Set([
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

const round2 = (value) => Math.round(value * 100) / 100;

// Recursively collects every finite numeric leaf value out of the
// structured context that grounded this answer, rounded to 2 decimals so
// a currency claim can be compared against it without floating-point
// false negatives.
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

  const contextNumbers = collectNumericValues(contextFields, new Set());
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
