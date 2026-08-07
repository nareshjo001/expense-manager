// SIA response formatter.
//
// M2-1 scope: owns the two public HTTP response shapes for the
// HEALTH_EXPLANATION intent only, so Controllers/SiaControllers/ask.js
// doesn't duplicate response construction across its branches. Deliberately
// narrow -- one intent, two shapes, no speculative multi-provider or
// multi-intent formatting framework. Never calculates a financial value or
// inspects raw transaction data; it only arranges already-computed values
// (an LLM answer string, or a fixed no-data message) into the public
// contract.
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";

// The real Report source paths the HEALTH_EXPLANATION answer is grounded
// in, per backend/sia/contextBuilder.js's M1-2 production-contract
// correction. Deliberately NOT summary.healthScore / summary.riskLevel --
// those are confirmed-broken, always-undefined paths in the real report
// (see the M1-2 contract-gap verification).
const HEALTH_EXPLANATION_GROUNDING_PATHS = [
  "financialHealth",
  "financialHealth.overall",
  "financialHealth.risk.label",
];

// The fixed, truthful response for when buildContext had no usable data.
// No LLM was called, so there is no generated answer to include -- this
// message says exactly that, and nothing more.
function formatNoDataResponse() {
  return {
    success: true,
    answer:
      "I do not have enough financial report data yet to explain your financial health score.",
    intent: HEALTH_EXPLANATION,
    basedOn: [],
  };
}

// The successful response once a real (or, in this milestone, mocked) LLM
// answer exists.
function formatHealthExplanationResponse(answer) {
  return {
    success: true,
    answer,
    intent: HEALTH_EXPLANATION,
    basedOn: HEALTH_EXPLANATION_GROUNDING_PATHS,
  };
}

module.exports = {
  formatNoDataResponse,
  formatHealthExplanationResponse,
};
