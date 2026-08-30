// SIA intent classifier -- recognizes clear requests for health/risk explanation, spending change, budget status, and category spending explanation, using the exact intent identifiers contextBuilder.js established. No LLM, no general NLP framework, no classifier registry -- just small, explicit sets of phrase checks, one per intent. False negatives (null for an unusually phrased real question) are preferable to false positives.
"use strict";

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";
const BUDGET_STATUS_EXPLANATION = "BUDGET_STATUS_EXPLANATION";
const CATEGORY_SPENDING_EXPLANATION = "CATEGORY_SPENDING_EXPLANATION";
// Three report-backed intents, added strictly ADDITIVELY -- every existing identifier/branch above is unchanged; each new check is positioned so it can never steal a query the four intents above already claim (see placement notes at each check site).
const ANOMALY_EXPLANATION = "ANOMALY_EXPLANATION";
const SPENDING_FORECAST_EXPLANATION = "SPENDING_FORECAST_EXPLANATION";
const FINANCIAL_RISK_EXPLANATION = "FINANCIAL_RISK_EXPLANATION";
// Added strictly ADDITIVELY, checked strictly LAST (see placement note at
// its check site) -- every existing identifier/branch above is unchanged.
const CURRENT_SPENDING_SUMMARY = "CURRENT_SPENDING_SUMMARY";

// Must ask for an explanation/meaning/reason (not just mention the topic) AND mention "financial health"/"financial risk" specifically -- not bare "health" (medical-health false match) or bare "risk".
const EXPLANATION_VERB_PATTERN = /\b(why|explain|what does .* mean|meaning of|reason for)\b/;
const HEALTH_TOPIC_PATTERN = /\bfinancial (health|risk)\b/;

// Must mention spending/expenses specifically (not budget/afford/transaction) AND ask about a change/increase/decrease/contribution/comparison -- not a mere lookup or a forward-looking request.
const SPENDING_TOPIC_PATTERN = /\b(spending|spend|expense|expenses)\b/;
const SPENDING_CHANGE_VERB_PATTERN =
  /\b(why|explain|increase|increased|decrease|decreased|higher|lower|more|less|changed|change|contribute|contributed|compare|compared|comparison)\b/;

// Must explicitly mention "budget" (word-bounded, not a substring) AND ask about status/utilization/remaining/over-under/risk/projection/reliability/explanation -- not a definition, mutation, or advice request. Every concept maps to a field contextBuilder.js's BUDGET_STATUS_EXPLANATION context actually guarantees -- classification is never broader than what the context supports.
const BUDGET_TOPIC_PATTERN = /\bbudget\b/;
const BUDGET_STATUS_VERB_PATTERN =
  /\b(why|explain|status|utilization|utilized|used|remaining|remain|left|over|under|exceed|exceeding|exceeded|overspent|overspend|risk|projected|projection|reliable|reliability)\b/;

// The topic+verb gate above is intentionally loose, so it also accepts mutation requests ("increase my budget") and advice requests ("spend my remaining budget") that reuse the same words -- this exclusion vetoes exactly those two shapes without rejecting legitimate report explanations.
// Mutation-action verbs change the CONFIGURED budget value itself, never merely describe a status/utilization value.
const BUDGET_MUTATION_VERBS = "set|create|update|edit|increase|decrease|raise|lower|delete|remove|modify|change";
// Advice-action verbs ask what the user should personally DO with money, not what the report already shows.
const BUDGET_ADVICE_VERBS = "spend|invest";
// Both only veto a match when the verb governs "budget" as its direct object (appears shortly BEFORE it). A verb appearing AFTER "budget" describes a report-computed state ("budget utilization increased") and must never be excluded -- "exceed" is deliberately absent from both lists above for this reason.
const BUDGET_ACTION_EXCLUSION_PATTERN = new RegExp(
  `\\b(?:${BUDGET_MUTATION_VERBS}|${BUDGET_ADVICE_VERBS})\\b(?:\\s+\\S+){0,4}\\s+budget\\b`
);

