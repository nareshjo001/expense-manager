// SIA bounded conversation/session service -- owns all reads/writes to SiaSession/SiaMessage. Every lookup and mutation is scoped to the caller-supplied userId; no function here can read/modify another user's session, and none accepts a client-supplied identity override. Never stores or returns the complete Financial Report, a raw LLM prompt, an API key, a raw provider response, raw context, or hidden reasoning -- only the bounded fields SiaMessage.js's schema allows.
"use strict";

const mongoose = require("mongoose");

const SiaSession = require("../models/SiaSession");
const SiaMessage = require("../models/SiaMessage");
const { deriveSessionTitle } = require("./sessionTitle");

const DEFAULT_SESSION_LIST_LIMIT = 20;
const MAX_SESSION_LIST_LIMIT = 50;
const DEFAULT_MESSAGE_PAGE_LIMIT = 20;
const MAX_MESSAGE_PAGE_LIMIT = 50;
// The bounded number of most-recent turns ever loaded into an LLM call -- history informs conversational continuity only, never the source of current financial facts (buildContext() always re-fetches the latest canonical report every turn).
const MAX_RECENT_TURNS_FOR_LLM = 6;

function isValidObjectId(value) {
  return typeof value === "string" && mongoose.isValidObjectId(value);
}

function boundLimit(requested, fallback, max) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

// Resolves `sessionId` to a session owned by `userId`, or null -- never throws, never discloses, for both a malformed id and a valid id owned by somebody else; the caller decides what that means. Split out of getOrCreateSession() so ask.js can LOOK UP an existing session without implicitly creating one -- deferring creation stops a failed first turn from leaving an empty, user-visible conversation behind.
async function findOwnedSession(userId, sessionId) {
  if (!isValidObjectId(sessionId)) return null;
  return SiaSession.findOne({ _id: sessionId, user: userId });
}

// Creates a brand-new session owned by `userId` -- never any other user. `firstQuestion` is optional, trusted server-side only, passed exactly once for a brand-new conversation's first answered question (ask.js's finalizeAnswer()). Single-write design: the title is derived locally (deriveSessionTitle() -- no provider/LLM call, no logging) and included in this SAME create() call; no second query ever updates a title after creation, and omitting `firstQuestion` leaves `title` unset (schema default null).
async function createSession(userId, firstQuestion) {
  const title = deriveSessionTitle(firstQuestion);
  return SiaSession.create({ user: userId, title });
}

// Returns an existing, owned session if `sessionId` is supplied and valid, or creates a brand-new one for `userId` otherwise -- never trusts a sessionId that doesn't resolve to a document owned by `userId`, falling back to creating a fresh session rather than throwing (same non-disclosing posture the dedicated session endpoints use). Now a thin composition of the two functions above; the ask controller no longer uses it directly (it needs lookup and creation at two different points, either side of the provider call), but it remains the correct primitive for a caller that wants "resolve or create" in one step.
async function getOrCreateSession(userId, sessionId) {
  if (sessionId !== undefined && sessionId !== null) {
    const existing = await findOwnedSession(userId, sessionId);
    if (existing) return existing;
    // Invalid id shape, or a valid id that doesn't belong to this user -- silently falls through to creating a new session rather than throwing or revealing which case occurred.
  }

  return createSession(userId);
}

