// SIA "ask" controller.
//
// M2-1 scope: the first authenticated SIA route, HEALTH_EXPLANATION intent
// only.
// M2-2 scope: generalizes the same route/controller to a second intent,
// SPENDING_CHANGE_EXPLANATION -- the exact identifier already established
// by backend/sia/contextBuilder.js's M1-2 implementation. No new route was
// added; POST /sia/ask remains the only SIA endpoint.
// M2-3 scope: adds a third intent, BUDGET_STATUS_EXPLANATION -- the exact
// identifier already established by backend/sia/contextBuilder.js's
// M2-3A implementation. The controller's flow was already fully generic
// by intent as of M2-2 (no per-intent branching beyond the
// SYSTEM_PROMPTS_BY_INTENT lookup), so this milestone only adds the new
// prompt and map entry below -- still no new route, no new endpoint.
// M2-4B scope: adds a fourth intent, CATEGORY_SPENDING_EXPLANATION -- the
// exact identifier already established by
// backend/sia/contextBuilder.js's M2-4A implementation. Same as M2-3:
// only a new prompt and map entry, no controller-flow change, no new
// route, no new endpoint.
// M3-1 scope: hardens the pre-existing question validation with a maximum
// length (500 chars, measured after trimming); adds a dedicated,
// req.userId-keyed rate limiter (Routes/sia.routes.js's siaLimiter) in
// front of this controller. No change to the classifier/context/provider
// contracts, and unsupported-question 422 behavior is unchanged.
// M3-3 scope: wraps only the askLlm() call with safe structured logging
// (backend/sia/safeLogger.js) -- exactly one "provider_request_completed"
// or "provider_request_failed" record per provider attempt, carrying only
// the normalized provider identifier, the normalized error code, and an
// elapsed-time measurement taken locally in this controller. A caught
// provider error is always rethrown unchanged immediately after logging,
// so the existing outer catch's generic 503 response is byte-for-byte
// unchanged. No new field, response shape, or status code is introduced.
//
// Strictly read-only -- no database writes, no direct MongoDB, Redis,
// Expense, Income, Budget, analytics, or ML-service imports.
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

const { isSessionStoreAvailable } = require("../../sia/sessionStoreAvailability");

const config = require("../../sia/config");
const { classifyIntent } = require("../../sia/intentClassifier");
const { buildContext } = require("../../sia/contextBuilder");
const { askLlm } = require("../../sia/llmService");
const {
  formatNoDataResponse,
  formatExplanationResponse,
} = require("../../sia/responseFormatter");
const { logSiaEvent, SIA_LOG_EVENTS } = require("../../sia/safeLogger");
const sessionService = require("../../sia/sessionService");
const { validateGroundedAnswer } = require("../../sia/responseValidator");

// Batch 2: bounded conversation session support, additive only.
//
// Guarded by sia/sessionStoreAvailability.js's live Mongoose connection
// check rather than always attempted: none of the pre-existing SIA test
// suites connect to a real MongoDB (they mock
// config/intentClassifier/contextBuilder/llmService only), so an
// unconditional session lookup/write would hang those tests against a
// disconnected/buffering Mongoose connection. Checking availability first
// means the session feature behaves exactly like any other optional-data
// boundary in this codebase: unavailable is a valid, safe state, never a
// thrown error, and the pre-existing question/answer contract is
// completely unaffected when it is unavailable. In production (a
// connected database) this is always true and the feature is fully
// active. See tests/sia.ask.activeSession.test.js for the connected-state
// proof (achieved by mocking sessionStoreAvailability.js itself, never by
// mutating the real global mongoose connection).

// Every session-store interaction is best-effort: a failure here must
// never fail the user's actual question, and must never leave a
// half-written turn (a question persisted with no matching answer, or vice
// versa) -- appendTurn() is only ever called once a real, usable answer
// already exists, and both of its writes happen together.
async function safeGetOrCreateSession(userId, sessionId) {
  if (!isSessionStoreAvailable()) return null;
  try {
    return await sessionService.getOrCreateSession(userId, sessionId);
  } catch (_err) {
    return null;
  }
}

async function safeAppendTurn(args) {
  if (!isSessionStoreAvailable()) return;
  try {
    await sessionService.appendTurn(args);
  } catch (_err) {
    // Best-effort only -- the response the user already received is not
    // retracted or altered because history could not be persisted.
  }
}

// Loads the bounded recent-turn window for LLM conversational continuity
// ONLY -- never a source of current financial facts (buildContext() above
// is always called fresh, every turn, regardless of whether history loaded
// successfully). A failure here degrades to "no history this turn", never
// a failed request -- the user still gets a real, freshly-grounded answer.
async function safeLoadRecentTurns(sessionId, userId) {
  if (!isSessionStoreAvailable()) return [];
  try {
    return await sessionService.loadRecentTurns(sessionId, userId);
  } catch (_err) {
    return [];
  }
}

// M3-1: the maximum accepted question length, measured after trimming.
// Exactly this many characters remains valid; anything longer is rejected
// with 400 before intent classification, context building, or the provider
// are ever reached.
const MAX_QUESTION_LENGTH = 500;