// -- CATEGORY_SPENDING_EXPLANATION ------------------------------------
//
// Every concept below maps to a field contextBuilder.js's CATEGORY_SPENDING_EXPLANATION context actually guarantees (topCategory/leastCategory, categoryDistribution's amount+percentage, concentrationIndex, top3Concentration, categoryGrowth's fields) -- classification is never broader than what the context supports.
//
// Two ways a question can be category-focused: (1) says "category"/"categories" explicitly.
const CATEGORY_WORD_PATTERN = /\bcategor(?:y|ies)\b/;
// (2) names a specific spending area possessively/attributively ("my grocery spending") rather than asking about spending overall. Deliberately NOT a hard-coded category list (categories are user-defined): matches the grammatical SHAPE of a modifier word before spending/expenses, or a noun before "account(s) for". Overall/time-based modifiers are excluded so "my monthly spending" never looks category-named; pronouns/auxiliaries are included so "did I spend" isn't mistaken for a category name; the twelve full month names are included so a time-scoped question isn't treated as naming a category (abbreviations are deliberately excluded as plausible user category names); forecast-qualifier words ("projected", "predicted", etc.) are included so "projected spending" isn't mistaken for a category named "projected" (that's SPENDING_FORECAST_EXPLANATION's territory).
const OVERALL_MODIFIERS =
  "overall|total|monthly|month|weekly|week|yearly|year|annual|daily|day|average|general|entire|whole|all|my|our|your|their|its|the|a|an|this|that|these|those|last|past|current|previous|recent|much|more|less|high|higher|low|lower|big|bigger|biggest|large|larger|largest|small|smaller|smallest|i|you|we|they|he|she|it|who|did|do|does|to|of|in|on|and|or|" +
  "projected|predicted|forecasted|forecast|estimated|expected|" +
  "january|february|march|april|may|june|july|august|september|october|november|december";
