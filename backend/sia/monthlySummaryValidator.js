"use strict";

// Validates every numeric claim an LLM-authored monthly summary (AI-001-T03's generateLlmMonthlySummary()) makes, before it is ever shown to a user.

const { getFact } = require("../analytics/monthlySummaryFacts");
const {
  MONGO_ID_PATTERN,
  RAW_FIELD_TOKENS,
  JSON_KEY_FRAGMENT_PATTERN,
  FRAUD_LANGUAGE_PATTERN,
  ADVICE_LANGUAGE_PATTERN,
  CERTAINTY_LANGUAGE_PATTERN,
  MAX_ANSWER_LENGTH,
  extractCurrencyAmounts,
} = require("./responseValidator");

const round2 = (value) => Math.round(value * 100) / 100;

// Js's own currency-only extractor).
const PERCENT_CLAIM_PATTERN = /(-?\d+(?:\.\d{1,2})?)\s?%/g;

function extractPercentClaims(text) {
  const claims = [];
  const pattern = new RegExp(PERCENT_CLAIM_PATTERN.source, PERCENT_CLAIM_PATTERN.flags);
  let match = pattern.exec(text);
  while (match !== null) {
    const num = Number(match[1]);
    if (Number.isFinite(num)) claims.push(round2(num));
    match = pattern.exec(text);
  }
  return claims;
}

// Validates an LLM-authored { narrative, citedFactIds } monthly-summary answer against the report it claims to be grounded in.
function validateMonthlySummaryAnswer({ narrative, citedFactIds, report }) {
  if (typeof narrative !== "string" || narrative.trim() === "") {
    return { valid: false, reasonCode: "EMPTY_OR_MALFORMED_ANSWER" };
  }
  if (narrative.length > MAX_ANSWER_LENGTH) {
    return { valid: false, reasonCode: "ANSWER_TOO_LONG" };
  }
  if (MONGO_ID_PATTERN.test(narrative)) {
    return { valid: false, reasonCode: "LEAKED_IDENTIFIER" };
  }
  for (const token of RAW_FIELD_TOKENS) {
    if (narrative.includes(token)) {
      return { valid: false, reasonCode: "RAW_FIELD_LEAKAGE" };
    }
  }
  if (JSON_KEY_FRAGMENT_PATTERN.test(narrative)) {
    return { valid: false, reasonCode: "RAW_FIELD_LEAKAGE" };
  }
  if (FRAUD_LANGUAGE_PATTERN.test(narrative)) {
    return { valid: false, reasonCode: "FRAUD_CLAIM" };
  }
  if (ADVICE_LANGUAGE_PATTERN.test(narrative)) {
    return { valid: false, reasonCode: "OUT_OF_SCOPE_ADVICE" };
  }
  if (CERTAINTY_LANGUAGE_PATTERN.test(narrative)) {
    return { valid: false, reasonCode: "UNSUPPORTED_CERTAINTY_LANGUAGE" };
  }

  // Every cited fact ID must be a REAL, currently-eligible fact against THIS report -- getFact() returns null for anything unknown, ineligible, or unresolvable, so this can never be satisfied by a fabricated ID or one that was eligible on some other report.
  const citedIds = Array.isArray(citedFactIds) ? citedFactIds : [];
  const resolvedFacts = [];
  for (const factId of citedIds) {
    if (typeof factId !== "string") {
      return { valid: false, reasonCode: "UNKNOWN_CITED_FACT" };
    }
    const fact = getFact(report, factId);
    if (!fact) {
      return { valid: false, reasonCode: "UNKNOWN_CITED_FACT" };
    }
    resolvedFacts.push(fact);
  }

  // Every currency-marked figure in the narrative must equal a cited fact's value (unit "currency") -- an LLM cannot pass validation by citing unrelated facts while still writing an invented number.
  const citedCurrencyValues = new Set(
    resolvedFacts.filter((f) => f.unit === "currency" && typeof f.value === "number").map((f) => round2(f.value))
  );
  const claimedAmounts = extractCurrencyAmounts(narrative).map(round2);
  for (const amount of claimedAmounts) {
    if (!citedCurrencyValues.has(amount)) {
      return { valid: false, reasonCode: "UNSUPPORTED_MONETARY_FIGURE" };
    }
  }

  // Same cross-check for percentage claims against unit "percent" facts.
  const citedPercentValues = new Set(
    resolvedFacts.filter((f) => f.unit === "percent" && typeof f.value === "number").map((f) => round2(f.value))
  );
  const claimedPercents = extractPercentClaims(narrative);
  for (const pct of claimedPercents) {
    if (!citedPercentValues.has(pct)) {
      return { valid: false, reasonCode: "UNSUPPORTED_PERCENTAGE_CLAIM" };
    }
  }

  return { valid: true };
}

module.exports = {
  validateMonthlySummaryAnswer,
};