const HEALTH_EXPLANATION = "HEALTH_EXPLANATION";
const SPENDING_CHANGE_EXPLANATION = "SPENDING_CHANGE_EXPLANATION";
const BUDGET_STATUS_EXPLANATION = "BUDGET_STATUS_EXPLANATION";
const CATEGORY_SPENDING_EXPLANATION = "CATEGORY_SPENDING_EXPLANATION";
// Batch 2: additive only.
const ANOMALY_EXPLANATION = "ANOMALY_EXPLANATION";
const SPENDING_FORECAST_EXPLANATION = "SPENDING_FORECAST_EXPLANATION";
const FINANCIAL_RISK_EXPLANATION = "FINANCIAL_RISK_EXPLANATION";

// Minimum orchestration prompts required for this milestone -- not final
// prompt-engineering work. Each is fixed and intent-specific; a small
// intent-keyed map is enough now that two intents exist, not a prompt-
// engineering framework. Read-only framing throughout: explain using only
// the supplied structured context, never invent facts, never claim access
// to raw transactions, never suggest data was changed.
const HEALTH_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Explain the user's financial-health result using only the supplied " +
  "structured context. Treat the context as authoritative. Do not invent " +
  "facts, recalculate financial values, claim access to raw transactions, " +
  "or suggest that you changed any data. If the context does not support " +
  "a claim, say so. Keep the explanation concise, clear, and " +
  "non-judgmental.";

// "contributed to" / "accounted for" / "was associated with the change" is
// deliberately the strongest causal language permitted -- the structured
// context (trend comparisons and totals) does not establish true causality
// for any single category, so the prompt must not ask the model to claim a
// category "caused" a change.
const SPENDING_CHANGE_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Explain the user's spending change using only the supplied structured " +
  "context. Treat the context as authoritative. Describe only the " +
  "changes, comparisons, and contributing categories shown in the " +
  "context. Do not invent causes, intentions, missing transactions, or " +
  "lifestyle explanations. Do not recalculate financial values, claim " +
  "access to raw transactions, or suggest that you changed any data. If " +
  "the context does not support a claim, say so. Keep the explanation " +
  "concise, clear, and non-judgmental.";

// Mirrors the exact fixed text approved for this milestone; only the
// existing string-concatenation style (not the wording) was adapted to
// match HEALTH_SYSTEM_PROMPT/SPENDING_CHANGE_SYSTEM_PROMPT above.
// Deliberately scopes the model to only the fields
// BUDGET_STATUS_EXPLANATION's context actually carries (configured
// budget, amount spent, remaining budget, utilization, status,
// overspending values, and existing projection/reliability values), and
// explicitly forbids forecasting, affordability, investment, or debt
// advice, or presenting a projection as certain.
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

// Scopes the model to exactly the six aggregates
// backend/sia/contextBuilder.js's M2-4A CATEGORY_SPENDING_EXPLANATION
// context carries, and names their distinct meanings so totals, share
// percentages, concentration, and period-over-period growth are not
// conflated. "accounted for" / "is associated with" remains the strongest
// causal language permitted (same standard as
// SPENDING_CHANGE_SYSTEM_PROMPT): a category's size or growth is a
// correlation in a completed monthly report, never a demonstrated
// real-world cause.
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

// Batch 2: "rule-detected unusual spending", never "fraud" or any
// wrongdoing-implying word -- matches
// expenseAnomalyAnalyzer.js's own module-level framing exactly
// ("a personal-history observation, not a fraud, wrongdoing, or 'financial
// problem' signal").
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

// Every value the model receives here is explicitly `isEstimate: true` --
// the prompt reinforces that framing in words as well, and forbids the
// model from presenting any forecast number as guaranteed or certain.
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

// Risk must be explained FROM the supplied evidence, never presented as a
// certainty or a calibrated probability, and never as investment, credit,
// lending, tax, or legal advice.
const RISK_SYSTEM_PROMPT =
  "You are SIA, BALENISA's read-only financial explanation assistant. " +
  "Explain the user's financial risk using only the supplied structured " +
  "context of rule-detected risk signals and their evidence. Treat the " +
  "context as authoritative. Describe only the specific signals and " +
  "evidence present (for example, an overspent or nearly-exhausted " +
  "budget, persistent spending growth, unusual expenses, forecasted " +
  "pressure, or a low financial-health score) -- never invent a risk " +
  "that has no corresponding signal, and never state a risk as a " +
  "certainty or a numeric probability/percentage chance. If riskLevel is " +
  "\"none\" or there are no signals, say plainly that no risk signals " +
  "were found. Do not give investment, credit, lending, tax, or legal " +
  "advice, and do not instruct the user to take a specific financial " +
  "action. Keep the explanation concise, clear, and non-judgmental.";

