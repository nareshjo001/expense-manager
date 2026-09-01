// SIA shared prohibited-phrase check -- a small, deterministic, zero-cost
"use strict";

// A mutation verb governing a financial-data domain noun as its direct
const MUTATION_VERBS = "set|create|update|edit|increase|decrease|raise|lower|delete|remove|modify|change|add";
const MUTABLE_DOMAIN_NOUNS = "budget|budgets|category|categories|expense|expenses|income|goal|goals";
const MUTATION_REQUEST_PATTERN = new RegExp(
  `\\b(?:${MUTATION_VERBS})\\b(?:\\s+\\S+){0,4}\\s+(?:${MUTABLE_DOMAIN_NOUNS})\\b`
);

// A raw transaction-level listing/export request -- SIA has no raw-list
const RAW_LIST_REQUEST_PATTERN = new RegExp(
  "\\b(?:(?:list|give me a list of|show me a list of)\\b(?:\\s+\\S+){0,6}\\s+(?:transactions?|expenses|records|raw data|line items?|spending|income)\\b|" +
    "(?:show|display|export)\\b(?:\\s+\\S+){0,4}\\s+(?:transactions?|expenses|records|raw data|line items?)\\b)"
);

// Out-of-scope financial/investment/legal/medical advice -- mirrors
const ADVICE_REQUEST_PATTERN =
  /\b(should i (?:buy|sell|invest|take out|refinance)|which stock|what stock|recommend a stock|stock (?:should|to) buy|invest in|take out a loan|refinance my|tax advice|legal advice|financial advice on what to do)\b/;

// A personalized recommendation/permission request framed as a modal verb
const RECOMMENDATION_REQUEST_PATTERN =
  /\b(?:should|can|could) i\b(?:\s+\S+){0,3}\s+(?:spend|save|cut|reduce|increase|decrease|allocate|invest|budget)\b/;

// A generic financial-EDUCATION/definition request ("what is a budget?",
const FINANCIAL_TERM_LIST =
  "budget|budgets|category|categories|expense|expenses|income|net cash flow|cash flow|financial health|anomaly|anomalies|forecast|spending|expenditure";
const GENERIC_DEFINITION_PATTERN = new RegExp(
  `\\b(?:what is|what's|what are|what does|define|explain what (?:a|an|the))\\b` +
    `(?:\\s+(?:a|an|the))?\\s*(?:${FINANCIAL_TERM_LIST})s?\\b(?:\\s+mean)?\\??`
);

// An entertainment-style REQUEST shape ("tell me a joke", "write me a
const ENTERTAINMENT_REQUEST_PATTERN =
  /\b(?:tell me a joke|make (?:me )?a joke|tell me a story|write (?:me )?a poem|write (?:me )?a song|sing (?:a|me) a? ?song)\b/;

// A small, deliberately conservative set of unambiguous NON-financial
const NON_FINANCIAL_TOPIC_PATTERN =
  /\b(weather|temperature outside|rain(?:fall)?|snowfall|traffic (?:report|conditions)|sports score|movie recommendation|recipe for|song lyrics|current time|what time is it)\b/;

// ---------------------------------------------------------------------

// An instruction-override / prompt-injection attempt -- general across any
const INSTRUCTION_OVERRIDE_PATTERN =
  /\b(?:ignore (?:the |your )?(?:schema|instructions?|rules?|previous instructions?|safety(?: checks?)?)|override (?:safety|validation|the schema)|\bbypass\b (?:validation|safety|the schema)|disregard (?:the |your )?(?:instructions?|rules?|safety))\b/;

// A Mongo-style operator token ("$where", "$function", "$lookup", ...) --
const MONGO_OPERATOR_PATTERN = /\$[a-zA-Z_]+\b/;

// An instruction to query/access a named database collection/table/
const SCHEMA_QUERY_INSTRUCTION_PATTERN =
  /\b(?:query|access|run a query on|execute (?:a |the )?query on)\b(?:\s+\S+){0,4}\s+(?:collection|database|table|schema)\b/;

// A request to disclose an internal identifier or raw transaction-level
const INTERNAL_ID_DISCLOSURE_PATTERN =
  /\b(?:return|reveal|expose|give me|show me|send me|dump)\b(?:\s+\S+){0,4}\s+(?:user ?ids?|internal ids?|object ?ids?|database ids?|raw transactions?|raw records?)\b/;

// A request to disclose the complete/entire structured report -- SIA only
const FULL_REPORT_DISCLOSURE_PATTERN =
  /\b(?:return|reveal|expose|give me|show me|send me|dump)\b(?:\s+\S+){0,4}\s+(?:full|entire|complete|whole)\s+(?:financial\s+)?report\b/;

function isClearlyProhibited(question) {
  if (typeof question !== "string") return false;
  const normalized = question.trim().toLowerCase();
  if (normalized === "") return false;

  return (
    MUTATION_REQUEST_PATTERN.test(normalized) ||
    RAW_LIST_REQUEST_PATTERN.test(normalized) ||
    ADVICE_REQUEST_PATTERN.test(normalized) ||
    RECOMMENDATION_REQUEST_PATTERN.test(normalized) ||
    GENERIC_DEFINITION_PATTERN.test(normalized) ||
    ENTERTAINMENT_REQUEST_PATTERN.test(normalized) ||
    NON_FINANCIAL_TOPIC_PATTERN.test(normalized) ||
    INSTRUCTION_OVERRIDE_PATTERN.test(normalized) ||
    MONGO_OPERATOR_PATTERN.test(normalized) ||
    SCHEMA_QUERY_INSTRUCTION_PATTERN.test(normalized) ||
    INTERNAL_ID_DISCLOSURE_PATTERN.test(normalized) ||
    FULL_REPORT_DISCLOSURE_PATTERN.test(normalized)
  );
}

module.exports = {
  isClearlyProhibited,
};
