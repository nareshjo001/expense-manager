// Starter questions shown when a conversation is empty.
//
// Every question below is worded to satisfy the CURRENT patterns in
// backend/sia/intentClassifier.js for exactly one supported intent -- the
// classifier is regex-based and returns 422 for anything it does not
// recognize, so a suggestion that failed to classify would hand the user a
// guaranteed error. The `intent` field records which intent each question
// is written for; it is metadata for maintenance and tests only and is
// never rendered.
//
// Classifier constraints these were written against (see that file):
//  - HEALTH_EXPLANATION needs "financial health"/"financial risk" AND an
//    explanation verb (why/explain/...).
//  - CATEGORY_SPENDING_EXPLANATION is checked BEFORE spending-change and
//    must avoid the advice/prediction/lookup/cross-domain vetoes (no
//    "should", "budget", "financial health", "show/list").
//  - ANOMALY_EXPLANATION needs an anomaly word (unusual/flagged/...).
//  - SPENDING_CHANGE_EXPLANATION needs a spending word AND a change verb,
//    while naming no category.
//  - BUDGET_STATUS_EXPLANATION needs "budget" AND a status verb, and must
//    not read as a mutation ("increase my budget") or advice.
//  - SPENDING_FORECAST_EXPLANATION needs a forecast keyword, or spending
//    plus a future horizon; it is checked after budget, so it must not
//    mention "budget".
//  - FINANCIAL_RISK_EXPLANATION is checked last and must not use the
//    "financial risk" + explanation-verb wording that HEALTH_EXPLANATION
//    already owns, nor mention a budget.
export const SIA_SUGGESTIONS = [
  {
    id: "health",
    intent: "HEALTH_EXPLANATION",
    text: "Why is my financial health score what it is?",
  },
  {
    id: "spending-change",
    intent: "SPENDING_CHANGE_EXPLANATION",
    text: "Why did my overall spending change this month?",
  },
  {
    id: "budget-status",
    intent: "BUDGET_STATUS_EXPLANATION",
    text: "Explain my current budget status and utilization.",
  },
  {
    id: "category-spending",
    intent: "CATEGORY_SPENDING_EXPLANATION",
    text: "Which category accounts for the most of my spending?",
  },
  {
    id: "anomaly",
    intent: "ANOMALY_EXPLANATION",
    text: "Why were some of my expenses flagged as unusual?",
  },
  {
    id: "forecast",
    intent: "SPENDING_FORECAST_EXPLANATION",
    text: "What is my spending forecast for next month?",
  },
  {
    id: "risk",
    intent: "FINANCIAL_RISK_EXPLANATION",
    text: "Do I have any risks I should know about right now?",
  },
];

export default SIA_SUGGESTIONS;