const SYSTEM_PROMPTS_BY_INTENT = {
  [HEALTH_EXPLANATION]: HEALTH_SYSTEM_PROMPT,
  [SPENDING_CHANGE_EXPLANATION]: SPENDING_CHANGE_SYSTEM_PROMPT,
  [BUDGET_STATUS_EXPLANATION]: BUDGET_STATUS_SYSTEM_PROMPT,
  [CATEGORY_SPENDING_EXPLANATION]: CATEGORY_SPENDING_SYSTEM_PROMPT,
  [ANOMALY_EXPLANATION]: ANOMALY_SYSTEM_PROMPT,
  [SPENDING_FORECAST_EXPLANATION]: FORECAST_SYSTEM_PROMPT,
  [FINANCIAL_RISK_EXPLANATION]: RISK_SYSTEM_PROMPT,
};

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

  // Additive, best-effort only. A client that never sends sessionId (every
  // pre-existing caller) sees byte-for-byte the same behavior as before --
  // activeSession stays null, and the response below carries no sessionId
  // field at all, exactly as previously.
  const requestedSessionId = typeof sessionId === "string" ? sessionId : undefined;
  const requestedClientMessageId = typeof clientMessageId === "string" ? clientMessageId : undefined;
  const activeSession = await safeGetOrCreateSession(req.userId, requestedSessionId);

  // Whatever classifyIntent returns is used as-is -- no hard-coded intent,
  // no guessed fallback. classifyIntent's own contract guarantees exactly
  // HEALTH_EXPLANATION, SPENDING_CHANGE_EXPLANATION,
  // BUDGET_STATUS_EXPLANATION, CATEGORY_SPENDING_EXPLANATION, or null.
  const intent = classifyIntent(trimmedQuestion);
  if (intent === null) {
    return res.status(422).json({
      success: false,
      message: "Question not recognized for the intents SIA currently supports.",
    });
  }

  try {
    // req.userId comes only from verifyToken (Middlewares/Auth.js), which
    // ran before this controller. This is the sole identity ever passed
    // into buildContext, for either intent -- req.body/req.query/route
    // params are never read for a userId anywhere in this controller. The
    // canonical Report is fetched fresh here on every single turn --
    // conversation history (below) is never used as a substitute source of
    // current financial facts.
    const contextResult = await buildContext(req.userId, intent);

    if (!contextResult || contextResult.fields === null || contextResult.reason === "no_data") {
      const noDataResponse = formatNoDataResponse(intent);
      if (activeSession) noDataResponse.sessionId = String(activeSession._id);
      return res.status(200).json(noDataResponse);
    }

    // Bounded recent-turn history, for conversational continuity ONLY --
    // buildContext() above already fetched the current, authoritative
    // report fresh for this turn regardless of what (if anything) loads
    // here. See sia/llmService.js's buildHistoryMessages() for exactly how
    // this is kept structurally unable to override the system prompt.
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
      // Exactly one failure record per provider attempt -- never logged
      // again by the outer catch below. Only the normalized error code and
      // provider identifier are ever passed; the caught error itself is
      // never logged and is always rethrown unchanged.
      logSiaEvent({
        event: SIA_LOG_EVENTS.PROVIDER_REQUEST_FAILED,
        provider: config.provider,
        errorCode: providerErr && providerErr.code,
        latencyMs: Date.now() - providerStartedAt,
      });
      throw providerErr;
    }

    if (!llmResult || typeof llmResult.answer !== "string" || llmResult.answer.trim() === "") {
      // Defensive: a resolved-but-unusable provider result is treated the
      // same as a rejection. Unreachable under the current M1-3 stub
      // (which never resolves), but required by this milestone's
      // controller-flow contract for when a real provider exists. Not
      // logged as a normalized-code failure since no LlmProviderError was
      // thrown here.
      return res.status(503).json(UNAVAILABLE_RESPONSE);
    }

    // Grounded-response validation (Batch 2 architecture closure): a real
    // deterministic gate, not just a system-prompt instruction. Only the
    // three new report-grounded intents are checked (see
    // sia/responseValidator.js) -- the four original intents' behavior is
    // completely unaffected. A failed check is treated exactly like a
    // failed/unusable provider result: the generic 503 below, never a
    // partially-shown or rewritten answer. contextResult.fields is the
    // exact structured context this answer was grounded in, so a
    // monetary-figure check has a real source of truth to compare against.
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
      return res.status(503).json(UNAVAILABLE_RESPONSE);
    }

    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED,
      provider: config.provider,
      latencyMs: Date.now() - providerStartedAt,
    });

    // Persisted only now that a real, usable answer exists -- a provider
    // failure or an unusable result above never reaches this line, so a
    // failed request can never leave a half-written (question with no
    // answer) turn behind. Best-effort: a persistence failure here does not
    // alter or retract the response already computed.
    if (activeSession) {
      await safeAppendTurn({
        sessionId: activeSession._id,
        userId: req.userId,
        question: trimmedQuestion,
        intent,
        answer: llmResult.answer,
        providerMetadata: { provider: config.provider },
        clientMessageId: requestedClientMessageId,
      });
    }

    const explanationResponse = formatExplanationResponse(intent, llmResult.answer);
    if (activeSession) explanationResponse.sessionId = String(activeSession._id);
    return res.status(200).json(explanationResponse);
  } catch (err) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
};

module.exports = {
  ask,
};