// Persists exactly one completed turn (user message + assistant message) atomically from the caller's point of view: both documents are only created together, after a usable LLM answer already exists -- ask.js never calls this on a failed/unavailable provider path, so a failed request can never leave a half-written history behind.
//
// Idempotent when `clientMessageId` is supplied: a repeated request with the same (session, clientMessageId) pair returns the previously-created pair instead of duplicating. Race-safe, not just findOne-then-create: the REAL protection is SiaMessage.js's unique sparse index on (session, clientMessageId) at the database level -- the findOne check below is only a fast-path optimization for the common sequential-retry case. If two requests race past findOne simultaneously, MongoDB's unique index guarantees only one `create()` succeeds; the loser's duplicate-key error (E11000) is caught below and turned into the same "recover the existing pair" result, so a concurrent retry never duplicates messages or re-invokes the LLM provider.
// `grounding` (optional) is the immutable provenance snapshot for THIS answer (groundingService.js), stored on the assistant document only, written exactly once at creation time and never recomputed later: the user's underlying financial data can change after this turn is stored, so replaying old grounding from CURRENT analytics would misrepresent what actually grounded this specific historical answer.
async function appendTurn({
  sessionId,
  userId,
  question,
  intent,
  answer,
  providerMetadata,
  clientMessageId,
  grounding,
  // Workstream 1 -- bounded QueryPlan summary (see models/SiaMessage.js's
  // siaPlanSummarySchema), stored on the assistant document only, same
  // conditional-presence discipline as `grounding` below: only included
  // in the create() call at all when a real plan summary exists, so a
  // turn answered via the pre-existing pipeline stores no planSummary
  // field.
  planSummary,
}) {
  // The unique index on SiaMessage.js is scoped to (session, clientMessageId) -- a single raw clientMessageId can't be stored on both the user and assistant document of the same turn without colliding, so each role gets its own derived key, reused identically at both storage and lookup time (a prior version derived the assistant key only at storage time but checked the raw key at lookup, so a retry could never find the stored assistant message -- fixed by deriving both keys once, up front). `session` alone (not `session`+`user`) is the index's scope because a session belongs to exactly one user for its lifetime (enforced by getOrCreateSession()'s ownership-checked lookup) -- a clientMessageId can never collide across two users' sessions.
  const userClientMessageId = clientMessageId ? `${clientMessageId}:user` : null;
  const assistantClientMessageId = clientMessageId ? `${clientMessageId}:assistant` : null;

  async function fetchExistingPair() {
    const existingUserTurn = await SiaMessage.findOne({
      session: sessionId,
      user: userId,
      clientMessageId: userClientMessageId,
      role: "user",
    }).lean();
    const existingAssistantTurn = await SiaMessage.findOne({
      session: sessionId,
      user: userId,
      clientMessageId: assistantClientMessageId,
      role: "assistant",
    }).lean();
    return { userMessage: existingUserTurn, assistantMessage: existingAssistantTurn, deduplicated: true };
  }

  if (clientMessageId) {
    const fastPathExisting = await fetchExistingPair();
    if (fastPathExisting.userMessage) {
      return fastPathExisting;
    }
  }

  let userMessage;
  let assistantMessage;
  try {
    userMessage = await SiaMessage.create({
      session: sessionId,
      user: userId,
      role: "user",
      content: question,
      intent,
      clientMessageId: userClientMessageId,
    });

    assistantMessage = await SiaMessage.create({
      session: sessionId,
      user: userId,
      role: "assistant",
      content: answer,
      intent,
      clientMessageId: assistantClientMessageId,
      metadata: providerMetadata || {},
      // `grounding` is only present on the create() call at all when a real, non-empty snapshot exists -- conditionally spread in, not set to `undefined`, so a no-op computation leaves the write attributes byte-for-byte identical to before this field existed.
      ...(grounding && Array.isArray(grounding.sources) && grounding.sources.length > 0 ? { grounding } : {}),
      // Same conditional-presence discipline as `grounding` immediately
      // above -- a no-op (no planSummary supplied) leaves the write
      // attributes byte-for-byte identical to before this field existed.
      ...(planSummary && typeof planSummary === "object" ? { planSummary } : {}),
    });
  } catch (err) {
    // MongoDB duplicate-key error (E11000) -- a concurrent request won the race and already created this exact pair between our findOne check and this create() call. Recover the winner's already-persisted pair instead of throwing, exactly as the sequential findOne path would have.
    if (clientMessageId && err && err.code === 11000) {
      return fetchExistingPair();
    }

    // A genuine (non-duplicate) failure on the SECOND write, after the first already succeeded, would otherwise leave a lone user-only message indistinguishable from a real completed turn. Best-effort rollback of the just-created user message so a failed turn never leaves that half-written artifact; if rollback itself fails, the original error still propagates unchanged -- best-effort cleanup, not a transaction.
    if (userMessage && !assistantMessage) {
      try {
        await SiaMessage.deleteOne({ _id: userMessage._id });
      } catch (_rollbackErr) {
        // Swallowed intentionally -- the original `err` below is what the caller (ask.js's safeAppendTurn) sees and treats as a best-effort persistence failure either way.
      }
    }

    throw err;
  }

  await SiaSession.updateOne(
    { _id: sessionId, user: userId },
    { $inc: { messageCount: 2 }, $set: { lastMessageAt: assistantMessage.createdAt } }
  );

  return { userMessage, assistantMessage, deduplicated: false };
}

