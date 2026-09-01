// SIA "ask" controller -- POST /sia/ask, the sole SIA endpoint, generic across all 8 supported intents (HEALTH_EXPLANATION, SPENDING_CHANGE_EXPLANATION, BUDGET_STATUS_EXPLANATION, CATEGORY_SPENDING_EXPLANATION, ANOMALY_EXPLANATION, SPENDING_FORECAST_EXPLANATION, FINANCIAL_RISK_EXPLANATION, CURRENT_SPENDING_SUMMARY) via the SYSTEM_PROMPTS_BY_INTENT lookup (question validated to 500 chars, rate-limited per user). Strictly read-only: no DB writes, no direct Mongo/Redis/Expense/Income/Budget/ML-service imports -- contextBuilder.js's buildContext() is the only financial-context boundary used. askLlm() (sia/llmService.js) is a real multi-provider (OpenAI, Gemini, Groq) implementation selected by SIA_LLM_PROVIDER; a provider that is unconfigured or not one of those three still normalizes to a generic 503 by design -- nothing here fabricates a response.
"use strict";

const { isSessionStoreAvailable } = require("../../sia/sessionStoreAvailability");

const config = require("../../sia/config");
const { buildContext } = require("../../sia/contextBuilder");
const { askLlm } = require("../../sia/llmService");
const {
  formatNoDataResponse,
  formatExplanationResponse,
} = require("../../sia/responseFormatter");
const { logSiaEvent, SIA_LOG_EVENTS } = require("../../sia/safeLogger");
const sessionService = require("../../sia/sessionService");
const { validateGroundedAnswer } = require("../../sia/responseValidator");
const idempotencyService = require("../../sia/idempotencyService");
const { isSiaReady } = require("../../sia/readiness");
const { buildGroundingSnapshot } = require("../../sia/groundingService");
const { isValidObjectId } = require("mongoose");
// Semantic routing extends the established deterministic intent path. It
const { runSemanticPipeline } = require("../../sia/semanticPipeline");
const { buildFinancialSnapshot } = require("../../sia/financialSnapshotService");
const { answerDirectly } = require("../../sia/directAnswerService");
const { isClearlyProhibited } = require("../../sia/prohibitedPhrases");

// Bounded conversation session support (additive) -- guarded by sessionStoreAvailability.js's live connection check so pre-existing tests (which don't connect to real MongoDB) never hang; unavailable is a valid, safe state, never thrown.
// Every session-store interaction is best-effort and never fails the user's actual question, and never leaves a half-written turn -- appendTurn() only runs once a real answer exists. Session RESOLUTION and CREATION happen at two different points: an explicit session resolves up front (its history feeds the provider); a new conversation's session isn't created until a validated answer exists, so a failed first turn leaves nothing behind.
async function safeFindOwnedSession(userId, sessionId) {
  if (!isSessionStoreAvailable()) return null;
  try {
    return await sessionService.findOwnedSession(userId, sessionId);
  } catch (_err) {
    return null;
  }
}

// `firstQuestion` is optional, supplied only for a brand-new conversation's first answered turn (see finalizeAnswer()) -- this function never derives/interprets the question itself; sessionService.createSession() owns that (sia/sessionTitle.js).
async function safeCreateSession(userId, firstQuestion) {
  if (!isSessionStoreAvailable()) return null;
  try {
    return await sessionService.createSession(userId, firstQuestion);
  } catch (_err) {
    return null;
  }
}

async function safeAppendTurn(args) {
  if (!isSessionStoreAvailable()) return;
  try {
    await sessionService.appendTurn(args);
  } catch (_err) {
    // Best-effort only -- the response already received is never retracted or altered if history fails to persist.
  }
}

// Loads the bounded recent-turn window for LLM conversational continuity ONLY -- never a source of current financial facts (buildContext() is always called fresh every turn). A failure degrades to "no history this turn", never a failed request.
async function safeLoadRecentTurns(sessionId, userId) {
  if (!isSessionStoreAvailable()) return [];
  try {
    return await sessionService.loadRecentTurns(sessionId, userId);
  } catch (_err) {
    return [];
  }
}

// Maximum accepted question length, measured after trimming -- longer is rejected with 400 before classification, context building, or the provider are reached.
const MAX_QUESTION_LENGTH = 500;

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";
const BUDGET_STATUS_EXPLANATION = "BUDGET_STATUS_EXPLANATION";
const CATEGORY_SPENDING_EXPLANATION = "CATEGORY_SPENDING_EXPLANATION";
// Batch 2: additive only.
const ANOMALY_EXPLANATION = "ANOMALY_EXPLANATION";
const SPENDING_FORECAST_EXPLANATION = "SPENDING_FORECAST_EXPLANATION";
const FINANCIAL_RISK_EXPLANATION = "FINANCIAL_RISK_EXPLANATION";
// Additive only.
const CURRENT_SPENDING_SUMMARY = "CURRENT_SPENDING_SUMMARY";

