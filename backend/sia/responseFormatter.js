// SIA response formatter.
//
// M2-1 scope: owns the public HTTP response shapes for the
// HEALTH_EXPLANATION intent, so Controllers/SiaControllers/ask.js doesn't
// duplicate response construction across its branches.
// M2-2 scope: adds the SPENDING_CHANGE_EXPLANATION shapes alongside it,
// using the exact intent identifier already established by
// backend/sia/contextBuilder.js's M1-2 implementation. Still deliberately
// narrow -- two intents, two shapes each, no speculative multi-provider or
// generic multi-intent formatting framework (a small intent-keyed lookup is
// not a framework). Never calculates a financial value or inspects raw
// transaction data; it only arranges already-computed values (an LLM answer
// string, or a fixed no-data message) into the public contract, and never
// includes the structured context object itself.
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";

// The real Report/context source paths each answer is grounded in. Fixed,
// server-owned, and allowlisted -- never accepted from the client or the
// LLM. Each path is only included because backend/sia/contextBuilder.js
// actually places that exact field in the intent's `fields` object; no
// stale blueprint field (e.g. summary.healthScore, summary.riskLevel, or
// any per-category breakdown -- contextBuilder.js's
// SPENDING_CHANGE_EXPLANATION fields carry no category-level data at all)
// is referenced.
//
// HEALTH_EXPLANATION: per the M1-2 production-contract correction --
// deliberately NOT summary.healthScore / summary.riskLevel, which are
// confirmed-broken, always-undefined paths in the real report (see the
// M1-2 contract-gap verification).
const HEALTH_EXPLANATION_GROUNDING_PATHS = [
  "financialHealth",
  "financialHealth.overall",
  "financialHealth.risk.label",
];

// SPENDING_CHANGE_EXPLANATION: contextBuilder.js's `fields` for this intent
// carry exactly `trends` (the full trendAnalyzer.js output, whose
// `monthlyTrend` sub-object is the real month-over-month comparison detail)
// and `summary.comparePastMonth` / `summary.totalSpent` (both copied
// verbatim from that same trend/spending data in
// analytics/reportGenerator.js). These four paths are the only real,
// populated sources available -- there is no category-contribution field
// in this context to ground on.
const SPENDING_CHANGE_EXPLANATION_GROUNDING_PATHS = [
  "trends",
  "trends.monthlyTrend",
  "summary.comparePastMonth",
  "summary.totalSpent",
];

const GROUNDING_PATHS_BY_INTENT = {
  [HEALTH_EXPLANATION]: HEALTH_EXPLANATION_GROUNDING_PATHS,
  [SPENDING_CHANGE_EXPLANATION]: SPENDING_CHANGE_EXPLANATION_GROUNDING_PATHS,
};

// The fixed, truthful no-data answer per intent. No LLM was called, so
// there is no generated answer to include -- each message says exactly
// that, for the specific thing the user asked about, and nothing more.
const NO_DATA_ANSWERS_BY_INTENT = {
  [HEALTH_EXPLANATION]:
    "I do not have enough financial report data yet to explain your financial health score.",
  [SPENDING_CHANGE_EXPLANATION]:
    "I do not have enough financial report data yet to explain how your spending changed.",
};

function formatNoDataResponse(intent) {
  return {
    success: true,
    answer: NO_DATA_ANSWERS_BY_INTENT[intent],
    intent,
    basedOn: [],
  };
}

// The successful response once a real (or, in this milestone, mocked) LLM
// answer exists, for either supported intent.
function formatExplanationResponse(intent, answer) {
  return {
    success: true,
    answer,
    intent,
    basedOn: GROUNDING_PATHS_BY_INTENT[intent],
  };
}

module.exports = {
  formatNoDataResponse,
  formatExplanationResponse,
};
