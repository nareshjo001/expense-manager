// SIA response formatter -- owns the public HTTP response shapes for each explanation intent (HEALTH_EXPLANATION, then SPENDING_CHANGE_EXPLANATION, BUDGET_STATUS_EXPLANATION, CATEGORY_SPENDING_EXPLANATION added across M2-1 through M2-4B), so Controllers/SiaControllers/ask.js doesn't duplicate response construction across its branches. Deliberately narrow -- a small intent-keyed lookup, not a generic multi-provider/multi-intent framework. Never calculates a financial value or inspects raw transaction data; only arranges already-computed values (an LLM answer string, or a fixed no-data message) into the public contract, and never includes the structured context object itself.
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";
const BUDGET_STATUS_EXPLANATION = "BUDGET_STATUS_EXPLANATION";
const CATEGORY_SPENDING_EXPLANATION = "CATEGORY_SPENDING_EXPLANATION";
// Batch 2: additive only.
const ANOMALY_EXPLANATION = "ANOMALY_EXPLANATION";
const SPENDING_FORECAST_EXPLANATION = "SPENDING_FORECAST_EXPLANATION";
const FINANCIAL_RISK_EXPLANATION = "FINANCIAL_RISK_EXPLANATION";

// The real Report/context source paths each answer is grounded in -- fixed, server-owned, allowlisted, never accepted from the client or LLM. Each path is only included because contextBuilder.js actually places that exact field in the intent's `fields` object; no stale blueprint field (e.g. summary.healthScore, summary.riskLevel, or a per-category breakdown SPENDING_CHANGE_EXPLANATION never carries) is referenced.
// HEALTH_EXPLANATION deliberately excludes summary.healthScore/summary.riskLevel, which are confirmed-broken, always-undefined paths in the real report.
const HEALTH_EXPLANATION_GROUNDING_PATHS = [
  "financialHealth",
  "financialHealth.overall",
  "financialHealth.risk.label",
];

// SPENDING_CHANGE_EXPLANATION: contextBuilder.js's `fields` carry exactly `trends` (trendAnalyzer.js output, whose `monthlyTrend` is the real month-over-month detail) and `summary.comparePastMonth`/`summary.totalSpent` (copied verbatim from that same data) -- these four paths are the only real, populated sources; there's no category-contribution field to ground on.
const SPENDING_CHANGE_EXPLANATION_GROUNDING_PATHS = [
  "trends",
  "trends.monthlyTrend",
  "summary.comparePastMonth",
  "summary.totalSpent",
];

// BUDGET_STATUS_EXPLANATION: contextBuilder.js's `fields` carry one top-level key, `budget`, but that's only the SIA context's own field label -- the canonical Report branch is `report.budgets` (budgetAnalyzer.js output, plural, per contextBuilder.js's M2-3A implementation and models/Report.js's schema), so "budgets" (plural) is the correct grounding path, not singular "budget". contextBuilder.js's isPresent gates co-guarantee all fourteen of report.budgets's leaf fields (budget, spent, hasBudget, status, isOverspent, exceededBy, utilization, remainingBudget, budgetLeft, projectionStatus, projectionReliable, projectedSpent, projectedOverspend, projectedOverspendPercent) at once, or return no-data instead -- listing a curated subset would arbitrarily privilege some over the rest when the LLM may ground on all fourteen, so the single parent path is the smallest and only fully honest grounding set (unlike HEALTH_EXPLANATION/SPENDING_CHANGE_EXPLANATION above, whose child paths document values separately promoted into a sibling `summary` object -- this intent has no such promoted siblings).
const BUDGET_STATUS_EXPLANATION_GROUNDING_PATHS = ["budgets"];