// Fixed, intent-specific prompts, read-only framing throughout: explain from the supplied context only, never invent facts or claim raw-transaction access. HEALTH_EXPLANATION's context is always the CURRENT health score only (never a historical series), so the prompt forbids decline/change-over-time language -- backed by responseValidator.js's DECLINE_LANGUAGE_PATTERN check.
const HEALTH_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Explain the user's financial-health result using only the supplied " +
  "structured context. Treat the context as authoritative. Do not invent " +
  "facts, recalculate financial values, claim access to raw transactions, " +
  "or suggest that you changed any data. This context reflects only the " +
  "user's CURRENT financial-health score -- describe it as the current " +
  "score, and never as declining, deteriorating, falling, or worsening " +
  "over time. If the context does not support a claim, say so. Keep the " +
  "explanation concise, clear, and non-judgmental.";

// "contributed to"/"accounted for" is the strongest causal language permitted -- context doesn't establish true causality. trends.monthlyTrend is always exactly one current-vs-previous-month comparison, never a series, so the prompt forbids persistent/multi-month framing -- backed by responseValidator.js's PERSISTENCE_LANGUAGE_PATTERN check.
const SPENDING_CHANGE_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Explain the user's spending change using only the supplied structured " +
  "context. Treat the context as authoritative. Describe only the " +
  "changes, comparisons, and contributing categories shown in the " +
  "context. Do not invent causes, intentions, missing transactions, or " +
  "lifestyle explanations. Do not recalculate financial values, claim " +
  "access to raw transactions, or suggest that you changed any data. The " +
  "comparison in this context reflects only the current month versus the " +
  "previous month -- describe it as a change compared with last month, " +
  "and never as a persistent, sustained, long-term, repeated, or " +
  "multi-month trend. If the context does not support a claim, say so. " +
  "Keep the explanation concise, clear, and non-judgmental.";

// Scopes the model to only the fields BUDGET_STATUS_EXPLANATION's context actually carries (budget, spent, remaining, utilization, status, overspend/projection values), and forbids forecasting, affordability/investment/debt advice, or presenting a projection as certain.
const BUDGET_STATUS_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Explain the user's current budget status using only the supplied " +
  "structured context. Treat the context as authoritative. You may " +
  "describe only the configured budget, amount spent, remaining budget, " +
  "utilization, current status, overspending values, and existing " +
  "projection or reliability values explicitly present in the context. " +
  "Do not invent causes, transactions, income, intentions, missing data, " +
  "or lifestyle assumptions. Do not recalculate financial values, create " +
  "forecasts, or present a projection as certain. Do not give " +
  "affordability, investment, debt, or instructions to change financial " +
  "data. If the context does not support a claim, say so. Keep the " +
  "explanation concise, clear, and non-judgmental.";

// Scopes the model to exactly the aggregates CATEGORY_SPENDING_EXPLANATION's context carries, naming their distinct meanings so totals/share/concentration/growth are never conflated; "accounted for" remains the strongest causal language permitted (same standard as SPENDING_CHANGE_SYSTEM_PROMPT).
const CATEGORY_SPENDING_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Answer the user's question about their category spending using only " +
  "the supplied structured context of validated monthly category " +
  "aggregates. Treat the context as authoritative. You may describe only " +
  "the highest and lowest spending categories, each category's total " +
  "amount, each category's share percentage of the distribution, the " +
  "concentration values, and the per-category previous, current, change, " +
  "growth percentage, new-category flag, and trend values explicitly " +
  "present in the context. Keep these distinct: a total amount, a share " +
  "percentage, a concentration value, and a growth value each mean " +
  "different things, so never present one as another. Do not invent " +
  "transactions, merchants, causes, intentions, income, budgets, missing " +
  "categories, or lifestyle assumptions. Do not recalculate financial " +
  "values, rank or re-order categories yourself, draw financial-health " +
  "conclusions, or predict future spending. Do not present a category " +
  "being large or growing as a proven real-world cause -- describe only " +
  "what the context shows. If the context does not support a claim the " +
  "question asks for, say so plainly. Keep the explanation concise, " +
  "clear, and non-judgmental.";

// "rule-detected unusual spending", never "fraud" or any wrongdoing-implying word -- matches expenseAnomalyAnalyzer.js's own framing ("a personal-history observation, not a fraud/wrongdoing signal").
const ANOMALY_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Explain the user's flagged unusual spending using only the supplied " +
  "structured context of rule-detected anomalies. Treat the context as " +
  "authoritative. Describe each flagged expense as unusual relative to the " +
  "user's own category spending history, detected by a fixed statistical " +
  "rule -- never as fraud, theft, error, or any other wrongdoing, and " +
  "never as certain. Do not invent transactions, merchants, causes, or " +
  "intentions beyond what the context shows. Do not recalculate values or " +
  "predict future spending. If the context does not support a claim, say " +
  "so. Keep the explanation concise, clear, and non-judgmental.";

