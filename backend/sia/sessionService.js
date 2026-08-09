// SIA bounded conversation/session service -- Batch 2.
//
// Owns all reads/writes to SiaSession/SiaMessage. Every lookup and
// mutation is scoped to the caller-supplied userId -- there is no function
// here that can read or modify another user's session/messages, and no
// function accepts a client-supplied identity override.
//
// This module never stores or returns the complete Financial Report, a raw
// LLM prompt, an API key, a raw provider response, a raw structured
// context payload, or hidden reasoning -- only the bounded fields
// models/SiaMessage.js's schema itself allows.
"use strict";

const mongoose = require("mongoose");

const SiaSession = require("../models/SiaSession");
const SiaMessage = require("../models/SiaMessage");
const { deriveSessionTitle } = require("./sessionTitle");

const DEFAULT_SESSION_LIST_LIMIT = 20;
const MAX_SESSION_LIST_LIMIT = 50;
const DEFAULT_MESSAGE_PAGE_LIMIT = 20;
const MAX_MESSAGE_PAGE_LIMIT = 50;
// The bounded number of most-recent turns ever loaded into an LLM call --
// history informs conversational continuity only; it is never the source
// of current financial facts (buildContext() always re-fetches the latest
// canonical report separately, on every turn).
const MAX_RECENT_TURNS_FOR_LLM = 6;

function isValidObjectId(value) {
  return typeof value === "string" && mongoose.isValidObjectId(value);
}

function boundLimit(requested, fallback, max) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

// Resolves `sessionId` to a session owned by `userId`, or null. Returns
// null (never throws, never discloses) both for a malformed id and for a
// valid id owned by somebody else -- the caller decides what that means.
//
// Batch 3B.1: split out of getOrCreateSession() below because
// Controllers/SiaControllers/ask.js must now be able to LOOK UP an
// existing session without implicitly creating one. Deferring creation is
// what stops a failed first turn from leaving an empty, user-visible
// conversation behind.
async function findOwnedSession(userId, sessionId) {
  if (!isValidObjectId(sessionId)) return null;
  return SiaSession.findOne({ _id: sessionId, user: userId });
}

// Creates a brand-new session owned by `userId`. Never creates a session
// belonging to any other user.
//
// Batch 3G: `firstQuestion` is optional and trusted server-side only --
// callers pass it exactly once, for the first successfully answered
// question of a brand-new conversation (see
// Controllers/SiaControllers/ask.js's finalizeAnswer()). This is a
// single-write design: the title is derived locally (deriveSessionTitle()
// -- no provider/LLM call, no logging of the question or title) and
// included in this SAME SiaSession.create() call. There is deliberately no
// second query anywhere that updates a session's title after creation --
// an existing session is never renamed on a later turn, and a caller that
// omits `firstQuestion` gets the exact same behavior as before this
// batch: `title` stays unset, which the schema already defaults to null.
async function createSession(userId, firstQuestion) {
  const title = deriveSessionTitle(firstQuestion);
  return SiaSession.create({ user: userId, title });
}

// Returns an existing, owned session if `sessionId` is supplied and valid,
// or creates a brand-new one for `userId` otherwise. Never creates a
// session belonging to any user other than `userId`, and never trusts a
// sessionId that does not resolve to a document owned by `userId` (falls
// back to creating a fresh session in that case rather than throwing --
// the same "never disclose whether another identifier exists" posture the
// dedicated session endpoints use).
//
// Batch 3B.1: now a thin composition of the two functions above, with its
// original behaviour preserved exactly. The ask controller no longer uses
// it (it needs the lookup and the creation at two DIFFERENT points in the
// request, either side of the provider call), but it remains the correct
// primitive for any caller that genuinely wants "resolve or create" in one
// step.
async function getOrCreateSession(userId, sessionId) {
  if (sessionId !== undefined && sessionId !== null) {
    const existing = await findOwnedSession(userId, sessionId);
    if (existing) return existing;
    // Invalid id shape, or a valid id that does not belong to this user:
    // silently falls through to creating a new session rather than
    // throwing or revealing which case occurred.
  }

  return createSession(userId);
}