// Bounded, most-recent-first list of a user's OWN sessions only.
async function listSessions(userId, { limit } = {}) {
  const boundedLimit = boundLimit(limit, DEFAULT_SESSION_LIST_LIMIT, MAX_SESSION_LIST_LIMIT);
  return SiaSession.find({ user: userId })
    .sort({ updatedAt: -1 })
    .limit(boundedLimit)
    .lean();
}

// Bounded, chronological pagination of one session's messages -- only when `sessionId` resolves to a document owned by `userId`. Returns null (not a thrown error) for a missing/foreign session, so the controller can respond with the established non-disclosing 404.
async function listMessages(sessionId, userId, { limit, before } = {}) {
  if (!isValidObjectId(sessionId)) return null;

  const session = await SiaSession.findOne({ _id: sessionId, user: userId }).lean();
  if (!session) return null;

  const boundedLimit = boundLimit(limit, DEFAULT_MESSAGE_PAGE_LIMIT, MAX_MESSAGE_PAGE_LIMIT);
  const query = { session: sessionId, user: userId };
  if (before instanceof Date && !Number.isNaN(before.getTime())) {
    query.createdAt = { $lt: before };
  }

  const messages = await SiaMessage.find(query).sort({ createdAt: 1 }).limit(boundedLimit).lean();

  return { session, messages };
}

// Ownership-enforced deletion of one session and all its messages -- returns false (not thrown) for a missing/foreign session, same non-disclosing posture as listMessages().
async function deleteSession(sessionId, userId) {
  if (!isValidObjectId(sessionId)) return false;

  const session = await SiaSession.findOneAndDelete({ _id: sessionId, user: userId });
  if (!session) return false;

  await SiaMessage.deleteMany({ session: sessionId, user: userId });
  return true;
}

// Bounded recent turns for LLM conversational continuity ONLY -- never a source of current financial facts (buildContext() is always called separately every turn). Content is already schema-bounded (SiaMessage.js's maxlength), and only role/content/intent are returned -- no metadata, no ids.
async function loadRecentTurns(sessionId, userId, limit = MAX_RECENT_TURNS_FOR_LLM) {
  if (!isValidObjectId(sessionId)) return [];

  const boundedLimit = boundLimit(limit, MAX_RECENT_TURNS_FOR_LLM, MAX_RECENT_TURNS_FOR_LLM);
  const recent = await SiaMessage.find({ session: sessionId, user: userId })
    .sort({ createdAt: -1 })
    .limit(boundedLimit)
    .lean();

  // Re-ascending (oldest of the loaded window first) -- the natural conversational reading order.
  return recent.reverse().map((m) => ({ role: m.role, content: m.content, intent: m.intent }));
}

// Workstream 1 -- the most recent assistant message's bounded QueryPlan
// summary (if any) for this owned session, used ONLY to give the
// semantic router calendar/topic continuity for a follow-up question
// ("what about last month?") -- NEVER as a source of current financial
// facts (a follow-up always re-fetches fresh via
// sia/financialQueryService.js). Returns null for a missing/foreign
// session or when no prior turn carried a plan summary, same
// non-disclosing posture as this module's other lookups.
async function loadLastPlanSummary(sessionId, userId) {
  if (!isValidObjectId(sessionId)) return null;

  const lastWithPlan = await SiaMessage.findOne({
    session: sessionId,
    user: userId,
    role: "assistant",
    planSummary: { $exists: true },
  })
    .sort({ createdAt: -1 })
    .lean();

  return lastWithPlan && lastWithPlan.planSummary ? lastWithPlan.planSummary : null;
}

module.exports = {
  findOwnedSession,
  createSession,
  getOrCreateSession,
  appendTurn,
  listSessions,
  listMessages,
  deleteSession,
  loadRecentTurns,
  loadLastPlanSummary,
  MAX_RECENT_TURNS_FOR_LLM,
};