// Every value received is explicitly `isEstimate: true` -- the prompt reinforces that in words and forbids presenting any forecast number as guaranteed or certain.
const FORECAST_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Answer the user's spending forecast question using only the supplied " +
  "structured forecast context. Treat the context as authoritative. Every " +
  "number in the context is a statistical ESTIMATE derived from the " +
  "user's own historical monthly totals, not a guarantee, not a trained " +
  "AI prediction, and not certain -- always describe it as an estimate " +
  "or a range, never as a fact about the future. If a horizon's hasData " +
  "is false, say plainly that there is not enough history for that " +
  "horizon rather than guessing a number. Do not invent transactions, " +
  "income, or spending events, and do not give budgeting, saving, or " +
  "investment advice. Keep the explanation concise, clear, and " +
  "non-judgmental.";

// Risk must be explained FROM the supplied evidence, never as certainty/probability, never as investment/credit/lending/tax/legal advice. Three risk reasonCodes are internal rule names whose plain-English meaning overstates their evidence: FORECASTED_FINANCIAL_PRESSURE's evidence is the CURRENT in-progress month's projection (never next calendar month, per forecastAnalyzer.js); PERSISTENT_SPENDING_GROWTH's evidence is exactly one current-vs-previous-month comparison, never a multi-period trend; DETERIORATING_HEALTH's evidence is the CURRENT score alone, no historical comparison. The prompt below avoids mirroring those reasonCode names into the model's own instructions; responseValidator.js's intent-and-signal-conditional checks are the deterministic backstop.
const RISK_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Explain the user's financial risk using only the supplied structured " +
  "context of rule-detected risk signals and their evidence. Treat the " +
  "context as authoritative. Describe only the specific signals and " +
  "evidence present (for example, an overspent or nearly-exhausted " +
  "budget, a month-over-month increase in spending, unusual expenses, a " +
  "current-month spending projection nearing or exceeding the budget, or " +
  "a low financial-health score) -- never invent a risk that has no " +
  "corresponding signal, and never state a risk as a certainty or a " +
  "numeric probability/percentage chance. A signal about a spending " +
  "projection compares projected spending for the CURRENT, in-progress " +
  "month (or projected month-end spending) against the configured budget " +
  "-- describe it as projected spending for this month that may reach or " +
  "exceed the configured budget, and never as a forecast or pressure for " +
  "next month or any future calendar month. A signal about increased " +
  "spending proves only that spending is higher than the previous month " +
  "-- describe it as spending that increased compared with last month, " +
  "and never as persistent, sustained, long-term, repeated, or " +
  "multi-month growth. A signal about a low financial-health score " +
  "proves only that the CURRENT score is low -- describe the current " +
  "financial-health score as low, and never as declining, deteriorating, " +
  "falling, or worsening over time. If riskLevel is \"none\" or there are " +
  "no signals, say plainly that no active risk signals were detected " +
  "from the currently available data -- never present this as proof that " +
  "the user has no financial risk. Do not give investment, credit, " +
  "lending, tax, or legal advice, and do not instruct the user to take a " +
  "specific financial action. Keep the explanation concise, clear, and " +
  "non-judgmental.";

// Scopes the model to exactly the one figure CURRENT_SPENDING_SUMMARY's
const CURRENT_SPENDING_SUMMARY_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Answer the user's question about their current month's total spending " +
  "using only the supplied structured context, which contains exactly one " +
  "value: the current month's total amount spent so far. Treat the " +
  "context as authoritative. State that total directly and concisely. Do " +
  "not recalculate it, round it differently, or derive a different figure " +
  "from it. Do not invent or imply a comparison with a previous month or " +
  "any change over time, a category-level breakdown, a forecast or future " +
  "spending estimate, or any individual transaction, merchant, or expense " +
  "detail -- none of that data was supplied. Do not give financial, tax, " +
  "legal, or investment advice, and do not suggest what the user should " +
  "do with their money. If the context does not contain the total, say " +
  "plainly that you do not have enough data to answer. Keep the answer " +
  "brief, clear, and non-judgmental.";

const SYSTEM_PROMPTS_BY_INTENT = {
  [HEALTH_EXPLANATION]: HEALTH_SYSTEM_PROMPT,
  [SPENDING_CHANGE_EXPLANATION]: SPENDING_CHANGE_SYSTEM_PROMPT,
  [BUDGET_STATUS_EXPLANATION]: BUDGET_STATUS_SYSTEM_PROMPT,
  [CATEGORY_SPENDING_EXPLANATION]: CATEGORY_SPENDING_SYSTEM_PROMPT,
  [ANOMALY_EXPLANATION]: ANOMALY_SYSTEM_PROMPT,
  [SPENDING_FORECAST_EXPLANATION]: FORECAST_SYSTEM_PROMPT,
  [FINANCIAL_RISK_EXPLANATION]: RISK_SYSTEM_PROMPT,
  [CURRENT_SPENDING_SUMMARY]: CURRENT_SPENDING_SUMMARY_SYSTEM_PROMPT,
};

// Deliberately the same generic body for every failure/unavailable path -- never exposes LlmProviderError details, stack traces, provider names, questions, prompts, financial context, or raw exceptions.
const UNAVAILABLE_RESPONSE = {
  success: false,
  message: "SIA is temporarily unavailable.",
};

