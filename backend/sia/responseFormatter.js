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
// M2-3 scope: adds the BUDGET_STATUS_EXPLANATION shapes alongside them,
// using the exact intent identifier already established by
// backend/sia/contextBuilder.js's M2-3A implementation.
// M2-4B scope: adds the CATEGORY_SPENDING_EXPLANATION shapes alongside
// them, using the exact intent identifier already established by
// backend/sia/contextBuilder.js's M2-4A implementation.
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";
const BUDGET_STATUS_EXPLANATION = "BUDGET_STATUS_EXPLANATION";
const CATEGORY_SPENDING_EXPLANATION = "CATEGORY_SPENDING_EXPLANATION";
// Batch 2: additive only.
const ANOMALY_EXPLANATION = "ANOMALY_EXPLANATION";
const SPENDING_FORECAST_EXPLANATION = "SPENDING_FORECAST_EXPLANATION";
const FINANCIAL_RISK_EXPLANATION = "FINANCIAL_RISK_EXPLANATION";

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

// BUDGET_STATUS_EXPLANATION: contextBuilder.js's `fields` for this intent
// carry exactly one top-level key, `budget` -- but that key name is only
// this SIA context's own field label, not the real Report source path.
// The canonical Report branch it is populated from is `report.budgets`
// (analytics/reportGenerator.js's budgetAnalyzer.js output, plural,
// confirmed in backend/sia/contextBuilder.js's M2-3A implementation and
// backend/models/Report.js's schema) -- so "budgets" (plural) is the
// correct grounding path here, not the singular "budget".
// contextBuilder.js's own isPresent gates make all fourteen of
// report.budgets's leaf fields (budget, spent, hasBudget, status,
// isOverspent, exceededBy, utilization, remainingBudget, budgetLeft,
// projectionStatus, projectionReliable, projectedSpent, projectedOverspend,
// projectedOverspendPercent) co-guaranteed: a valid BUDGET_STATUS_EXPLANATION
// context always carries every one of them at once, or contextBuilder.js
// returns no-data instead -- there is no scenario where only some of them
// are present. Listing a curated subset of those fourteen leaf paths here
// would arbitrarily privilege some of them over the rest, when the LLM is
// given (and may ground its answer in) all fourteen -- so the single
// parent path is both the smallest and the only fully honest grounding set
// for this intent. This differs from HEALTH_EXPLANATION/
// SPENDING_CHANGE_EXPLANATION above, whose extra child paths document
// specific values separately promoted into a sibling `summary` object;
// BUDGET_STATUS_EXPLANATION's context has no such promoted siblings to
// separately cite.
const BUDGET_STATUS_EXPLANATION_GROUNDING_PATHS = ["budgets"];

// CATEGORY_SPENDING_EXPLANATION: contextBuilder.js's M2-4A `fields` for
// this intent carry exactly one top-level key, `categories` -- but, as with
// `budget` above, that key is only this SIA context's own field label. The
// canonical Report branch it is populated from is specifically
// `report.categories.monthly` (analytics/reportAssembler.js's
// `categories: { monthly, yearly }`, of which M2-4A deliberately selects
// the monthly branch alone). The bare parent `categories` would wrongly
// imply the yearly branch is also grounded here, so the precise
// monthly path is used instead. All six of the branch's selected fields
// (topCategory, leastCategory, categoryDistribution, concentrationIndex,
// top3Concentration, categoryGrowth) come from that one path and are
// co-guaranteed by contextBuilder.js's own validation gates -- a valid
// context always carries every one of them at once -- so a single accurate
// source path is both the smallest and the most honest grounding set.
const CATEGORY_SPENDING_EXPLANATION_GROUNDING_PATHS = ["categories.monthly"];

