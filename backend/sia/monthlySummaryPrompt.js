"use strict";

// Builds the system prompt, user context, and JSON-schema structured-output request for the LLM-authored monthly summary.

const { getFact, listEligibleFactIds } = require("../analytics/monthlySummaryFacts");

const STRUCTURED_OUTPUT_NAME = "monthly_summary";

// Js). Requiring citedFactIds as a sibling array (not embedded per-sentence) keeps the schema simple enough for every provider's strict-mode v.
const MONTHLY_SUMMARY_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    narrative: {
      type: "string",
      description:
        "A short, plain-language monthly financial summary (2-6 sentences). Every number in this text MUST come from a fact in the provided facts list -- never invent, estimate, or round a number that isn't one of the given fact values.",
    },
    citedFactIds: {
      type: "array",
      description: "The factId of every fact from the provided list that this narrative actually references.",
      items: { type: "string" },
    },
  },
  required: ["narrative", "citedFactIds"],
});

// The fixed system prompt. js's own system prompts use elsewhere in this codebase, restated here for a standalone, non-conversational generati.
const SYSTEM_PROMPT = [
  "You are BALENISA's monthly financial summary writer.",
  "You will be given a JSON list of eligible facts, each with a stable factId, a label, a unit, and a value.",
  "Write a short (2-6 sentence) plain-language narrative that highlights the most useful facts for the user this month.",
  "Rules, all mandatory:",
  "1. Every number you write (currency amount, percentage, count) MUST be exactly one of the given fact values -- never invent, estimate, average, or round a number that is not already a fact value.",
  "2. Only reference a fact that is in the provided list -- never assume a fact exists that wasn't given to you.",
  "3. Do not give financial, investment, tax, or legal advice. Do not speculate about fraud or guarantee any future outcome.",
  "4. Do not mention internal field names, IDs, or raw JSON -- write natural language only.",
  "5. Return your answer only in the required structured JSON format: {\"narrative\": string, \"citedFactIds\": string[]}.",
  "6. citedFactIds must list the factId of every fact your narrative text actually uses, and nothing else.",
].join(" ");

// Builds the bounded, structured "facts" context handed to the LLM as the user-input content -- exactly the eligible facts for this report, via getFact() (which already enforces each fact's own hasData/hasBudget/ reasonCode eligibility gate), never a raw report property.
function buildFactsContext(report) {
  const eligibleIds = listEligibleFactIds(report);
  const facts = eligibleIds
    .map((factId) => getFact(report, factId))
    .filter(Boolean)
    .map(({ factId, label, unit, value }) => ({ factId, label, unit, value }));
  return { facts };
}

// Js's askLlm() expects. `question` is fixed (this is not a conversational Q&A turn) -- naming it plainly documents the ask without pretending.
function buildMonthlySummaryPromptRequest(report) {
  return {
    systemPrompt: SYSTEM_PROMPT,
    context: buildFactsContext(report),
    question: "Write this month's financial summary from the given facts.",
    structuredOutput: { name: STRUCTURED_OUTPUT_NAME, schema: MONTHLY_SUMMARY_SCHEMA },
  };
}

module.exports = {
  buildMonthlySummaryPromptRequest,
  buildFactsContext,
  MONTHLY_SUMMARY_SCHEMA,
  STRUCTURED_OUTPUT_NAME,
  SYSTEM_PROMPT,
};
