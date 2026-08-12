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
const idempotencyService = require("../../sia/idempotencyService");
const { isSiaReady } = require("../../sia/readiness");
const { buildGroundingSnapshot } = require("../../sia/groundingService");
const { isValidObjectId } = require("mongoose");

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
// Batch 3B.1: session RESOLUTION and session CREATION are now separate,
// deliberately performed at two different points in the request. An
// explicitly supplied session is resolved up front (its history is needed
// before the provider call); a brand-new conversation's session is not
// created until a validated answer already exists, so a failed first turn
// never leaves an empty, user-visible conversation behind.
async function safeFindOwnedSession(userId, sessionId) {
  if (!isSessionStoreAvailable()) return null;
  try {
    return await sessionService.findOwnedSession(userId, sessionId);
  } catch (_err) {
    return null;
  }
}

// Batch 3G: `firstQuestion` is optional and only ever supplied for a
// brand-new conversation's very first successfully answered turn (see
// finalizeAnswer() below) -- an existing session is never passed a
// question here, and this function itself never derives or interprets the
// question; sessionService.createSession() owns that (sia/sessionTitle.js).
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
// Evidence-boundary addendum (historical-decline remediation): this
// context always carries only the user's CURRENT financial-health result
// (report.financialHealth.overall/.risk.label at the moment of this turn's
// report) -- never a historical series -- so the prompt must not let the
// model describe a single current score as evidence of change over time.
// Mirrored by backend/sia/responseValidator.js's new
// DECLINE_LANGUAGE_PATTERN check, scoped to this intent unconditionally
// (this intent's context can never support decline language, by contract).
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

// "contributed to" / "accounted for" / "was associated with the change" is
// deliberately the strongest causal language permitted -- the structured
// context (trend comparisons and totals) does not establish true causality
// for any single category, so the prompt must not ask the model to claim a
// category "caused" a change.
// Evidence-boundary addendum (temporal-overstatement remediation): the
// comparison in this context (trends.monthlyTrend) is always exactly one
// current-month-vs-previous-month comparison -- never a multi-period
// series -- so the prompt must not let the model dress a single comparison
// up as a persistent/sustained/long-term/repeated/multi-month trend, which
// is exactly the overstatement risk backend/sia/responseValidator.js's new
// PERSISTENCE_LANGUAGE_PATTERN check (intent-scoped to this intent) exists
// to catch deterministically if the prompt alone is not enough.
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
//
// Evidence-boundary hardening (semantic-accuracy remediation): the three
// risk reasonCodes below are internal rule names whose plain-English
// meaning overstates what their evidence actually proves (confirmed by
// direct source inspection of backend/analytics/analyzers/riskAnalyzer.js
// and forecastAnalyzer.js):
//   - FORECASTED_FINANCIAL_PRESSURE's evidence is sourced from
//     forecast.nextMonthForecast (evaluateForecastedPressure), which
//     forecastAnalyzer.js documents projects the ANCHOR ordinal -- the
//     CURRENT, in-progress month -- never the next calendar month.
//   - PERSISTENT_SPENDING_GROWTH's evidence (evaluatePersistentSpendingGrowth)
//     is trends.monthlyTrend.percentageChange, exactly ONE
//     current-vs-previous-month comparison, never a multi-period trend.
//   - DETERIORATING_HEALTH's evidence (evaluateDeterioratingHealth) is
//     financialHealth.overall alone, the CURRENT score only, with no
//     historical comparison.
// The enumeration below was itself rewritten to stop mirroring the
// reasonCode names ("persistent spending growth", "forecasted pressure")
// into the model's own instructions, and the explicit boundary sentences
// after it are the primary defense. backend/sia/responseValidator.js's new
// intent-and-signal-conditional checks are the deterministic backstop if
// the model does not follow this prompt.
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

// Batch 3B.1: the exact, stable conflict contract. Both carry a machine-
// readable `code` so a client can distinguish "you reused a key for a
// different request" (never retryable as-is) from "your original request
// is still running" (retryable shortly) -- neither is a generic 503.
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

// Validates the optional idempotency key. Returns {ok, value} or
// {ok:false, message}. Omission stays fully supported (backward
// compatibility for every pre-existing client) -- it simply carries no
// idempotency guarantee.
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

// Validates the optional session id. Batch 3B.1 correction: a malformed id
// is now an explicit 400 rather than being silently swallowed into "create
// a brand-new session instead", which previously hid client bugs and made
// a typo indistinguishable from starting a new conversation.
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

