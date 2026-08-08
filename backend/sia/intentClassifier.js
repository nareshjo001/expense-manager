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
// M2-4B scope: additionally recognizes clear requests to explain
// category-level spending -- using the exact intent identifier already
// established by backend/sia/contextBuilder.js's M2-4A implementation
// ("CATEGORY_SPENDING_EXPLANATION").
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
const CATEGORY_SPENDING_EXPLANATION = "CATEGORY_SPENDING_EXPLANATION";
// Batch 2: three new report-backed intents, added strictly ADDITIVELY --
// every existing identifier/alias above, and every existing branch below,
// is unchanged. Each new check is positioned so it can never steal a query
// the four intents above already claim (see the placement notes at each
// check site).
const ANOMALY_EXPLANATION = "ANOMALY_EXPLANATION";
const SPENDING_FORECAST_EXPLANATION = "SPENDING_FORECAST_EXPLANATION";
const FINANCIAL_RISK_EXPLANATION = "FINANCIAL_RISK_EXPLANATION";

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

// -- M2-4B: CATEGORY_SPENDING_EXPLANATION ------------------------------------
//
// Every concept below maps to a field backend/sia/contextBuilder.js's
// M2-4A CATEGORY_SPENDING_EXPLANATION context actually guarantees
// (topCategory/leastCategory, categoryDistribution's amount+percentage,
// concentrationIndex, top3Concentration, and categoryGrowth's
// previous/current/change/growthPercentage/isNewCategory/trend) --
// classification is never broader than what the context can support.
//
// Two distinct ways a question can be category-focused:
//
// (1) It says "category"/"categories" explicitly ("Which category am I
//     spending the most on?", "What is my biggest category?").
const CATEGORY_WORD_PATTERN = /\bcategor(?:y|ies)\b/;
// (2) It names a specific spending area possessively/attributively rather
//     than asking about spending overall -- "my grocery spending", "my
//     dining expenses", "Rent account for". Deliberately NOT a hard-coded
//     list of BALENISA category names (categories are user-defined and
//     variable): this matches the grammatical SHAPE of a modifier word
//     sitting directly before spending/expenses, or a capitalized-in-the-
//     original noun preceding "account(s) for". The overall/time-based
//     modifier words below are excluded so "my monthly spending" and "my
//     total expenses" never look category-named.
// Includes pronouns and auxiliaries ("did I spend", "we spend") so a
// possessive-looking verb phrase is never mistaken for a category name --
// "Why did I spend more this month?" must stay a spending-change question.
// Also includes the twelve full month names, so a time-scoped question
// ("Why is my January spending high?") is never treated as naming a
// category -- the category context has no time dimension to answer it
// with. Month ABBREVIATIONS are deliberately not listed: "may"/"march"
// are already covered as full names, and abbreviations like "jan"/"mar"
// are plausible user-defined category names. Likewise weekend/holiday/
// season/merchant words stay unlisted -- BALENISA categories are
// user-defined, so those remain deliberately unresolved rather than
// guessed at.
// Batch 2 addition: forecast-qualifier words ("projected", "predicted",
// "forecasted", "forecast", "estimated", "expected") are appended here so
// e.g. "projected spending" is never mistaken for a category named
// "projected" -- these describe a forward-looking QUALIFIER of spending
// (the SPENDING_FORECAST_EXPLANATION intent's own territory below), the
// same category this list already excludes "monthly"/"total"/etc for.
const OVERALL_MODIFIERS =
  "overall|total|monthly|month|weekly|week|yearly|year|annual|daily|day|average|general|entire|whole|all|my|our|your|their|its|the|a|an|this|that|these|those|last|past|current|previous|recent|much|more|less|high|higher|low|lower|big|bigger|biggest|large|larger|largest|small|smaller|smallest|i|you|we|they|he|she|it|who|did|do|does|to|of|in|on|and|or|" +
  "projected|predicted|forecasted|forecast|estimated|expected|" +
  "january|february|march|april|may|june|july|august|september|october|november|december";
