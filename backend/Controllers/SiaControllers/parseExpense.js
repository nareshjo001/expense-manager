"use strict";
// AI-002 -- POST /sia/parse-expense: parses one sentence of free text into
// a structured expense SUGGESTION for the frontend to pre-fill onto the
// existing Add Expense form (the exact billData shape BillUpload's OCR
// path already produces). This endpoint never writes to the database.
// Mirrors ask.js's readiness/opt-out gates and fallbackMessages.js error
// classification so a user sees the exact same safe, generic failure
// messages SIA's other endpoints already use -- never a raw provider
// error, config detail, or stack trace.

const { isSiaReady } = require("../../sia/readiness");
const siaPreferenceService = require("../../sia/siaPreferenceService");
const config = require("../../sia/config");
const { parseExpenseFromText } = require("../../sia/naturalLanguageExpenseService");
const { LlmProviderError } = require("../../sia/llmService");
const { classifyProviderError, responseFor, CATEGORY } = require("../../sia/fallbackMessages");
const { recordOperation } = require("../../utils/metrics");

const MAX_TEXT_LENGTH = 200;

// SIA-001-T06 -- the same per-user opt-out gate ask.js uses. Fails OPEN on
// a lookup error -- a transient DB hiccup while reading one user's own
// toggle must never block this endpoint for everyone who never touched
// it. Duplicated rather than imported from ask.js (which exports nothing)
// -- matching the precedent transcribe.js's voiceReadinessGate already
// set for a second SIA entry point independently wrapping the same
// siaPreferenceService.isEnabledForUser().
async function safeIsSiaEnabledForUser(userId) {
  try {
    return await siaPreferenceService.isEnabledForUser(userId);
  } catch (_err) {
    return true;
  }
}

const parseExpense = async (req, res) => {
  // Readiness gate: the SAME isSiaReady() GET /sia/status and POST
  // /sia/ask both use, so all three can never disagree. Rejection is the
  // pre-existing generic 503, before any validation or provider call.
  if (!isSiaReady()) {
    const { status, body } = responseFor(CATEGORY.UNAVAILABLE);
    return res.status(status).json(body);
  }

  const siaEnabledForUser = await safeIsSiaEnabledForUser(req.userId);
  if (!siaEnabledForUser) {
    const { status, body } = responseFor(CATEGORY.SIA_DISABLED_BY_USER);
    return res.status(status).json(body);
  }

  const { text } = req.body || {};
  if (typeof text !== "string" || text.trim() === "") {
    return res.status(400).json({ success: false, message: "text is required" });
  }
  const trimmedText = text.trim();
  if (trimmedText.length > MAX_TEXT_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `text must be ${MAX_TEXT_LENGTH} characters or fewer`,
    });
  }

  const startedAt = Date.now();
  let outcome = "failure";
  try {
    const result = await parseExpenseFromText({
      userId: req.userId,
      text: trimmedText,
      now: new Date(),
      timeZone: config.appTimeZone,
    });

    if (result.outcome !== "parsed") {
      outcome = "unsupported";
      return res.status(200).json({
        success: false,
        code: "COULD_NOT_PARSE",
        message:
          'Couldn\'t confidently pull an expense out of that -- try including how much you spent, e.g. "spent 250 on lunch yesterday".',
      });
    }

    outcome = "success";
    return res.status(200).json({
      success: true,
      parsed: {
        expenseName: result.expenseName,
        expenseCategory: result.expenseCategory,
        expenseAmount: result.expenseAmount,
        expenseDate: result.expenseDate,
        expenseDescription: result.expenseDescription,
        needsReview: result.needsReview,
        fieldConfidence: result.fieldConfidence,
      },
      model: result.model,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    outcome = "failure";
    const category = err instanceof LlmProviderError ? classifyProviderError(err) : CATEGORY.UNAVAILABLE;
    const { status, body } = responseFor(category);
    return res.status(status).json(body);
  } finally {
    recordOperation({
      scope: "sia_expense_parse",
      operation: "parse",
      outcome,
      durationMs: Date.now() - startedAt,
    });
  }
};

module.exports = { parseExpense };
