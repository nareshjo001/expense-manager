// SIA intent classifier.
//
// M2-1 scope: recognizes clear requests to explain the financial-health
// score/result or the financial risk level.
// M2-2 scope: additionally recognizes clear requests to explain a spending
// change -- using the exact intent identifier already established by
// backend/sia/contextBuilder.js's M1-2 implementation
// ("SPENDING_CHANGE_EXPLANATION"), not a new or renamed identifier.
// No LLM is used for classification, no general NLP framework, no
// classifier registry -- just small, explicit sets of phrase checks, one
// per intent.
//
// False negatives (returning null for a real question phrased unusually)
// are preferable to false positives (recognizing a question that isn't
// really asking for one of the two supported explanations).
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";

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

  return null;
}

module.exports = {
  classifyIntent,
};