const NAMED_AREA_SPENDING_PATTERN = new RegExp(
  `\\b(?!(?:${OVERALL_MODIFIERS})\\b)([a-z][a-z'-]*)\\s+(?:spending|spend|expenses|expense|costs|cost)\\b`
);
// "<Something> account(s) for ... spending/expenses" -- subject word is shape-matched, never taken from a fixed category list.
const ACCOUNTS_FOR_PATTERN =
  /\b(?!(?:the|my|this|that|it|they|these|those)\b)([a-z][a-z'-]*)\s+accounts?\s+for\b/;
// (3) asks what share/portion of spending a category represents, with the category TRAILING the phrase ("What percentage of my spending is Groceries?") -- the two patterns above only find a category BEFORE "spending"/"expenses", so this shape would otherwise fall through to the broad spending branch and answer from a context with no category breakdown. Reuses OVERALL_MODIFIERS to reject a time-scoped tail; no category name is hard-coded or extracted, the LLM still receives the whole distribution.
const CATEGORY_SHARE_OF_SPENDING_PATTERN = new RegExp(
  "\\b(?:percentage|percent|share|portion|proportion|how much)\\s+of\\s+my\\s+" +
    "(?:spending|expenses|expense|costs|cost)\\s+" +
    "(?:is|was|comes\\s+from|came\\s+from|goes\\s+to|went\\s+to)\\s+" +
    `(?!(?:${OVERALL_MODIFIERS})\\b)[a-z][a-z'-]*`
);

// Must additionally ask for an explanation, ranking, share/concentration, or category-level change -- not merely name a category.
const CATEGORY_INTENT_VERB_PATTERN =
  /\b(why|explain|most|top|biggest|largest|highest|greatest|drove|drive|driving|driven|share|portion|percentage|percent|proportion|concentration|concentrated|dominat\w*|breakdown|distribution|contributed|contribute|contributing|increase|increased|decrease|decreased|grew|grow|growth|changed|change|high|higher|low|lower|account|accounts)\b/;

// Vetoes questions whose primary subject is NOT a category explanation the context can ground, even though they mention a category: advice/mutation/lookup (no advisory/write/raw-list capability); prediction (context is a completed monthly report, never a forecast); cross-domain (answering would require combining category data with budget/health domains it doesn't carry) -- these fall through to null (422) rather than being guessed into any single intent.
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

// Three-way result, because a category question this intent cannot ground must NOT silently fall through to the broader spending/budget branches -- "Which category should I cut to stay under budget?" mentions "budget" and would otherwise be answered as a pure budget-status question, hiding that the category half was never addressed. Genuine cross-domain/advice/prediction/lookup/mutation requests return AMBIGUOUS so classifyIntent stops at null rather than guessing a single domain.
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

// -- ANOMALY_EXPLANATION --------------------------------------
// "unusual"/"anomaly"/etc. is a distinctive, low-collision word (never used by the four existing topic/verb patterns), so a single topic pattern suffices -- no separate verb gate needed, mirroring CATEGORY_WORD_PATTERN's directness.
const ANOMALY_TOPIC_PATTERN =
  /\b(unusual|anomaly|anomalies|abnormal|strange|weird|suspicious|out of the ordinary|spike|spiked|flagged)\b/;

// -- SPENDING_FORECAST_EXPLANATION -----------------------------
// Either an explicit forecasting keyword, OR a spending-topic question paired with a forward-looking time horizon/future-tense spend phrase. The AND-with-spending-topic branch prevents an unrelated "next month" mention from being misread as a forecast request when spending isn't the subject.
const FORECAST_KEYWORD_PATTERN = /\b(forecast|forecasted|forecasting|predict|prediction|projected|projection)\b/;
const FORECAST_TIME_HORIZON_PATTERN = /\b(next month|next quarter|next year|coming month|coming quarter|coming year)\b/;
const FORECAST_FUTURE_SPEND_PATTERN =
  /\b(will i spend|might i spend|how much will i|how much might i|expect to spend|expected to spend)\b/;

function isForecastQuestion(normalized) {
  if (FORECAST_KEYWORD_PATTERN.test(normalized)) return true;
  if (!SPENDING_TOPIC_PATTERN.test(normalized)) return false;
  return FORECAST_TIME_HORIZON_PATTERN.test(normalized) || FORECAST_FUTURE_SPEND_PATTERN.test(normalized);
}

// -- FINANCIAL_RISK_EXPLANATION --------------------------------
// Checked AFTER HEALTH_EXPLANATION and BUDGET_STATUS_EXPLANATION so this can never steal "explain my financial risk" (HEALTH_EXPLANATION's territory) or a budget-scoped risk question (BUDGET_STATUS_EXPLANATION's territory). `risks?` also catches the plural HEALTH_TOPIC_PATTERN's singular-only pattern doesn't.
const RISK_TOPIC_PATTERN = /\b(financial risks?|risks?|risky)\b/;
// Deliberately narrow to genuine question/explanation shapes -- a bare topic+adjective mention must NOT match, mirroring HEALTH_EXPLANATION's conservatism.
const RISK_VERB_PATTERN = /\b(why|explain|do i have|have any|is there|risk status|current risk|financial risk status)\b/;

// -- CURRENT_SPENDING_SUMMARY -----------------------------------------
//
// A bare "what's my current-month total?" lookup question -- NOT an
// explanation, comparison, forecast, category breakdown, or advice
// request. Checked strictly LAST, after all seven existing intents above
// have already had a chance to claim the question, so it can never steal
// a genuine health/spending-change/budget/category/anomaly/forecast/risk
// question that merely happens to also mention "spend"/"this month"/
// "how much" -- those intents all return before this point is reached.
//
// Requires THREE independent signal groups to ALL be true (not one
// sentence-shaped regex): (1) a spending topic word, (2) an explicit
// CURRENT-period phrase (never a bare "this"/implicit period, and never a
// past/named month -- that is what actually distinguishes this from the
// existing, deliberately-null "How much did I spend?" case), and (3) a
// total/amount lookup word. Every concept maps to exactly the one field
// contextBuilder.js's CURRENT_SPENDING_SUMMARY context will supply --
// summary.totalSpent -- so classification is never broader than what the
// context can ground.
const SPENDING_SUMMARY_TOPIC_PATTERN =
  /\b(spend|spent|spending|expense|expenses|expenditure|expenditures)\b/;

// Curly apostrophes normalized to straight ones and hyphens normalized to
// spaces before this is tested (see normalizeForCurrentPeriod below), so
// "current month's" and "month-to-date"/"month to date" are all covered
// by these plain-space phrases without needing separate hyphen-tolerant
// alternatives.
const CURRENT_PERIOD_PATTERN =
  /\b(this month|current month|month to date|so far this month)\b/;

const TOTAL_LOOKUP_PATTERN = /\b(how much|total|amount|what is|tell me)\b/;

// Curly-apostrophe collapse + hyphen-to-space + whitespace collapse,
// scoped ONLY to the CURRENT_SPENDING_SUMMARY check below -- every other
// intent's patterns above continue to run against the plain
// trim()+toLowerCase() `normalized` string exactly as before, unchanged.
function normalizeForCurrentPeriod(normalized) {
  return normalized
    .replace(/[‘’]/g, "'")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Excludes any question already recognizable as a change/comparison
// question (reuses SPENDING_CHANGE_VERB_PATTERN verbatim -- "why did my
// spending increase this month" must never be double-claimed), a budget
// question (reuses CATEGORY_WORD_PATTERN/NAMED_AREA_SPENDING_PATTERN/
// ACCOUNTS_FOR_PATTERN/CATEGORY_SHARE_OF_SPENDING_PATTERN -- the exact same
// "names a category" shapes evaluateCategoryQuestion() uses -- as a
// defensive backstop; a genuine CATEGORY_MATCH/CATEGORY_AMBIGUOUS question
// already returned above before this function is ever reached, but a
// category-NAMED, verb-less question such as "How much is my grocery
// spending this month?" reaches CATEGORY_NOT_APPLICABLE and falls through
// to here, so it must still be excluded rather than answered from a
// total-only context that has no category breakdown), a forecast question
// (reuses the three existing forecast patterns verbatim), advice/
// recommendation language ("should i spend" / "can i spend" must never be
// read as a total lookup), a raw transaction/list/detail request (a list
// of transactions is not a single total), or historical/named-month
// wording (a bare "last month" or a named month is explicitly NOT a
// current-period phrase, and is excluded again here defensively).
const SUMMARY_ADVICE_EXCLUSION_PATTERN =
  /\b(should|can|could|advice|advise|recommend|recommendation)\b/;
const SUMMARY_LOOKUP_EXCLUSION_PATTERN =
  /\b(list|show|display|transactions?|give me a list)\b/;
const SUMMARY_HISTORICAL_EXCLUSION_PATTERN =
  /\b(last month|previous month|prior month|january|february|march|april|may|june|july|august|september|october|november|december)\b/;

function isCurrentSpendingSummaryQuestion(normalized) {
  const s = normalizeForCurrentPeriod(normalized);

  const hasTopic = SPENDING_SUMMARY_TOPIC_PATTERN.test(s);
  const hasCurrentPeriod = CURRENT_PERIOD_PATTERN.test(s);
  const hasLookup = TOTAL_LOOKUP_PATTERN.test(s);

  if (!hasTopic || !hasCurrentPeriod || !hasLookup) {
    return false;
  }

  if (SPENDING_CHANGE_VERB_PATTERN.test(s)) return false;
  if (BUDGET_TOPIC_PATTERN.test(s)) return false;
  // NAMED_AREA_SPENDING_PATTERN is tested against the current-period phrase
  // STRIPPED OUT of `s` -- "month to date"/"month-to-date" itself ends in a
  // word ("date") immediately followed by "spend" ("...month to date
  // spend?"), which would otherwise be misread as a category named "date".
  // Stripping the matched period phrase first removes that false trigger
  // while leaving a genuine category mention ("grocery spending this
  // month") completely unaffected, since the period phrase there is a
  // separate trailing word group, not adjacent to the topic word.
  const withoutCurrentPeriodPhrase = s.replace(CURRENT_PERIOD_PATTERN, " ");
  if (
    CATEGORY_WORD_PATTERN.test(s) ||
    NAMED_AREA_SPENDING_PATTERN.test(withoutCurrentPeriodPhrase) ||
    ACCOUNTS_FOR_PATTERN.test(s) ||
    CATEGORY_SHARE_OF_SPENDING_PATTERN.test(s)
  ) {
    return false;
  }
  if (
    FORECAST_KEYWORD_PATTERN.test(s) ||
    FORECAST_TIME_HORIZON_PATTERN.test(s) ||
    FORECAST_FUTURE_SPEND_PATTERN.test(s)
  ) {
    return false;
  }
  if (SUMMARY_ADVICE_EXCLUSION_PATTERN.test(s)) return false;
  if (SUMMARY_LOOKUP_EXCLUSION_PATTERN.test(s)) return false;
  if (SUMMARY_HISTORICAL_EXCLUSION_PATTERN.test(s)) return false;

  return true;
}

function classifyIntent(question) {
  if (typeof question !== "string") {
    return null;
  }

  const normalized = question.trim().toLowerCase();
  if (normalized === "") {
    return null;
  }

  // Health is checked first and unconditionally: any input that already matched must keep matching HEALTH_EXPLANATION, never be reclassified as a spending question.
  if (HEALTH_TOPIC_PATTERN.test(normalized) && EXPLANATION_VERB_PATTERN.test(normalized)) {
    return HEALTH_EXPLANATION;
  }

  // A clearly category-focused question is checked BEFORE the broad spending-change branch. Many category questions also satisfy the spending topic+verb gate, but only CATEGORY_SPENDING_EXPLANATION's context carries category-level aggregates and categoryGrowth -- answering from the spending-change context would ground the answer in data with no category breakdown. Overall spending-change questions name no category and fall through unaffected.
  const categoryResult = evaluateCategoryQuestion(normalized);

  if (categoryResult === CATEGORY_MATCH) {
    return CATEGORY_SPENDING_EXPLANATION;
  }

  // A category question this intent cannot ground stops here at null rather than falling through to a branch that would answer only half of it.
  if (categoryResult === CATEGORY_AMBIGUOUS) {
    return null;
  }

  // Anomaly questions are checked before the broad spending-change branch for the same reason category questions are -- "Why was this expense considered unusual?" satisfies SPENDING_CHANGE's own gate, but only the anomaly context carries flagged-anomaly detail.
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

  // Forecast is checked AFTER spending-change AND budget-status -- FORECAST_KEYWORD_PATTERN includes "projected"/"projection", which BUDGET_STATUS_VERB_PATTERN already uses for an unrelated pre-existing concept (a budget-overrun PROJECTION, not a spending forecast). Checking budget first preserves that routing; none of the required forecast examples mention "budget" at all, so this never blocks them.
  if (isForecastQuestion(normalized)) {
    return SPENDING_FORECAST_EXPLANATION;
  }

  // Checked last, strictly after HEALTH_EXPLANATION and BUDGET_STATUS_EXPLANATION (which already own their own risk-adjacent phrasings) -- so this can only catch a genuine, non-budget, non-health-explanation risk question.
  if (RISK_TOPIC_PATTERN.test(normalized) && RISK_VERB_PATTERN.test(normalized)) {
    return FINANCIAL_RISK_EXPLANATION;
  }

  // Checked strictly LAST -- every other supported intent above has
  // already had a chance to claim the question and return, so this can
  // only ever catch a genuine bare current-month total lookup that none
  // of the other six intents' more specific patterns recognized.
  if (isCurrentSpendingSummaryQuestion(normalized)) {
    return CURRENT_SPENDING_SUMMARY;
  }

  return null;
}

module.exports = {
  classifyIntent,
  ANOMALY_EXPLANATION,
  SPENDING_FORECAST_EXPLANATION,
  FINANCIAL_RISK_EXPLANATION,
  CURRENT_SPENDING_SUMMARY,
};