// CATEGORY_SPENDING_EXPLANATION: contextBuilder.js's M2-4A `fields` carry one top-level key, `categories`, again only this context's own field label -- the canonical branch is specifically `report.categories.monthly` (reportAssembler.js's `categories: { monthly, yearly }`, of which M2-4A selects monthly alone); the bare parent `categories` would wrongly imply yearly is also grounded here. All six selected fields (topCategory, leastCategory, categoryDistribution, concentrationIndex, top3Concentration, categoryGrowth) come from that one path and are co-guaranteed by contextBuilder.js's validation gates, so a single accurate source path is the smallest and most honest grounding set.
const CATEGORY_SPENDING_EXPLANATION_GROUNDING_PATHS = ["categories.monthly"];

// Batch 2: contextBuilder.js's `fields` for each new intent carry one top-level key named after the source Report branch (`anomalies`, `forecast`, `risk`) -- unlike BUDGET_STATUS_EXPLANATION/CATEGORY_SPENDING_EXPLANATION, the field label and source path already match, so no translation is needed.
const ANOMALY_EXPLANATION_GROUNDING_PATHS = ["anomalies"];
const SPENDING_FORECAST_EXPLANATION_GROUNDING_PATHS = ["forecast"];
// FINANCIAL_RISK_EXPLANATION also carries two directly-referenced summary fields (see contextBuilder.js) -- both cited explicitly.
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

// The fixed, truthful no-data answer per intent -- no LLM was called, so each message says exactly that, for the specific thing asked about, nothing more. BUDGET_STATUS_EXPLANATION's message deliberately does not claim "no budget is configured" -- contextBuilder.js's no-data contract is shared by no report, invalid/incomplete budget data, AND hasBudget !== true alike, so only the generic "not enough report data" framing is accurate.
const NO_DATA_ANSWERS_BY_INTENT = {
  [HEALTH_EXPLANATION]:
    "I do not have enough financial report data yet to explain your financial health score.",
  [SPENDING_CHANGE_EXPLANATION]:
    "I do not have enough financial report data yet to explain how your spending changed.",
  [BUDGET_STATUS_EXPLANATION]:
    "I do not have enough financial report data yet to explain your budget status.",
  // Deliberately names the monthly category data specifically -- M2-4A's no-data contract is reached by no report, a missing/invalid categories.monthly branch, hasData !== true, or a malformed nested record alike, so this claims nothing more precise than "not enough monthly category spending data".
  [CATEGORY_SPENDING_EXPLANATION]:
    "I don't have enough monthly category spending data to explain your category spending yet.",
  [ANOMALY_EXPLANATION]:
    "I do not have enough financial report data yet to explain unusual spending.",
  [SPENDING_FORECAST_EXPLANATION]:
    "I do not have enough financial report data yet to provide a spending forecast.",
  [FINANCIAL_RISK_EXPLANATION]:
    "I do not have enough financial report data yet to explain your financial risk.",
};

// M3-4: basedOn explicitly lists "none" when contextBuilder returned no data, rather than omitting the field -- the no-data value is the single-element array ["none"], preserving basedOn's established type (an array of grounding-path strings); "none" is a literal sentinel, not a real Report field path.
const NO_DATA_BASED_ON = Object.freeze(["none"]);

function formatNoDataResponse(intent) {
  return {
    success: true,
    answer: NO_DATA_ANSWERS_BY_INTENT[intent],
    intent,
    basedOn: NO_DATA_BASED_ON,
  };
}

// The successful response once a real (or, in this milestone, mocked) LLM answer exists, for any supported intent. `grounding` is an additive, user-facing provenance snapshot (groundingService.js's buildGroundingSnapshot()), completely separate from `basedOn` above -- optional, so a caller that omits it gets a response with no `grounding` key at all.
function formatExplanationResponse(intent, answer, grounding) {
  const response = {
    success: true,
    answer,
    intent,
    basedOn: GROUNDING_PATHS_BY_INTENT[intent],
  };
  if (grounding !== undefined) {
    response.grounding = grounding;
  }
  return response;
}

module.exports = {
  formatNoDataResponse,
  formatExplanationResponse,
};
