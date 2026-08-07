// SIA intent classifier.
//
// M2-1 scope: recognizes clear requests to explain the financial-health
// score/result or the financial risk level.
// M2-2 scope: additionally recognizes clear requests to explain a spending
// change -- using the exact intent identifier already established by
// backend/sia/contextBuilder.js's M1-2 implementation
// ("SPENDING_CHANGE_EXPLANATION"), not a new or renamed identifier.
// M2-3 scope: additionally recognizes clear requests to explain the
// current budget status -- using the exact intent identifier already
// established by backend/sia/contextBuilder.js's M2-3A implementation
// ("BUDGET_STATUS_EXPLANATION").
// No LLM is used for classification, no general NLP framework, no
// classifier registry -- just small, explicit sets of phrase checks, one
// per intent.
//
// False negatives (returning null for a real question phrased unusually)
// are preferable to false positives (recognizing a question that isn't
// really asking for one of the supported explanations).
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";
const BUDGET_STATUS_EXPLANATION = "BUDGET_STATUS_EXPLANATION";

// The question must ask for an explanation/meaning/reason (not just
// mention the topic in passing) AND mention "financial health" or
// "financial risk" specifically -- not bare "health" (which would also
// match unrelated medical-health questions) or bare "risk".
const EXPLANATION_VERB_PATTERN = /\b(why|explain|what does .* mean|meaning of|reason for)\b/;
const HEALTH_TOPIC_PATTERN = /\bfinancial (health|risk)\b/;

// The question must mention spending/expenses specifically (not "budget",
// "afford", or "transaction", which are different, unsupported concepts)
// AND ask about a change, explanation, increase/decrease, contribution, or
// comparison -- not merely a lookup ("how much did I spend", "show my
// expenses") or a forward-looking request ("predict my spending"), neither
// of which this pattern matches.
const SPENDING_TOPIC_PATTERN = /\b(spending|spend|expense|expenses)\b/;
const SPENDING_CHANGE_VERB_PATTERN =
  /\b(why|explain|increase|increased|decrease|decreased|higher|lower|more|less|changed|change|contribute|contributed|compare|compared|comparison)\b/;

// The question must explicitly mention "budget" (not "afford", "invest",
// "money", or "expenses" alone -- those are different, unsupported
// concepts, and this deliberately does not match "budget" as a substring
// of an unrelated word) AND ask about status, utilization, remaining
// amount, over/under, risk, projection, reliability, or an explicit
// explanation -- not a definition ("what is a budget"), a mutation
// ("create/set/increase/delete my budget"), or advice ("what should my
// budget be"), none of which this verb pattern matches. Every concept
// here maps to a field backend/sia/contextBuilder.js's
// BUDGET_STATUS_EXPLANATION context actually guarantees (status,
// utilization, remainingBudget/budgetLeft, isOverspent/exceededBy,
// projectionStatus, projectionReliable) -- classification is never
// broader than what the context can actually support.
const BUDGET_TOPIC_PATTERN = /\bbudget\b/;
const BUDGET_STATUS_VERB_PATTERN =
  /\b(why|explain|status|utilization|utilized|used|remaining|remain|left|over|under|exceed|exceeding|exceeded|overspent|overspend|risk|projected|projection|reliable|reliability)\b/;

// The topic+verb gate above is intentionally loose (it must accept
// "why"/"explain"/"remaining" in many phrasings), which means it also
// accepts mutation requests ("Explain how to increase my budget.") and
// advice requests ("Should I spend my remaining budget?") that merely
// happen to reuse those same words. This exclusion vetoes exactly those
// two shapes without rejecting legitimate report explanations.
//
// Mutation-action verbs change the CONFIGURED budget value itself (e.g.
// "increase my budget" asks to raise the budget number) -- never merely
// describe an already-reported status/utilization value.
const BUDGET_MUTATION_VERBS = "set|create|update|edit|increase|decrease|raise|lower|delete|remove|modify|change";
// Advice-action verbs ask what the user should personally DO with money
// (spend it, invest it), not what the report already shows.
const BUDGET_ADVICE_VERBS = "spend|invest";
// Both only veto a match when the verb governs "budget" as its direct
// object -- i.e. the verb appears shortly BEFORE "budget" ("increase my
// budget", "spend my remaining budget", within a few words). A verb
// appearing AFTER "budget" describes something the report already
// computed ("budget status change", "budget utilization increased",
// "exceed my budget" -- "exceed" is deliberately in neither verb list
// above, since it names a report-computed state, not a user action to
// take) and must never be excluded by this pattern.
const BUDGET_ACTION_EXCLUSION_PATTERN = new RegExp(
  `\\b(?:${BUDGET_MUTATION_VERBS}|${BUDGET_ADVICE_VERBS})\\b(?:\\s+\\S+){0,4}\\s+budget\\b`
);

function classifyIntent(question) {
  if (typeof question !== "string") {
    return null;
  }

  const normalized = question.trim().toLowerCase();
  if (normalized === "") {
    return null;
  }

  // Health is checked first and unconditionally: any input that already
  // matched under M2-1 must keep matching HEALTH_EXPLANATION here, never
  // be reclassified as a spending question.
  if (HEALTH_TOPIC_PATTERN.test(normalized) && EXPLANATION_VERB_PATTERN.test(normalized)) {
    return HEALTH_EXPLANATION;
  }

  if (SPENDING_TOPIC_PATTERN.test(normalized) && SPENDING_CHANGE_VERB_PATTERN.test(normalized)) {
    return SPENDING_CHANGE_EXPLANATION;
  }

  if (
    BUDGET_TOPIC_PATTERN.test(normalized) &&
    BUDGET_STATUS_VERB_PATTERN.test(normalized) &&
    !BUDGET_ACTION_EXCLUSION_PATTERN.test(normalized)
  ) {
    return BUDGET_STATUS_EXPLANATION;
  }

  return null;
}

module.exports = {
  classifyIntent,
};