// Batch 2: contextBuilder.js's `fields` for each new intent carry exactly
// one top-level key named after the source Report branch it was populated
// from (`anomalies`, `forecast`, `risk`) -- unlike BUDGET_STATUS_EXPLANATION/
// CATEGORY_SPENDING_EXPLANATION above, the field label and the source path
// happen to already match, so no translation is needed here.
const ANOMALY_EXPLANATION_GROUNDING_PATHS = ["anomalies"];
const SPENDING_FORECAST_EXPLANATION_GROUNDING_PATHS = ["forecast"];
// FINANCIAL_RISK_EXPLANATION also carries two directly-referenced summary
// fields (see contextBuilder.js) -- both cited explicitly.
const FINANCIAL_RISK_EXPLANATION_GROUNDING_PATHS = [
  "risk",
  "summary.totalSpent",
  "summary.budgetStatus",
];

const GROUNDING_PATHS_BY_INTENT = {
  [HEALTH_EXPLANATION]: HEALTH_EXPLANATION_GROUNDING_PATHS,
  [SPENDING_CHANGE_EXPLANATION]: SPENDING_CHANGE_EXPLANATION_GROUNDING_PATHS,
  [BUDGET_STATUS_EXPLANATION]: BUDGET_STATUS_EXPLANATION_GROUNDING_PATHS,
  [CATEGORY_SPENDING_EXPLANATION]: CATEGORY_SPENDING_EXPLANATION_GROUNDING_PATHS,
  [ANOMALY_EXPLANATION]: ANOMALY_EXPLANATION_GROUNDING_PATHS,
  [SPENDING_FORECAST_EXPLANATION]: SPENDING_FORECAST_EXPLANATION_GROUNDING_PATHS,
  [FINANCIAL_RISK_EXPLANATION]: FINANCIAL_RISK_EXPLANATION_GROUNDING_PATHS,
};

// The fixed, truthful no-data answer per intent. No LLM was called, so
// there is no generated answer to include -- each message says exactly
// that, for the specific thing the user asked about, and nothing more.
// BUDGET_STATUS_EXPLANATION's message deliberately does not claim "no
// budget is configured" -- contextBuilder.js's no-data contract is shared
// by no report, invalid/incomplete budget data, AND hasBudget !== true
// alike, so only the generic "not enough report data" framing is accurate
// here.
const NO_DATA_ANSWERS_BY_INTENT = {
  [HEALTH_EXPLANATION]:
    "I do not have enough financial report data yet to explain your financial health score.",
  [SPENDING_CHANGE_EXPLANATION]:
    "I do not have enough financial report data yet to explain how your spending changed.",
  [BUDGET_STATUS_EXPLANATION]:
    "I do not have enough financial report data yet to explain your budget status.",
  // Deliberately names the monthly category data specifically -- M2-4A's
  // no-data contract is reached by no report, a missing/invalid
  // categories.monthly branch, hasData !== true, or a malformed nested
  // record alike, so this message claims nothing more precise than "not
  // enough monthly category spending data".
  [CATEGORY_SPENDING_EXPLANATION]:
    "I don't have enough monthly category spending data to explain your category spending yet.",
  [ANOMALY_EXPLANATION]:
    "I do not have enough financial report data yet to explain unusual spending.",
  [SPENDING_FORECAST_EXPLANATION]:
    "I do not have enough financial report data yet to provide a spending forecast.",
  [FINANCIAL_RISK_EXPLANATION]:
    "I do not have enough financial report data yet to explain your financial risk.",
};

// M3-4: per the blueprint's exact M3-4 contract addition ("Extends basedOn
// to explicitly list "none" when contextBuilder returned no data, rather
// than omitting the field"), the no-data basedOn value is the single-element
// array ["none"] -- basedOn's established type (an array of grounding-path
// strings, see GROUNDING_PATHS_BY_INTENT above) is preserved; "none" is a
// literal sentinel string, not a real Report field path.
const NO_DATA_BASED_ON = Object.freeze(["none"]);

function formatNoDataResponse(intent) {
  return {
    success: true,
    answer: NO_DATA_ANSWERS_BY_INTENT[intent],
    intent,
    basedOn: NO_DATA_BASED_ON,
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