// Stable conflict contract -- both carry a machine-readable `code` so a client can distinguish "reused key for a different request" (not retryable) from "original request still running" (retryable shortly).
const IDEMPOTENCY_CONFLICT_RESPONSE = {
  success: false,
  code: "SIA_IDEMPOTENCY_CONFLICT",
  message: "This clientMessageId was already used for a different request.",
};

const REQUEST_IN_PROGRESS_RESPONSE = {
  success: false,
  code: "SIA_REQUEST_IN_PROGRESS",
  message: "This request is still being processed. Please retry shortly.",
};

const SESSION_NOT_FOUND_RESPONSE = {
  success: false,
  message: "Session not found.",
};

// Mirrors models/SiaRequest.js's and models/SiaMessage.js's own ceiling.
const MAX_CLIENT_MESSAGE_ID_LENGTH = 100;

// Validates the optional idempotency key; returns {ok, value} or {ok:false, message}. Omission stays fully supported for backward compatibility -- simply carries no idempotency guarantee.
function parseClientMessageId(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== "string") {
    return { ok: false, message: "clientMessageId must be a string" };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, message: "clientMessageId must not be empty" };
  }
  if (trimmed.length > MAX_CLIENT_MESSAGE_ID_LENGTH) {
    return {
      ok: false,
      message: `clientMessageId must be ${MAX_CLIENT_MESSAGE_ID_LENGTH} characters or fewer`,
    };
  }
  return { ok: true, value: trimmed };
}

// Validates the optional session id -- a malformed id is an explicit 400 rather than silently starting a new session, which would hide client bugs.
function parseSessionId(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw !== "string") {
    return { ok: false, message: "sessionId must be a string" };
  }
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, message: "sessionId must not be empty" };
  }
  if (!isValidObjectId(trimmed)) {
    return { ok: false, message: "sessionId is not a valid identifier" };
  }
  return { ok: true, value: trimmed };
}

// Completes a request that already has a validated answer: creates the session if this is a brand-new conversation (deferred to here so a failed turn never leaves an empty one), appends the user/assistant pair, records the payload for replay. Shared by the normal success path and the `answer_ready` recovery path -- neither calls the provider from here.
async function finalizeAnswer({ req, reservation, activeSession, intent, answer, clientMessageId, grounding }) {
  // Captured BEFORE `session` is mutated below, true only for a genuinely brand-new conversation -- gates automatic-title derivation to exactly the first answered turn, written in the same SiaSession.create() call. The question is safe to pass here even on a resumed ANSWER_READY completion: reserveRequest()/evaluateExisting() already rejected any fingerprint mismatch as a 409, so this is provably the same question.
  const isNewSession = !activeSession;
  let session = activeSession;
  if (!session) {
    session = await safeCreateSession(req.userId, isNewSession ? req.body.question.trim() : undefined);
  }

  if (session) {
    await safeAppendTurn({
      sessionId: session._id,
      userId: req.userId,
      question: req.body.question.trim(),
      intent,
      answer,
      providerMetadata: { provider: config.provider },
      clientMessageId,
      grounding,
    });
  }

  const payload = formatExplanationResponse(intent, answer, grounding);
  if (session) payload.sessionId = String(session._id);

  if (reservation) {
    await idempotencyService.markCompleted({
      requestId: reservation.record._id,
      ownerToken: reservation.ownerToken,
      responseStatus: 200,
      responsePayload: payload,
      sessionId: session ? session._id : null,
    });
  }

  return { status: 200, payload };
}

// Workstream 1 -- runs the EXISTING, UNCHANGED deterministic-intent
async function answerExplanationIntentForSemanticPath(userId, explanationIntent, question) {
  const contextResult = await buildContext(userId, explanationIntent);

  if (!contextResult || contextResult.fields === null || contextResult.reason === "no_data") {
    return { usedAnswerCall: false, kind: "no_data" };
  }

  const grounding = buildGroundingSnapshot(contextResult);
  const startedAt = Date.now();

  let llmResult;
  try {
    llmResult = await askLlm({
      systemPrompt: SYSTEM_PROMPTS_BY_INTENT[explanationIntent],
      context: contextResult,
      question,
      history: [],
    });
  } catch (providerErr) {
    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED,
      provider: config.provider,
      errorCode: providerErr && providerErr.code,
      latencyMs: Date.now() - startedAt,
    });
    return { usedAnswerCall: true, kind: "failed" };
  }

  if (!llmResult || typeof llmResult.answer !== "string" || llmResult.answer.trim() === "") {
    return { usedAnswerCall: true, kind: "failed" };
  }

  const validation = validateGroundedAnswer({
    intent: explanationIntent,
    answer: llmResult.answer,
    contextFields: contextResult.fields,
  });
  if (!validation.valid) {
    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED,
      provider: config.provider,
      errorCode: `GROUNDING_${validation.reasonCode}`,
      latencyMs: Date.now() - startedAt,
    });
    return { usedAnswerCall: true, kind: "failed" };
  }

  logSiaEvent({
    event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED,
    provider: config.provider,
    latencyMs: Date.now() - startedAt,
  });

  return { usedAnswerCall: true, kind: "answer", answer: llmResult.answer, grounding };
}

