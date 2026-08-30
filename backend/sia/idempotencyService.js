// SIA request-level idempotency service -- owns every read/write to models/SiaRequest.js. Guarantees at most one caller per (userId, clientMessageId) holds an unexpired lease and may call the provider; this is not crash-proof exactly-once (a crash between provider response and markAnswerReady() loses the answer and lets a later retry call the provider again), but it prevents duplicate concurrent provider calls, divergent answers, and unbounded locks. Never stores the structured financial context, system prompt, raw provider response, or an API key -- only models/SiaRequest.js's bounded fields.
"use strict";

const crypto = require("crypto");

const SiaRequest = require("../models/SiaRequest");
const { REQUEST_STATUS } = require("../models/SiaRequest");
const config = require("./config");

// How long a reservation may hold the exclusive right to call the provider -- the provider timeout plus a fixed allowance for context building and post-call validation/persistence, bounded so a crashed owner doesn't hold the key forever.
const LEASE_OVERHEAD_MS = 7000;
const LEASE_MS = () => config.timeoutMs + LEASE_OVERHEAD_MS;

// How long a follower waits for the owner to finish before giving up with a 409 -- deliberately shorter than the owner's own lease so it never mistakes an expiring lease for eligibility to become a new owner.
const FOLLOWER_WAIT_MS = () => Math.min(config.timeoutMs, 10000);
const FOLLOWER_POLL_INTERVAL_MS = 150;

// The outcome of a reservation attempt. The controller branches on exactly
// these -- no other state is exposed to it.
const OUTCOME = Object.freeze({
  // This caller owns the reservation and is the one permitted to classify,
  // build context, and call the provider.
  OWNED: "OWNED",
  // A completed response already exists; replay it verbatim.
  REPLAY_COMPLETED: "REPLAY_COMPLETED",
  // A validated answer already exists but persistence did not finish;
  // complete it WITHOUT another provider call.
  RESUME_ANSWER_READY: "RESUME_ANSWER_READY",
  // Another caller currently owns an unexpired lease.
  IN_PROGRESS: "IN_PROGRESS",
  // Same key, materially different request.
  CONFLICT: "CONFLICT",
});

// Normalizes a question for fingerprinting only (never for answering) -- trims/collapses whitespace but stays case-sensitive, since misclassifying two differently-cased questions as identical risks replaying the wrong answer.
function normalizeQuestion(question) {
  return typeof question === "string" ? question.trim().replace(/\s+/g, " ") : "";
}

// A hash, not the question text -- the question is already stored once in models/SiaMessage.js, so duplicating it here would put user content into an operational record for no benefit.
function fingerprintQuestion(question) {
  return crypto.createHash("sha256").update(normalizeQuestion(question), "utf8").digest("hex");
}

function newOwnerToken() {
  return crypto.randomUUID();
}

