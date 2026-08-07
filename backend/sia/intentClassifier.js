// SIA intent classifier.
//
// M2-1 scope: recognizes only clear requests to explain the financial-
// health score/result or the financial risk level. No LLM is used for
// classification, no general NLP framework, no classifier registry -- just
// a small, explicit set of phrase checks. Spending-change questions are
// deliberately NOT recognized yet, even though backend/sia/contextBuilder.js
// already supports that intent structurally -- intent classification for it
// belongs to a later milestone.
//
// False negatives (returning null for a real health question phrased
// unusually) are preferable to false positives (recognizing a question
// that isn't really asking for a financial-health/risk explanation).
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";

// The question must ask for an explanation/meaning/reason (not just
// mention the topic in passing) AND mention "financial health" or
// "financial risk" specifically -- not bare "health" (which would also
// match unrelated medical-health questions) or bare "risk".
const EXPLANATION_VERB_PATTERN = /\b(why|explain|what does .* mean|meaning of|reason for)\b/;
const HEALTH_TOPIC_PATTERN = /\bfinancial (health|risk)\b/;

function classifyIntent(question) {
  if (typeof question !== "string") {
    return null;
  }

  const normalized = question.trim().toLowerCase();
  if (normalized === "") {
    return null;
  }

  if (HEALTH_TOPIC_PATTERN.test(normalized) && EXPLANATION_VERB_PATTERN.test(normalized)) {
    return HEALTH_EXPLANATION;
  }

  return null;
}

module.exports = {
  classifyIntent,
};
