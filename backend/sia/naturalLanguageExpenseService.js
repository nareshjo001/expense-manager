"use strict";

// AI-002 -- parses free text into a structured expense SUGGESTION via
// SIA's existing multi-provider askLlm(). NEVER writes to the database --
// this module only returns a suggestion for its caller (a controller) to
// hand back to the frontend, which pre-fills the EXISTING Add Expense form
// for the user to review and submit through the existing, unmodified
// create-expense path (same validation/idempotency/budget-sync as manual
// entry, same as BillUpload's OCR path already does).
//
// Provider/infra failures are NOT swallowed here -- askLlm()'s
// LlmProviderError propagates so the caller can classify it through
// sia/fallbackMessages.js exactly like ask.js does for /sia/ask. Only a
// well-formed but unusable LLM answer (no amount stated, malformed JSON
// shape) is normalized here into { outcome: "unsupported", reasonCode }.

const { askLlm } = require("./llmService");
const { buildExpenseParsePromptRequest } = require("./expenseParsePrompt");
const { getZonedYMD } = require("./periodResolver");
const { normalizeCategory } = require("../utils/categoryNormalization");
const { findRuleForMerchant } = require("../Services/CategorizationServices/merchantRule.service");

function formatYMD({ year, month, day }) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// Narrow shape check on the parsed structured-output JSON, separate from
// (and stricter than) llmService.js's own JSON.parse step -- a provider
// can return syntactically valid JSON that still doesn't match the schema
// we asked for. Never throws.
function isValidStructuredShape(parsed) {
  return Boolean(
    parsed &&
      typeof parsed === "object" &&
      (parsed.outcome === "parsed" || parsed.outcome === "unsupported") &&
      typeof parsed.expenseAmount === "number" &&
      Number.isFinite(parsed.expenseAmount) &&
      typeof parsed.expenseName === "string" &&
      typeof parsed.expenseCategory === "string" &&
      typeof parsed.expenseDate === "string" &&
      typeof parsed.expenseDescription === "string"
  );
}

// A YYYY-MM-DD string, and nothing else -- deliberately stricter than
// "new Date() parses it", since JS Date also accepts many non-ISO shapes
// this endpoint never asked the LLM to produce.
function isYmdString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

// Resolves a best-guess category: a user's own learned merchant rule
// (CAT-001) takes priority over the LLM's own guess, then the LLM's guess
// is run through the same normalizeCategory() every other write path
// uses -- never a bespoke mapping. Read-only; never throws (a rule-lookup
// failure falls through to the LLM guess, same fail-safe posture
// findRuleForMerchant's own callers already use elsewhere).
async function resolveCategory({ userId, llmCategory, merchantGuess }) {
  try {
    const rule = await findRuleForMerchant(userId, merchantGuess);
    if (rule && typeof rule.category === "string" && rule.category.trim() !== "") {
      return { category: rule.category, source: "merchant_rule" };
    }
  } catch (_err) {
    // Best-effort only, matching every other read of this rule elsewhere.
  }
  if (typeof llmCategory === "string" && llmCategory.trim() !== "") {
    const normalized = normalizeCategory(llmCategory);
    if (normalized) return { category: normalized, source: "llm" };
  }
  return { category: "", source: "none" };
}

// Parses free text into a structured expense suggestion. Resolves to:
//   { outcome: "parsed", expenseName, expenseCategory, expenseAmount,
//     expenseDate, expenseDescription, needsReview, fieldConfidence,
//     model, latencyMs }
//   { outcome: "unsupported", reasonCode: "NO_AMOUNT_FOUND" | "MALFORMED_RESPONSE",
//     model, latencyMs }
// Throws (propagates askLlm()'s LlmProviderError) on any provider/infra
// failure -- the caller classifies it via sia/fallbackMessages.js.
async function parseExpenseFromText({ userId, text, now, timeZone } = {}) {
  const referenceDate = formatYMD(getZonedYMD(now instanceof Date ? now : new Date(), timeZone));

  const request = buildExpenseParsePromptRequest(text, { referenceDate });
  const result = await askLlm(request);

  const parsed = result && result.structuredOutput;
  if (!isValidStructuredShape(parsed) || parsed.outcome !== "parsed" || !(parsed.expenseAmount > 0)) {
    return {
      outcome: "unsupported",
      reasonCode: isValidStructuredShape(parsed) ? "NO_AMOUNT_FOUND" : "MALFORMED_RESPONSE",
      model: result && result.model,
      latencyMs: result && result.latencyMs,
    };
  }

  const merchantGuess = parsed.expenseDescription || parsed.expenseName;
  const { category } = await resolveCategory({
    userId,
    llmCategory: parsed.expenseCategory,
    merchantGuess,
  });

  const dateFound = isYmdString(parsed.expenseDate);
  const nameFound = typeof parsed.expenseName === "string" && parsed.expenseName.trim() !== "";
  const categoryFound = category !== "";

  return {
    outcome: "parsed",
    expenseName: nameFound ? parsed.expenseName.trim() : "",
    expenseCategory: category,
    expenseAmount: parsed.expenseAmount,
    expenseDate: dateFound ? parsed.expenseDate : referenceDate,
    expenseDescription: typeof parsed.expenseDescription === "string" ? parsed.expenseDescription.trim() : "",
    // Mirrors BillUpload's own "needsReview" signal -- true whenever a
    // field the user will see pre-filled was NOT actually stated in their
    // text (a defaulted date, an unresolved category, or a generic/missing
    // name), so AddExpense.js's EXISTING review banner
    // (billData?.needsReview) covers this path with zero new UI logic.
    needsReview: !dateFound || !categoryFound || !nameFound,
    fieldConfidence: {
      expenseName: nameFound ? 100 : 0,
      expenseCategory: categoryFound ? 100 : 0,
      expenseAmount: 100,
      expenseDate: dateFound ? 100 : 0,
    },
    model: result.model,
    latencyMs: result.latencyMs,
  };
}

module.exports = {
  parseExpenseFromText,
  isValidStructuredShape,
  isYmdString,
  resolveCategory,
};