function leaseExpiryFromNow() {
  return new Date(Date.now() + LEASE_MS());
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// True when the supplied session id disagrees with the one already recorded. An omitted session id never conflicts -- that's the first-turn-retry case, which must be allowed to recover.
function sessionConflicts(existingSessionId, requestedSessionId) {
  if (!requestedSessionId) return false;
  if (!existingSessionId) return false;
  return String(existingSessionId) !== String(requestedSessionId);
}

// Atomically takes ownership of a request with an expired lease or sitting in `answer_ready` -- the findOneAndUpdate filter is the CAS itself (exact prior ownerToken + status), so only one of two racing takeover attempts can match.
async function takeOverRequest(existing, expectedStatus) {
  const ownerToken = newOwnerToken();
  const taken = await SiaRequest.findOneAndUpdate(
    {
      _id: existing._id,
      status: expectedStatus,
      ownerToken: existing.ownerToken ?? null,
    },
    {
      $set: {
        status: expectedStatus,
        ownerToken,
        processingExpiresAt: leaseExpiryFromNow(),
      },
    },
    { new: true }
  );

  return taken ? { record: taken, ownerToken } : null;
}

/**
 * Atomically reserves (userId, clientMessageId) BEFORE any session is
 * created and BEFORE the provider is called.
 *
 * @returns {Promise<{outcome: string, record?: object, ownerToken?: string}>}
 */
async function reserveRequest({ userId, clientMessageId, question, requestedSessionId }) {
  const questionFingerprint = fingerprintQuestion(question);

  const existing = await SiaRequest.findOne({ user: userId, clientMessageId });

  if (!existing) {
    const ownerToken = newOwnerToken();
    try {
      const created = await SiaRequest.create({
        user: userId,
        clientMessageId,
        questionFingerprint,
        status: REQUEST_STATUS.PROCESSING,
        ownerToken,
        processingExpiresAt: leaseExpiryFromNow(),
        session: requestedSessionId || null,
      });
      return { outcome: OUTCOME.OWNED, record: created, ownerToken };
    } catch (err) {
      // A concurrent duplicate won the unique-index race between findOne and this create -- MongoDB decided the winner; fall through to evaluate it as the follower.
      if (!err || err.code !== 11000) throw err;
      const winner = await SiaRequest.findOne({ user: userId, clientMessageId });
      if (!winner) throw err;
      return evaluateExisting(winner, questionFingerprint, requestedSessionId);
    }
  }

  return evaluateExisting(existing, questionFingerprint, requestedSessionId);
}

async function evaluateExisting(existing, questionFingerprint, requestedSessionId) {
  // Same key, different payload -- always a conflict, decided before the provider could ever be reached.
  if (existing.questionFingerprint !== questionFingerprint) {
    return { outcome: OUTCOME.CONFLICT, record: existing };
  }

  if (sessionConflicts(existing.session, requestedSessionId)) {
    return { outcome: OUTCOME.CONFLICT, record: existing };
  }

  if (existing.status === REQUEST_STATUS.COMPLETED) {
    return { outcome: OUTCOME.REPLAY_COMPLETED, record: existing };
  }

  if (existing.status === REQUEST_STATUS.ANSWER_READY) {
    // markAnswerReady() renews processingExpiresAt to a fresh lease when it commits the answer, so a live lease here means the original owner is still finishing finalization -- without this check a duplicate could start a second, concurrent finalizer for the same turn.
    const readyExpiresAt = existing.processingExpiresAt ? new Date(existing.processingExpiresAt).getTime() : 0;
    if (Number.isFinite(readyExpiresAt) && readyExpiresAt > Date.now()) {
      // An owner is actively finalizing right now -- this caller is a follower and must not start a second one.
      return { outcome: OUTCOME.IN_PROGRESS, record: existing };
    }

    // No owner is actively finalizing -- take ownership so exactly one caller finishes the outstanding persistence (no provider call on this path).
    const taken = await takeOverRequest(existing, REQUEST_STATUS.ANSWER_READY);
    if (taken) {
      return { outcome: OUTCOME.RESUME_ANSWER_READY, record: taken.record, ownerToken: taken.ownerToken };
    }
    // Lost the takeover race -- another caller is finishing it.
    return { outcome: OUTCOME.IN_PROGRESS, record: existing };
  }

  // status === processing
  const expiresAt = existing.processingExpiresAt ? new Date(existing.processingExpiresAt).getTime() : 0;
  if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
    // An owner is legitimately active -- this caller is a follower and must not call the provider.
    return { outcome: OUTCOME.IN_PROGRESS, record: existing };
  }

  // Lease expired -- the previous owner crashed or failed without releasing. Controlled takeover keeps the key retryable rather than permanently poisoned.
  const taken = await takeOverRequest(existing, REQUEST_STATUS.PROCESSING);
  if (taken) {
    return { outcome: OUTCOME.OWNED, record: taken.record, ownerToken: taken.ownerToken };
  }
  return { outcome: OUTCOME.IN_PROGRESS, record: existing };
}