// Completes a request that already has a validated answer in hand: creates
// the session if this is a brand-new conversation (deferred to exactly
// this point so a failed turn never leaves an empty one), appends the
// single user/assistant pair, records the exact returned payload for
// replay, and returns it. Shared by the normal success path and by the
// `answer_ready` recovery path -- neither of which calls the provider from
// here.
async function finalizeAnswer({ req, reservation, activeSession, intent, answer, clientMessageId, grounding }) {
  // Batch 3G: captured BEFORE `session` is mutated below, so this is true
  // only when this call is genuinely starting a brand-new conversation --
  // never for an existing session, and never a second time for the same
  // conversation. This is what gates automatic-title derivation to
  // exactly the first successfully answered turn, with no extra query:
  // the title is derived and written in the SAME SiaSession.create() call
  // safeCreateSession()/sessionService.createSession() already makes.
  //
  // The question passed on this path is this request's own validated,
  // trimmed question -- for a resumed ANSWER_READY completion
  // (idempotencyService's RESUME_ANSWER_READY outcome), that is safe
  // because reserveRequest()/evaluateExisting() already rejected any
  // request whose question fingerprint does not match the original
  // attempt's (a mismatch is a 409 CONFLICT, never reaching here) -- so
  // this is provably "the same stored/fingerprinted question", without
  // needing to store the raw question text a second time anywhere.
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

const ask = async (req, res) => {
  // Batch 3E: the readiness gate. Previously this checked only
  // `config.enabled`, which meant a request against a deployment with SIA
  // enabled but NO provider/model/API key was admitted, classified, given
  // a freshly-built analytics context, and only then failed at the
  // provider boundary -- paying for a full Report V3 read to produce a
  // guaranteed 503. isSiaReady() (sia/readiness.js) is the SAME function
  // GET /sia/status answers with, so the two endpoints can never disagree
  // about availability.
  //
  // The rejection is deliberately the pre-existing, byte-identical generic
  // 503 -- no new status code, no reason code, no configuration detail --
  // and it happens BEFORE any request validation side effect, intent
  // classification, context build, provider call, session creation, or
  // idempotency reservation, so an unready deployment does no work and
  // leaves no trace at all.
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

  // A keyed request whose coordination store is unreachable CANNOT be made
  // idempotent. Failing closed here -- before the provider is ever called
  // -- is the only honest option: silently executing it unprotected would
  // hand the client a guarantee that does not exist, and is exactly how a
  // retry storm produces duplicate LLM charges.
  if (requestedClientMessageId && !isSessionStoreAvailable()) {
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }

  // THE reservation. Deliberately before session creation, before intent
  // classification, before context building, and before askLlm -- this
  // ordering is the entire fix. Batch 3B.0 found the previous
  // implementation only consulted clientMessageId inside appendTurn, long
  // AFTER the provider had already been called.
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
      // Verbatim replay of the already-returned payload. No classifier, no
      // context build, no provider call, no validation, no appendTurn.
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
      // Still running at the safe limit. A follower must NEVER fall
      // through into calling the provider itself.
      return res.status(409).json(REQUEST_IN_PROGRESS_RESPONSE);
    }

    if (reservation.outcome === idempotencyService.OUTCOME.RESUME_ANSWER_READY) {
      // A validated answer already exists from a prior attempt whose
      // persistence did not finish. Complete it -- without a second
      // provider call.
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
          // Batch 3F: the SAME snapshot committed at markAnswerReady() time
          // for the original attempt -- never recomputed from the user's
          // current (possibly since-changed) analytics.
          grounding: reservation.record.grounding || undefined,
        });
        return res.status(finished.status).json(finished.payload);
      } catch (_err) {
        return res.status(503).json(UNAVAILABLE_RESPONSE);
      }
    }
  }

  // Resolve an explicitly-supplied session BEFORE the provider call, since
  // its bounded history feeds the LLM. A valid-but-unknown/foreign id is
  // now an explicit, non-disclosing 404 -- never a silently substituted
  // brand-new session (Batch 3B.1 correction).
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

  // Whatever classifyIntent returns is used as-is -- no hard-coded intent,
  // no guessed fallback. classifyIntent's own contract guarantees exactly
  // HEALTH_EXPLANATION, SPENDING_CHANGE_EXPLANATION,
  // BUDGET_STATUS_EXPLANATION, CATEGORY_SPENDING_EXPLANATION, or null.
  const intent = classifyIntent(trimmedQuestion);
  if (intent === null) {
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
      // No provider call happens on this path, and -- Batch 3B.1 -- no
      // session is created for a brand-new conversation either: there is
      // no turn to store, so an empty conversation would be pure noise in
      // the user's history. An EXISTING session still reports its id, as
      // before.
      const noDataResponse = formatNoDataResponse(intent);
      if (activeSession) noDataResponse.sessionId = String(activeSession._id);

      // Recorded as completed so a retry with the same key replays this
      // exact 200 rather than re-running context building.
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

    // Batch 3F: computed from the EXACT contextResult that will be sent to
    // the provider below -- not from the intent, not from what the
    // classifier merely selected, and not by parsing the provider's answer
    // or the constructed prompt. This is why it happens here, immediately
    // after buildContext() succeeds, rather than after askLlm() returns.
    const grounding = buildGroundingSnapshot(contextResult);

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
      throw new Error("GROUNDING_REJECTED");
    }

    logSiaEvent({
      event: SIA_LOG_EVENTS.PROVIDER_REQUEST_COMPLETED,
      provider: config.provider,
      latencyMs: Date.now() - providerStartedAt,
    });

    // The durable checkpoint: the validated answer is committed BEFORE any
    // session write is attempted, so if persistence then fails, a retry
    // with the same key resumes from this stored answer instead of paying
    // for a second provider call.
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

    // Persisted only now that a real, usable answer exists -- a provider
    // failure or an unusable result above never reaches this line, so a
    // failed request can never leave a half-written (question with no
    // answer) turn behind. Best-effort: a persistence failure here does not
    // alter or retract the response already computed.
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
    // Release the reservation so a provider or grounding failure never
    // permanently poisons the key -- the client may retry the identical
    // request and will be treated as a fresh, properly-owned attempt. Note
    // this only runs for failures BEFORE markAnswerReady committed; once
    // an answer is stored, a retry resumes from it instead.
    if (reservation) {
      try {
        await idempotencyService.releaseRequest({
          requestId: reservation.record._id,
          ownerToken: reservation.ownerToken,
        });
      } catch (_releaseErr) {
        // Best-effort. The lease's own expiry is the backstop that keeps
        // the key retryable even if this release fails.
      }
    }
    return res.status(503).json(UNAVAILABLE_RESPONSE);
  }
};

module.exports = {
  ask,
};