const NAMED_AREA_SPENDING_PATTERN = new RegExp(
  `\\b(?!(?:${OVERALL_MODIFIERS})\\b)([a-z][a-z'-]*)\\s+(?:spending|spend|expenses|expense|costs|cost)\\b`
);
// "<Something> account(s) for ... spending/expenses" -- e.g. "Why does
// Rent account for so much of my spending?". The subject word is again
// shape-matched, never taken from a fixed category list.
const ACCOUNTS_FOR_PATTERN =
  /\b(?!(?:the|my|this|that|it|they|these|those)\b)([a-z][a-z'-]*)\s+accounts?\s+for\b/;
// (3) It asks what share/portion of spending a category represents, with
//     the category TRAILING the phrase -- "What percentage of my spending
//     is Groceries?", "How much of my spending comes from Dining?". The
//     two patterns above only find a category sitting immediately BEFORE
//     "spending"/"expenses", so this shape would otherwise fall through to
//     the broad spending branch and be answered from a context with no
//     category breakdown at all. The trailing word reuses the same
//     OVERALL_MODIFIERS guard, so a time-scoped tail ("...comes from last
//     month?") is rejected, and the connector list is closed -- "went to"
//     matches, "went up" does not. No category name is hard-coded, and no
//     category entity is extracted or returned; the LLM still receives the
//     whole distribution.
const CATEGORY_SHARE_OF_SPENDING_PATTERN = new RegExp(
  "\\b(?:percentage|percent|share|portion|proportion|how much)\\s+of\\s+my\\s+" +
    "(?:spending|expenses|expense|costs|cost)\\s+" +
    "(?:is|was|comes\\s+from|came\\s+from|goes\\s+to|went\\s+to)\\s+" +
    `(?!(?:${OVERALL_MODIFIERS})\\b)[a-z][a-z'-]*`
);

// The question must additionally ask for an explanation, a ranking, a
// share/concentration, or a category-level change -- not merely name a
// category. "which/what ... most/top/biggest/largest/highest/drove" covers
// ranking; "share/portion/percentage/proportion/concentration/dominat*"
// covers distribution; the change verbs mirror categoryGrowth's own
// fields.
const CATEGORY_INTENT_VERB_PATTERN =
  /\b(why|explain|most|top|biggest|largest|highest|greatest|drove|drive|driving|driven|share|portion|percentage|percent|proportion|concentration|concentrated|dominat\w*|breakdown|distribution|contributed|contribute|contributing|increase|increased|decrease|decreased|grew|grow|growth|changed|change|high|higher|low|lower|account|accounts)\b/;

// Vetoes questions whose primary subject is NOT a category explanation the
// M2-4A context can ground, even though they mention a category:
//  - advice/mutation/lookup: "Which category should I cut?", "Create a
//    category.", "Show my categories." -- no advisory, write, or raw-list
//    capability exists.
//  - prediction: "Predict my highest spending category next month." -- the
//    context is a completed monthly report, never a forecast.
//  - cross-domain: "Which category should I cut to stay under budget?",
//    "Which category is hurting my financial health?" -- answering would
//    require combining category data with budget/health domains the
//    category context does not carry. These deliberately fall through to
//    null (the existing 422), rather than being guessed into any single
//    intent.
const CATEGORY_ADVICE_PATTERN =
  /\b(should|recommend|recommendation|advice|advise|suggest|suggestion|cut|reduce|trim|save|savings|optimi[sz]e|better|worth|ought)\b/;
const CATEGORY_PREDICTION_PATTERN =
  /\b(predict|prediction|forecast|forecasting|project(?:ed|ion)?|next month|next year|future|will i|expect(?:ed)?)\b/;
const CATEGORY_MUTATION_PATTERN =
  /\b(create|add|set|update|edit|rename|delete|remove|merge|split|modify)\b(?:\s+\S+){0,3}\s+categor(?:y|ies)\b/;
// A bare listing/lookup request with no explanatory or ranking concept.
const CATEGORY_LOOKUP_PATTERN = /\b(show|list|display|give me|what are)\b/;
const CATEGORY_CROSS_DOMAIN_PATTERN = /\b(budget|financial (?:health|risk))\b/;

const CATEGORY_EXCLUSION_PATTERNS = [
  CATEGORY_ADVICE_PATTERN,
  CATEGORY_PREDICTION_PATTERN,
  CATEGORY_MUTATION_PATTERN,
  CATEGORY_LOOKUP_PATTERN,
  CATEGORY_CROSS_DOMAIN_PATTERN,
];

// Three-way result, because a category question that this intent cannot
// ground must NOT silently fall through to the broader spending/budget
// branches below -- "Which category should I cut to stay under budget?"
// mentions "budget" and would otherwise be answered as a pure budget-status
// question, hiding the fact that the category half of the request was
// never addressed. Genuine cross-domain/advice/prediction/lookup/mutation
// requests are returned as AMBIGUOUS so classifyIntent can stop at null
// (the existing 422) rather than guess a single domain.
const CATEGORY_MATCH = "CATEGORY_MATCH";
const CATEGORY_AMBIGUOUS = "CATEGORY_AMBIGUOUS";
const CATEGORY_NOT_APPLICABLE = "CATEGORY_NOT_APPLICABLE";

function evaluateCategoryQuestion(normalized) {
  // The share-of-spending shape encodes BOTH the category topic and the
  // share question in one pattern, so it needs no separate intent verb --
  // "How much of my spending comes from Dining?" contains no word from
  // CATEGORY_INTENT_VERB_PATTERN, yet is unambiguously a category-share
  // question that categoryDistribution's percentages can answer.
  const asksCategoryShare = CATEGORY_SHARE_OF_SPENDING_PATTERN.test(normalized);

  const namesCategory =
    asksCategoryShare ||
    CATEGORY_WORD_PATTERN.test(normalized) ||
    NAMED_AREA_SPENDING_PATTERN.test(normalized) ||
    ACCOUNTS_FOR_PATTERN.test(normalized);

  if (!namesCategory) {
    return CATEGORY_NOT_APPLICABLE;
  }

  if (CATEGORY_EXCLUSION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return CATEGORY_AMBIGUOUS;
  }

  if (asksCategoryShare) {
    return CATEGORY_MATCH;
  }

  return CATEGORY_INTENT_VERB_PATTERN.test(normalized)
    ? CATEGORY_MATCH
    : CATEGORY_NOT_APPLICABLE;
}

// -- Batch 2: ANOMALY_EXPLANATION --------------------------------------
// "unusual"/"anomaly"/etc. is already a distinctive, low-collision word in
// this domain (never used by any of the four existing topic/verb
// patterns), so a single topic pattern is sufficient -- no separate verb
// gate is required, mirroring CATEGORY_WORD_PATTERN's directness.
const ANOMALY_TOPIC_PATTERN =
  /\b(unusual|anomaly|anomalies|abnormal|strange|weird|suspicious|out of the ordinary|spike|spiked|flagged)\b/;

// -- Batch 2: SPENDING_FORECAST_EXPLANATION -----------------------------
// Either an explicit forecasting keyword, OR a spending-topic question
// paired with a forward-looking time horizon / future-tense spend phrase.
// The AND-with-spending-topic branch prevents an unrelated "next month"
// mention (e.g. "What's my budget next month?" -- already
// BUDGET_STATUS_EXPLANATION's territory once "budget" is present) from
// being misread as a forecast request when spending is not the subject.
const FORECAST_KEYWORD_PATTERN = /\b(forecast|forecasted|forecasting|predict|prediction|projected|projection)\b/;
const FORECAST_TIME_HORIZON_PATTERN = /\b(next month|next quarter|next year|coming month|coming quarter|coming year)\b/;
const FORECAST_FUTURE_SPEND_PATTERN =
  /\b(will i spend|might i spend|how much will i|how much might i|expect to spend|expected to spend)\b/;

function isForecastQuestion(normalized) {
  if (FORECAST_KEYWORD_PATTERN.test(normalized)) return true;
  if (!SPENDING_TOPIC_PATTERN.test(normalized)) return false;
  return FORECAST_TIME_HORIZON_PATTERN.test(normalized) || FORECAST_FUTURE_SPEND_PATTERN.test(normalized);
}

// -- Batch 2: FINANCIAL_RISK_EXPLANATION --------------------------------
// Deliberately checked AFTER HEALTH_EXPLANATION and BUDGET_STATUS_EXPLANATION
// below, so this can never steal "explain my financial risk" (already
// HEALTH_EXPLANATION's exact existing contract, see HEALTH_TOPIC_PATTERN)
// or a budget-scoped risk question ("Is there a risk with my budget?",
// already BUDGET_STATUS_EXPLANATION's territory via its own "risk" verb).
// `risks?` (not a bare `risk`) intentionally also catches the plural form
// HEALTH_TOPIC_PATTERN's singular-only `\brisk\b` does not.
const RISK_TOPIC_PATTERN = /\b(financial risks?|risks?|risky)\b/;
// Deliberately narrow to genuine question/explanation shapes -- a bare
// topic+adjective mention ("financial risk level", "My risk level is
// Low.") must NOT match, mirroring HEALTH_EXPLANATION's own existing
// "topic mention alone is not a question" conservatism.
const RISK_VERB_PATTERN = /\b(why|explain|do i have|have any|is there|risk status|current risk|financial risk status)\b/;

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

  // M2-4B deliberate contract correction: a clearly category-focused
  // question is checked BEFORE the broad spending-change branch. Many
  // category questions ("Which category contributed most to my spending
  // increase?", "Why is my grocery spending so high?") also satisfy the
  // spending topic+verb gate, but only
  // CATEGORY_SPENDING_EXPLANATION's context carries category-level
  // aggregates and categoryGrowth -- answering them from the
  // spending-change context would ground the answer in data that has no
  // category breakdown at all (see responseFormatter.js's note that the
  // spending context "carr[ies] no category-level data"). Overall
  // spending-change questions ("Why did my overall spending increase?",
  // "Why are my total expenses higher this month?") name no category and
  // are unaffected -- they fall through to the branch below exactly as
  // before.
  const categoryResult = evaluateCategoryQuestion(normalized);

  if (categoryResult === CATEGORY_MATCH) {
    return CATEGORY_SPENDING_EXPLANATION;
  }

  // A category question this intent cannot ground (advice, prediction,
  // lookup, mutation, or category+budget / category+health) stops here at
  // null rather than falling through to a branch that would answer only
  // half of it.
  if (categoryResult === CATEGORY_AMBIGUOUS) {
    return null;
  }

  // Batch 2: anomaly questions are checked before the broad spending-change
  // branch for the same reason category questions are (above) -- "Why was
  // this expense considered unusual?" satisfies SPENDING_CHANGE's own
  // topic+verb gate ("expense" + "why"), but only the anomaly context
  // actually carries flagged-anomaly detail.
  if (ANOMALY_TOPIC_PATTERN.test(normalized)) {
    return ANOMALY_EXPLANATION;
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

  // Batch 2: forecast is checked AFTER spending-change AND budget-status
  // (not before, as an earlier draft had it) -- FORECAST_KEYWORD_PATTERN
  // includes "projected"/"projection", which BUDGET_STATUS_VERB_PATTERN
  // already used for an unrelated, pre-existing concept (a budget-overrun
  // PROJECTION, not a spending forecast -- e.g. "Is my budget projection
  // reliable?", "Explain my projected budget status."). Checking budget
  // first preserves that exact pre-existing routing; none of the required
  // forecast example questions ("How much might I spend next month?",
  // "What is my spending forecast for the next quarter?") mention
  // "budget" at all, so moving this check later never prevents them from
  // matching.
  if (isForecastQuestion(normalized)) {
    return SPENDING_FORECAST_EXPLANATION;
  }

  // Batch 2: checked last, strictly after HEALTH_EXPLANATION (which already
  // owns the exact "financial risk"+explanation-verb phrasing) and
  // BUDGET_STATUS_EXPLANATION (which already owns budget-scoped risk
  // questions) -- so this can only ever catch a genuine, non-budget,
  // non-health-explanation risk question.
  if (RISK_TOPIC_PATTERN.test(normalized) && RISK_VERB_PATTERN.test(normalized)) {
    return FINANCIAL_RISK_EXPLANATION;
  }

  return null;
}

module.exports = {
  classifyIntent,
  ANOMALY_EXPLANATION,
  SPENDING_FORECAST_EXPLANATION,
  FINANCIAL_RISK_EXPLANATION,
};