// Commits the validated answer (including optional `grounding`, see models/SiaRequest.js) before session creation/persistence is attempted -- the checkpoint that makes a persistence failure recoverable without a second provider call, since RESUME_ANSWER_READY can rebuild the identical response from it.
async function markAnswerReady({ requestId, ownerToken, answer, intent, sessionId, grounding }) {
  return SiaRequest.findOneAndUpdate(
    { _id: requestId, ownerToken },
    {
      $set: {
        status: REQUEST_STATUS.ANSWER_READY,
        answer,
        intent,
        session: sessionId || null,
        grounding: grounding !== undefined ? grounding : null,
        processingExpiresAt: leaseExpiryFromNow(),
      },
    },
    { new: true }
  );
}

// Records the exact public payload returned, so any later duplicate replays it verbatim rather than regenerating anything.
async function markCompleted({ requestId, ownerToken, responseStatus, responsePayload, sessionId }) {
  return SiaRequest.findOneAndUpdate(
    { _id: requestId, ownerToken },
    {
      $set: {
        status: REQUEST_STATUS.COMPLETED,
        responseStatus,
        responsePayload,
        session: sessionId || null,
        ownerToken: null,
        processingExpiresAt: null,
      },
    },
    { new: true }
  );
}

// Workstream 1 -- persists a semantic-routing plan CHECKPOINT for an
// OWNED reservation that is still `processing` (never on a completed/
// answer_ready request) -- called by sia/semanticPipeline.js's
// `onPlanResolved` hook immediately after a successful router call,
// BEFORE any financialQueryService execution or answer-generation call
// is attempted. Renews the processing lease (same CAS discipline as
// takeOverRequest()) so this write can never itself extend a reservation
// past its owner's actual right to hold it. Best-effort by design (the
// caller swallows any rejection) -- a failed checkpoint write only means
// a subsequent retry re-pays the router cost, never a correctness issue.
async function saveRoutingCheckpoint({ requestId, ownerToken, planCheckpoint }) {
  return SiaRequest.findOneAndUpdate(
    { _id: requestId, ownerToken, status: REQUEST_STATUS.PROCESSING },
    {
      $set: {
        planCheckpoint: planCheckpoint || null,
        processingExpiresAt: leaseExpiryFromNow(),
      },
    },
    { new: true }
  );
}

// Releases a reservation after a failure that produced no usable answer. Deleting rather than marking failed leaves the key immediately, cleanly retryable; the ownerToken CAS means a caller can only release a reservation it actually owns.
async function releaseRequest({ requestId, ownerToken }) {
  return SiaRequest.deleteOne({ _id: requestId, ownerToken });
}

// Bounded follower wait -- polls for the owner to reach `completed` and returns the stored response; returns null if still working when the budget expires, so the controller answers with a 409 rather than calling the provider itself.
async function awaitCompletedResponse({ userId, clientMessageId, waitMs }) {
  const budget = typeof waitMs === "number" ? waitMs : FOLLOWER_WAIT_MS();
  const deadline = Date.now() + budget;

  for (;;) {
    const current = await SiaRequest.findOne({ user: userId, clientMessageId }).lean();

    if (!current) {
      // The owner released the reservation after a failure -- no stored response to replay; report unresolved and let the client retry explicitly.
      return null;
    }

    if (current.status === REQUEST_STATUS.COMPLETED) {
      return current;
    }

    if (Date.now() >= deadline) {
      return null;
    }

    await sleep(FOLLOWER_POLL_INTERVAL_MS);
  }
}

module.exports = {
  reserveRequest,
  markAnswerReady,
  markCompleted,
  releaseRequest,
  awaitCompletedResponse,
  saveRoutingCheckpoint,
  normalizeQuestion,
  fingerprintQuestion,
  OUTCOME,
  LEASE_MS,
  FOLLOWER_WAIT_MS,
};