// Bounded, server-authored clarification response -- the client-visible
const MAX_CLARIFICATION_RESPONSE_OPTIONS = 5;
function formatClarificationResponse(clarification) {
  return {
    success: true,
    clarification: {
      prompt: clarification.prompt,
      options: clarification.options.slice(0, MAX_CLARIFICATION_RESPONSE_OPTIONS),
    },
  };
}

// The generic, safe-logging-preserving no-data shape for the semantic
function formatSemanticNoDataResponse() {
  return {
    success: true,
    answer: "I do not have enough data to answer that yet.",
    basedOn: ["none"],
  };
}

// Router/model/grounding/query-execution failures are service failures, not
function isSemanticUnavailableReason(reasonCode) {
  if (typeof reasonCode !== "string") return false;
  return [
    "ROUTER_CALL_FAILED",
    "MALFORMED_ROUTER_RESPONSE",
    "INVALID_RESUME_PLAN",
    "QUERY_EXECUTOR_UNAVAILABLE",
    "FINANCIAL_QUERY_FAILED",
    "PROVIDER_FAILED",
    "MALFORMED_ANSWER_RESPONSE",
  ].includes(reasonCode) || reasonCode.startsWith("GROUNDING_");
}

// Legacy semantic fallback retained for existing stored request recovery.
async function handleSemanticFallback({ req, res, reservation, activeSession, requestedClientMessageId, trimmedQuestion }) {
  try {
    const previousPlanSummary = activeSession
      ? await (async () => {
          if (!isSessionStoreAvailable()) return null;
          try {
            return await sessionService.loadLastPlanSummary(activeSession._id, req.userId);
          } catch (_err) {
            return null;
          }
        })()
      : null;

    const pipelineResult = await runSemanticPipeline({
      question: trimmedQuestion,
      userId: req.userId,
      previousPlanSummary,
      existingIntentHandler: (explanationIntent) =>
        answerExplanationIntentForSemanticPath(req.userId, explanationIntent, trimmedQuestion),
      // Idempotency checkpoint: persists the plan BEFORE any
      onPlanResolved: reservation
        ? async (plan) => {
            await idempotencyService.saveRoutingCheckpoint({
              requestId: reservation.record._id,
              ownerToken: reservation.ownerToken,
              planCheckpoint: plan,
            });
          }
        : undefined,
    });

    if (pipelineResult.kind === "unsupported") {
      if (reservation) {
        await idempotencyService.releaseRequest({
          requestId: reservation.record._id,
          ownerToken: reservation.ownerToken,
        });
      }
      if (isSemanticUnavailableReason(pipelineResult.reasonCode)) {
        return res.status(503).json(UNAVAILABLE_RESPONSE);
      }
      return res.status(422).json({
        success: false,
        message: "Question not recognized for the intents SIA currently supports.",
      });
    }

    if (pipelineResult.kind === "no_data") {
      const noDataResponse = formatSemanticNoDataResponse();
      if (activeSession) noDataResponse.sessionId = String(activeSession._id);
      if (reservation) {
        await idempotencyService.markCompleted({
          requestId: reservation.record._id,
          ownerToken: reservation.ownerToken,
          responseStatus: 200,
          responsePayload: noDataResponse,
          sessionId: activeSession ? activeSession._id : null,
        });
      }
      return res.status(200).json(noDataResponse);
    }

    if (pipelineResult.kind === "clarification") {
      const payload = formatClarificationResponse(pipelineResult.plan.clarification);
      if (activeSession) payload.sessionId = String(activeSession._id);
      if (reservation) {
        await idempotencyService.markCompleted({
          requestId: reservation.record._id,
          ownerToken: reservation.ownerToken,
          responseStatus: 200,
          responsePayload: payload,
          sessionId: activeSession ? activeSession._id : null,
        });
      }
      return res.status(200).json(payload);
    }

    if (pipelineResult.kind === "explanation_intent_delegated") {
      const delegated = pipelineResult.result;

      if (!delegated || delegated.kind === "no_data") {
        const noDataResponse = formatNoDataResponse(pipelineResult.intent);
        if (activeSession) noDataResponse.sessionId = String(activeSession._id);
        if (reservation) {
          await idempotencyService.markCompleted({
            requestId: reservation.record._id,
            ownerToken: reservation.ownerToken,
            responseStatus: 200,
            responsePayload: noDataResponse,
            sessionId: activeSession ? activeSession._id : null,
          });
        }
        return res.status(200).json(noDataResponse);
      }

      if (delegated.kind === "failed") {
        if (reservation) {
          await idempotencyService.releaseRequest({
            requestId: reservation.record._id,
            ownerToken: reservation.ownerToken,
          });
        }
        return res.status(503).json(UNAVAILABLE_RESPONSE);
      }

      const finished = await finalizeAnswer({
        req,
        reservation,
        activeSession,
        intent: pipelineResult.intent,
        answer: delegated.answer,
        clientMessageId: requestedClientMessageId,
        grounding: delegated.grounding,
      });
      return res.status(finished.status).json(finished.payload);
    }

    if (pipelineResult.kind === "answer") {
      let session = activeSession;
      if (!session) {
        session = await safeCreateSession(req.userId, trimmedQuestion);
      }

      if (session) {
        await safeAppendTurn({
          sessionId: session._id,
          userId: req.userId,
          question: trimmedQuestion,
          intent: null,
          answer: pipelineResult.answer,
          providerMetadata: { provider: config.provider },
          clientMessageId: requestedClientMessageId,
          grounding: pipelineResult.grounding,
          planSummary: pipelineResult.planSummary,
        });
      }

      const payload = {
        success: true,
        answer: pipelineResult.answer,
        grounding: pipelineResult.grounding,
        interpretation: pipelineResult.interpretation,
      };
      if (session) payload.sessionId = String(session._id);

      if (reservation) {
        await idempotencyService.markCompleted({
          requestId: reservation.record._id,
          ownerToken: reservation.ownerToken,
          responseStatus: 200,
          responsePayload: payload,
          sessionId: session ? session._id : null,
        });
      }

      return res.status(200).json(payload);
    }

    // Unreachable under semanticPipeline.js's documented contract -- kept
    // as an explicit, safe fallback rather than an unhandled case.
    if (reservation) {
      await idempotencyService.releaseRequest({
        requestId: reservation.record._id,
        ownerToken: reservation.ownerToken,
      });
    }
    return res.status(422).json({
      success: false,
      message: "Question not recognized for the intents SIA currently supports.",
    });
  } catch (_err) {
    if (reservation) {
      try {
        await idempotencyService.releaseRequest({
          requestId: reservation.record._id,
          ownerToken: reservation.ownerToken,
        });
      } catch (_releaseErr) {
        // Best-effort -- the lease's own expiry is the backstop.
      }
    }
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
}

async function handleDirectAnswer({ req, res, reservation, activeSession, requestedClientMessageId, trimmedQuestion }) {
  try {
    if (isClearlyProhibited(trimmedQuestion)) {
      if (reservation) {
        await idempotencyService.releaseRequest({ requestId: reservation.record._id, ownerToken: reservation.ownerToken });
      }
      return res.status(422).json({ success: false, message: "That request is outside SIA's financial-data scope." });
    }

    const snapshotResult = await buildFinancialSnapshot(req.userId, { timeZone: config.appTimeZone });
    if (!snapshotResult.ok) {
      if (reservation) {
        await idempotencyService.releaseRequest({ requestId: reservation.record._id, ownerToken: reservation.ownerToken });
      }
      return res.status(503).json(UNAVAILABLE_RESPONSE);
    }

    const recentTurns = activeSession ? await safeLoadRecentTurns(activeSession._id, req.userId) : [];
    const providerStartedAt = Date.now();
    let directResult;
    try {
      directResult = await answerDirectly({ question: trimmedQuestion, snapshot: snapshotResult.snapshot, history: recentTurns });
    } catch (providerErr) {
      logSiaEvent({
        event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED,
        provider: config.provider,
        errorCode: providerErr && providerErr.code,
        latencyMs: Date.now() - providerStartedAt,
      });
      throw providerErr;
    }

    if (!directResult.ok) {
      logSiaEvent({
        event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED,
        provider: config.provider,
        errorCode: `DIRECT_ANSWER_${directResult.reasonCode || "REJECTED"}`,
        latencyMs: Date.now() - providerStartedAt,
      });
      if (reservation) {
        await idempotencyService.releaseRequest({ requestId: reservation.record._id, ownerToken: reservation.ownerToken });
      }
      return res.status(503).json(UNAVAILABLE_RESPONSE);
    }

    logSiaEvent({ event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED, provider: config.provider, latencyMs: Date.now() - providerStartedAt });
    const grounding = {
      sources: [{ key: "financialReport", label: "Financial report", period: snapshotResult.snapshot.period.label }],
    };
    if (reservation) {
      await idempotencyService.markAnswerReady({
        requestId: reservation.record._id,
        ownerToken: reservation.ownerToken,
        answer: directResult.answer,
        intent: null,
        sessionId: activeSession ? activeSession._id : null,
        grounding,
      });
    }

    let session = activeSession;
    if (!session) session = await safeCreateSession(req.userId, trimmedQuestion);
    if (session) {
      await safeAppendTurn({
        sessionId: session._id,
        userId: req.userId,
        question: trimmedQuestion,
        intent: null,
        answer: directResult.answer,
        providerMetadata: { provider: config.provider },
        clientMessageId: requestedClientMessageId,
        grounding,
      });
    }

    const payload = { success: true, answer: directResult.answer, grounding };
    if (session) payload.sessionId = String(session._id);
    if (reservation) {
      await idempotencyService.markCompleted({
        requestId: reservation.record._id,
        ownerToken: reservation.ownerToken,
        responseStatus: 200,
        responsePayload: payload,
        sessionId: session ? session._id : null,
      });
    }
    return res.status(200).json(payload);
  } catch (_err) {
    if (reservation) {
      try {
        await idempotencyService.releaseRequest({ requestId: reservation.record._id, ownerToken: reservation.ownerToken });
      } catch (_releaseErr) {
        // Lease expiry keeps the idempotency key recoverable.
      }
    }
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
}

const ask = async (req, res) => {
  // Readiness gate: isSiaReady() (sia/readiness.js) is the SAME function GET /sia/status answers with, so the two can never disagree. Rejection is the pre-existing generic 503, happening BEFORE any validation, classification, context build, provider call, session creation, or reservation -- an unready deployment does no work and leaves no trace.
  if (!isSiaReady()) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }

  const { question, sessionId, clientMessageId } = req.body || {};

  if (typeof question !== "string" || question.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "question is required",
    });
  }

  const trimmedQuestion = question.trim();

  if (trimmedQuestion.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `question must be ${MAX_QUESTION_LENGTH} characters or fewer`,
    });
  }

  const parsedClientMessageId = parseClientMessageId(clientMessageId);
  if (!parsedClientMessageId.ok) {
    return res.status(400).json({ success: false, message: parsedClientMessageId.message });
  }
  const requestedClientMessageId = parsedClientMessageId.value;

  const parsedSessionId = parseSessionId(sessionId);
  if (!parsedSessionId.ok) {
    return res.status(400).json({ success: false, message: parsedSessionId.message });
  }
  const requestedSessionId = parsedSessionId.value;

  // A keyed request whose coordination store is unreachable CANNOT be made idempotent -- failing closed here (before the provider is called) avoids handing the client a false guarantee, which is exactly how a retry storm produces duplicate LLM charges.
  if (requestedClientMessageId && !isSessionStoreAvailable()) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }

  // THE reservation -- deliberately before session creation, intent classification, context building, and askLlm; this ordering is the fix for a prior defect where clientMessageId was only consulted inside appendTurn, long after the provider had already been called.
  let reservation = null;
  if (requestedClientMessageId) {
    try {
      reservation = await idempotencyService.reserveRequest({
        userId: req.userId,
        clientMessageId: requestedClientMessageId,
        question: trimmedQuestion,
        requestedSessionId,
      });
    } catch (_err) {
      return res.status(503).json(UNAVAILABLE_RESPONSE);
    }

    if (reservation.outcome === idempotencyService.OUTCOME.CONFLICT) {
      return res.status(409).json(IDEMPOTENCY_CONFLICT_RESPONSE);
    }

    if (reservation.outcome === idempotencyService.OUTCOME.REPLAY_COMPLETED) {
      // Verbatim replay of the already-returned payload -- no classifier, context build, provider call, validation, or appendTurn.
      return res
        .status(reservation.record.responseStatus || 200)
        .json(reservation.record.responsePayload);
    }

    if (reservation.outcome === idempotencyService.OUTCOME.IN_PROGRESS) {
      const completed = await idempotencyService.awaitCompletedResponse({
        userId: req.userId,
        clientMessageId: requestedClientMessageId,
      });
      if (completed) {
        return res.status(completed.responseStatus || 200).json(completed.responsePayload);
      }
      // Still running at the safe limit -- a follower must NEVER fall through into calling the provider itself.
      return res.status(409).json(REQUEST_IN_PROGRESS_RESPONSE);
    }

    if (reservation.outcome === idempotencyService.OUTCOME.RESUME_ANSWER_READY) {
      // A validated answer already exists from a prior attempt whose persistence did not finish -- complete it without a second provider call.
      try {
        const resumeSession = reservation.record.session
          ? await safeFindOwnedSession(req.userId, String(reservation.record.session))
          : null;
        const finished = await finalizeAnswer({
          req,
          reservation,
          activeSession: resumeSession,
          intent: reservation.record.intent,
          answer: reservation.record.answer,
          clientMessageId: requestedClientMessageId,
          // The SAME snapshot committed at markAnswerReady() time for the original attempt -- never recomputed from the user's current, possibly since-changed analytics.
          grounding: reservation.record.grounding || undefined,
        });
        return res.status(finished.status).json(finished.payload);
      } catch (_err) {
        return res.status(503).json(UNAVAILABLE_RESPONSE);
      }
    }
  }

  // Resolve an explicitly-supplied session BEFORE the provider call, since its bounded history feeds the LLM. A valid-but-unknown/foreign id is an explicit, non-disclosing 404 -- never a silently substituted brand-new session.
  let activeSession = null;
  if (requestedSessionId) {
    activeSession = await safeFindOwnedSession(req.userId, requestedSessionId);
    if (!activeSession) {
      if (reservation) {
        await idempotencyService.releaseRequest({
          requestId: reservation.record._id,
          ownerToken: reservation.ownerToken,
        });
      }
      return res.status(404).json(SESSION_NOT_FOUND_RESPONSE);
    }
  }

  return handleDirectAnswer({
    req,
    res,
    reservation,
    activeSession,
    requestedClientMessageId,
    trimmedQuestion,
  });

  /* Legacy intent-specific path retained for request compatibility. */
  try {
    // req.userId comes only from verifyToken (Middlewares/Auth.js), which ran before this controller -- the sole identity ever passed into buildContext; req.body/query/params are never read for a userId. The canonical Report is fetched fresh every turn -- conversation history is never a substitute source of current facts.
    const contextResult = await buildContext(req.userId, intent);

    if (!contextResult || contextResult.fields === null || contextResult.reason === "no_data") {
      // No provider call happens on this path, and no session is created for a brand-new conversation either -- there's no turn to store, and an empty conversation would be noise. An EXISTING session still reports its id.
      const noDataResponse = formatNoDataResponse(intent);
      if (activeSession) noDataResponse.sessionId = String(activeSession._id);

      // Recorded as completed so a retry with the same key replays this exact 200 rather than re-running context building.
      if (reservation) {
        await idempotencyService.markCompleted({
          requestId: reservation.record._id,
          ownerToken: reservation.ownerToken,
          responseStatus: 200,
          responsePayload: noDataResponse,
          sessionId: activeSession ? activeSession._id : null,
        });
      }

      return res.status(200).json(noDataResponse);
    }

    // Computed from the EXACT contextResult sent to the provider below -- never from the intent alone, the classifier's selection, or by parsing the provider's answer/prompt -- which is why this happens immediately after buildContext() succeeds, not after askLlm() returns.
    const grounding = buildGroundingSnapshot(contextResult);

    // Bounded recent-turn history, for conversational continuity ONLY -- buildContext() already fetched the current report fresh regardless of what loads here. See llmService.js's buildHistoryMessages() for how this stays structurally unable to override the system prompt.
    const recentTurns = activeSession ? await safeLoadRecentTurns(activeSession._id, req.userId) : [];

    const providerStartedAt = Date.now();
    let llmResult;
    try {
      llmResult = await askLlm({
        systemPrompt: SYSTEM_PROMPTS_BY_INTENT[intent],
        context: contextResult,
        question: trimmedQuestion,
        history: recentTurns,
      });
    } catch (providerErr) {
      // Exactly one failure record per provider attempt -- never logged again by the outer catch. Only the normalized error code and provider identifier are passed; the caught error itself is never logged and is always rethrown unchanged.
      logSiaEvent({
        event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED,
        provider: config.provider,
        errorCode: providerErr && providerErr.code,
        latencyMs: Date.now() - providerStartedAt,
      });
      throw providerErr;
    }

    if (!llmResult || typeof llmResult.answer !== "string" || llmResult.answer.trim() === "") {
      // Defensive: a resolved-but-unusable provider result is treated the same as a rejection -- unreachable under the current stub, but required for when a real provider exists. Not logged as a normalized-code failure since no LlmProviderError was thrown.
      return res.status(503).json(UNAVAILABLE_RESPONSE);
    }

    // Grounded-response validation is a real deterministic gate, not just a system-prompt instruction (see responseValidator.js). A failed check is treated exactly like a failed provider result: the generic 503, never a partially-shown or rewritten answer. contextResult.fields is the exact structured context this answer was grounded in.
    const validation = validateGroundedAnswer({
      intent,
      answer: llmResult.answer,
      contextFields: contextResult.fields,
    });
    if (!validation.valid) {
      logSiaEvent({
        event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED,
        provider: config.provider,
        errorCode: `GROUNDING_${validation.reasonCode}`,
        latencyMs: Date.now() - providerStartedAt,
      });
      throw new Error("GROUNDING_REJECTED");
    }

    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED,
      provider: config.provider,
      latencyMs: Date.now() - providerStartedAt,
    });

    // The durable checkpoint: the validated answer is committed BEFORE any session write, so if persistence fails, a retry with the same key resumes from this stored answer instead of paying for a second provider call.
    if (reservation) {
      await idempotencyService.markAnswerReady({
        requestId: reservation.record._id,
        ownerToken: reservation.ownerToken,
        answer: llmResult.answer,
        intent,
        sessionId: activeSession ? activeSession._id : null,
        grounding,
      });
    }

    // Persisted only now that a real, usable answer exists -- a failed request never reaches this line, so it can never leave a half-written turn behind. Best-effort: a persistence failure here does not alter or retract the response already computed.
    const finished = await finalizeAnswer({
      req,
      reservation,
      activeSession,
      intent,
      answer: llmResult.answer,
      clientMessageId: requestedClientMessageId,
      grounding,
    });
    return res.status(finished.status).json(finished.payload);
  } catch (err) {
    // Release the reservation so a provider or grounding failure never permanently poisons the key -- a retry is treated as a fresh, properly-owned attempt. Only runs for failures BEFORE markAnswerReady committed; once an answer is stored, a retry resumes from it instead.
    if (reservation) {
      try {
        await idempotencyService.releaseRequest({
          requestId: reservation.record._id,
          ownerToken: reservation.ownerToken,
        });
      } catch (_releaseErr) {
        // Best-effort -- the lease's own expiry is the backstop that keeps the key retryable even if this release fails.
      }
    }
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
};

module.exports = {
  ask,
};