// Persists exactly one completed turn (one user message + one assistant
// message) atomically from the caller's point of view: both documents are
// only ever created together, after a successful, usable LLM answer
// already exists -- Controllers/SiaControllers/ask.js never calls this on
// a failed/unavailable provider path, so a failed request can never leave
// a half-written (question with no answer, or answer with no question)
// history behind.
//
// Idempotent when `clientMessageId` is supplied: a repeated request with
// the same (session, clientMessageId) pair returns the previously-created
// pair instead of creating a duplicate. Race-safe, not just
// findOne-then-create: the REAL protection against two concurrent
// duplicate attempts is models/SiaMessage.js's unique sparse index on
// (session, clientMessageId) at the database level -- the findOne check
// below is only a fast-path optimization to avoid a doomed insert attempt
// on the common sequential-retry case. If two requests race past the
// findOne check at the same time, MongoDB's unique index guarantees only
// one `create()` can ever succeed; the loser's duplicate-key error (E11000)
// is caught below and turned into the exact same "recover the existing
// pair" result the sequential path already returns -- so a concurrent
// retry never duplicates messages and never needs to re-invoke the LLM
// provider to answer the retry.
// Batch 3F: `grounding` (optional) is the immutable provenance snapshot for
// THIS answer (backend/sia/groundingService.js). It is stored on the
// assistant document only -- a user turn never carries it -- and, like
// every other field here, it is written exactly once, at creation time,
// and never recomputed later: the user's underlying financial data can
// change after this turn is stored, so replaying old grounding from
// CURRENT analytics would misrepresent what actually grounded this specific
// historical answer.
async function appendTurn({
  sessionId,
  userId,
  question,
  intent,
  answer,
  providerMetadata,
  clientMessageId,
  grounding,
}) {
  // The unique index on models/SiaMessage.js is scoped to (session,
  // clientMessageId) -- a single raw clientMessageId cannot be stored on
  // both the user and assistant document of the same turn without
  // colliding, so each role gets its own role-scoped derived key. Both the
  // storage below and the lookup here use the exact same derived keys, so
  // the two stay in sync (a prior version of this function derived the
  // assistant key at storage time but checked for the raw key at lookup
  // time, which meant a retried request could never find the previously
  // stored assistant message -- fixed by deriving both keys once, up
  // front, and reusing them in both places). `session` alone (not
  // `session`+`user`) is the index's scope because a session already
  // belongs to exactly one user for its entire lifetime (enforced by
  // getOrCreateSession()'s own ownership-checked lookup) -- a
  // `clientMessageId` can never collide across two different users'
  // sessions.
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
      // The `grounding` key is only ever present on the create() call at
      // all when a real, non-empty snapshot exists -- conditionally
      // spread in, not set to `undefined`, so a no-op grounding
      // computation leaves the write attributes byte-for-byte identical to
      // before this field existed (see tests/sia.historySafety.test.js's
      // exact-allowlist proof, which this mirrors).
      ...(grounding && Array.isArray(grounding.sources) && grounding.sources.length > 0 ? { grounding } : {}),
    });
  } catch (err) {
    // MongoDB duplicate-key error (E11000) -- a concurrent request won the
    // race and already created this exact (session, clientMessageId) pair
    // between our findOne check above and this create() call. Recover the
    // winner's already-persisted pair instead of throwing, exactly as if
    // the sequential findOne path had caught it.
    if (clientMessageId && err && err.code === 11000) {
      return fetchExistingPair();
    }

    // A genuine (non-duplicate) failure on the SECOND write, after the
    // first already succeeded, would otherwise leave a lone user-only
    // message on record with no matching answer -- indistinguishable from
    // a real completed turn to a caller paginating this session's
    // messages. Best-effort rollback of the just-created user message so a
    // failed turn never leaves that half-written artifact behind. If the
    // rollback itself fails, the original error still propagates
    // unchanged -- this is a best-effort cleanup, not a transaction.
    if (userMessage && !assistantMessage) {
      try {
        await SiaMessage.deleteOne({ _id: userMessage._id });
      } catch (_rollbackErr) {
        // Swallowed intentionally -- the original `err` below is what the
        // caller (Controllers/SiaControllers/ask.js's safeAppendTurn) will
        // see and treat as a best-effort persistence failure either way.
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

// Bounded, chronological pagination of one session's messages -- but only
// when `sessionId` resolves to a document owned by `userId`. Returns null
// (not a thrown error) for a missing/foreign session, so the controller
// can respond with the repository's established non-disclosing 404
// without ever revealing whether the id belongs to someone else.
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

// Ownership-enforced deletion of one session and all of its messages.
// Returns false (not a thrown error) for a missing/foreign session -- same
// non-disclosing posture as listMessages().
async function deleteSession(sessionId, userId) {
  if (!isValidObjectId(sessionId)) return false;

  const session = await SiaSession.findOneAndDelete({ _id: sessionId, user: userId });
  if (!session) return false;

  await SiaMessage.deleteMany({ session: sessionId, user: userId });
  return true;
}

// Bounded recent turns for LLM conversational continuity ONLY -- never a
// source of current financial facts (buildContext() is always called
// separately on every turn to fetch the latest canonical report). Content
// is already schema-bounded (see models/SiaMessage.js's maxlength), and
// only role/content/intent are returned -- no metadata, no ids.
async function loadRecentTurns(sessionId, userId, limit = MAX_RECENT_TURNS_FOR_LLM) {
  if (!isValidObjectId(sessionId)) return [];

  const boundedLimit = boundLimit(limit, MAX_RECENT_TURNS_FOR_LLM, MAX_RECENT_TURNS_FOR_LLM);
  const recent = await SiaMessage.find({ session: sessionId, user: userId })
    .sort({ createdAt: -1 })
    .limit(boundedLimit)
    .lean();

  // Re-ascending (oldest of the loaded window first) -- the natural
  // conversational reading order.
  return recent.reverse().map((m) => ({ role: m.role, content: m.content, intent: m.intent }));
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
  MAX_RECENT_TURNS_FOR_LLM,
};
