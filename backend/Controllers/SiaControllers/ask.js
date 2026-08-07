// SIA "ask" controller.
//
// M2-1 scope: the first authenticated SIA route, HEALTH_EXPLANATION intent
// only. Strictly read-only -- no database writes, no direct MongoDB,
// Redis, Expense, Income, Budget, analytics, or ML-service imports.
// backend/sia/contextBuilder.js's buildContext() is the only financial-
// context boundary this controller uses.
//
// Because no real LLM provider is selected or implemented yet (M1-3 is a
// provider-neutral stub that always rejects), a production request that
// reaches askLlm() will always end up at the generic 503 branch below.
// This is expected and correct for this milestone -- see
// backend/sia/llmService.js's own documentation. Nothing here fabricates a
// response to make the endpoint appear more capable than it is.
"use strict";

const config = require("../../sia/config");
const { classifyIntent } = require("../../sia/intentClassifier");
const { buildContext } = require("../../sia/contextBuilder");
const { askLlm } = require("../../sia/llmService");
const {
  formatNoDataResponse,
  formatHealthExplanationResponse,
} = require("../../sia/responseFormatter");

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";

// Minimum orchestration prompt required for this milestone -- not final
// prompt-engineering work. Read-only framing: explain using only the
// supplied structured context, never invent facts, never claim access to
// raw transactions, never suggest data was changed.
const SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Explain the user's financial-health result using only the supplied " +
  "structured context. Treat the context as authoritative. Do not invent " +
  "facts, recalculate financial values, claim access to raw transactions, " +
  "or suggest that you changed any data. If the context does not support " +
  "a claim, say so. Keep the explanation concise, clear, and " +
  "non-judgmental.";

// Deliberately the same generic body for every failure/unavailable path
// below (disabled SIA, a rejected buildContext call, a rejected askLlm
// call, or an unusable provider result) -- never exposes
// LlmProviderError details, stack traces, provider names, questions,
// prompts, financial context, or raw exceptions.
const UNAVAILABLE_RESPONSE = {
  success: false,
  message: "SIA is temporarily unavailable.",
};

const ask = async (req, res) => {
  if (!config.enabled) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }

  const { question } = req.body || {};

  if (typeof question !== "string" || question.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "question is required",
    });
  }

  const trimmedQuestion = question.trim();

  const intent = classifyIntent(trimmedQuestion);
  if (intent !== HEALTH_EXPLANATION) {
    return res.status(422).json({
      success: false,
      message: "Question not recognized for the intents SIA currently supports.",
    });
  }

  try {
    // req.userId comes only from verifyToken (Middlewares/Auth.js), which
    // ran before this controller. This is the sole identity ever passed
    // into buildContext -- req.body/req.query/route params are never read
    // for a userId anywhere in this controller.
    const contextResult = await buildContext(req.userId, HEALTH_EXPLANATION);

    if (!contextResult || contextResult.fields === null || contextResult.reason === "no_data") {
      return res.status(200).json(formatNoDataResponse());
    }

    const llmResult = await askLlm({
      systemPrompt: SYSTEM_PROMPT,
      context: contextResult,
      question: trimmedQuestion,
    });

    if (!llmResult || typeof llmResult.answer !== "string" || llmResult.answer.trim() === "") {
      // Defensive: a resolved-but-unusable provider result is treated the
      // same as a rejection. Unreachable under the current M1-3 stub
      // (which never resolves), but required by this milestone's
      // controller-flow contract for when a real provider exists.
      return res.status(503).json(UNAVAILABLE_RESPONSE);
    }

    return res.status(200).json(formatHealthExplanationResponse(llmResult.answer));
  } catch (err) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
};

module.exports = {
  ask,
};
