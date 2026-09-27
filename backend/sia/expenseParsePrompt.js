"use strict";

// AI-002 -- structured-output contract for natural-language expense entry.
// Mirrors monthlySummaryPrompt.js's shape: a frozen JSON schema plus a
// pure prompt-request builder, no I/O, no LLM call here.
//
// Deliberately uniform, non-nullable field types (every property is a
// plain string/number, never `["string","null"]`) so the schema stays
// strict-mode-friendly across all three providers (OpenAI/Gemini/Groq) --
// "not stated in the text" is signalled by an EMPTY STRING or a 0 amount,
// never a JSON null. Turning those empty/zero sentinels into "couldn't
// parse" or "defaulted to today" is naturalLanguageExpenseService.js's
// job, not this module's.

const STRUCTURED_OUTPUT_NAME = "parsed_expense";

const PARSED_EXPENSE_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    outcome: {
      type: "string",
      enum: ["parsed", "unsupported"],
      description:
        "'parsed' only if the text clearly states a numeric amount already spent on ONE expense. 'unsupported' for anything else -- no amount stated, not an expense at all, multiple separate expenses, or too ambiguous to extract safely.",
    },
    expenseAmount: {
      type: "number",
      description:
        "The numeric amount spent, no currency symbol, no thousands separators. 0 when outcome is 'unsupported'.",
    },
    expenseName: {
      type: "string",
      description:
        "A short 1-5 word label for what was bought, e.g. 'Lunch' or 'Uber ride'. Empty string when outcome is 'unsupported'.",
    },
    expenseCategory: {
      type: "string",
      description:
        "A single best-guess category word such as Food, Transport, Shopping, Bills, Entertainment, Groceries, Health, Education, Travel, Rent. Empty string if none is reasonably inferable.",
    },
    expenseDate: {
      type: "string",
      description:
        "The expense date as YYYY-MM-DD, resolving relative terms (today, yesterday, last Monday, on the 3rd) against referenceDate given in the context. Empty string if the text states no date at all.",
    },
    expenseDescription: {
      type: "string",
      description:
        "Any extra detail from the text not already captured above, such as a merchant or place name. Empty string if none.",
    },
  },
  required: [
    "outcome",
    "expenseAmount",
    "expenseName",
    "expenseCategory",
    "expenseDate",
    "expenseDescription",
  ],
});

const SYSTEM_PROMPT = [
  "You turn one sentence of free text into a single structured expense record for BALENISA, a personal expense tracker.",
  "You are given `referenceDate` (today's date, YYYY-MM-DD) in the context JSON -- resolve every relative date word (today, yesterday, last Friday, on the 3rd) against it.",
  "Rules, all mandatory:",
  "1. Only set outcome to 'parsed' if the text states a clear numeric amount that was (or will be) spent on ONE expense. Never guess or estimate an amount that isn't in the text.",
  "2. If the text describes more than one separate expense, asks a question, gives an instruction unrelated to logging an expense, or names no amount at all, set outcome to 'unsupported'.",
  "3. Never invent a category, merchant, or date that isn't stated or clearly implied -- leave the field as an empty string instead.",
  "4. Do not give financial, investment, tax, or legal advice, and do not comment on whether the spending is wise.",
  "Respond only via the given structured schema.",
].join(" ");

// referenceDate is required context: every relative date word in the
// system prompt's rule 1 depends on it. A caller passing something other
// than a real YYYY-MM-DD string gets `null` here rather than a
// silently-wrong date sent to the provider -- the LLM is instructed above
// to treat context as authoritative, so garbage in must not look valid.
function buildExpenseParsePromptRequest(text, { referenceDate } = {}) {
  return {
    systemPrompt: SYSTEM_PROMPT,
    context: { referenceDate: typeof referenceDate === "string" ? referenceDate : null },
    question: text,
    history: [],
    structuredOutput: { name: STRUCTURED_OUTPUT_NAME, schema: PARSED_EXPENSE_SCHEMA },
  };
}

module.exports = {
  STRUCTURED_OUTPUT_NAME,
  PARSED_EXPENSE_SCHEMA,
  SYSTEM_PROMPT,
  buildExpenseParsePromptRequest,
};
