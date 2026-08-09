// SIA request-level idempotency service -- Batch 3B.1.
//
// Owns every read/write to models/SiaRequest.js and is the ONLY place the
// (user, clientMessageId) reservation lifecycle is implemented.
//
// The guarantee this provides, precisely stated:
//
//   For a given (userId, clientMessageId), at most one caller at a time
//   holds an unexpired `processing` lease, and only that caller may invoke
//   the LLM provider. Every other concurrent or later caller either
//   replays the already-stored response, resumes from an already-stored
//   validated answer, or is told the request is still in progress. No
//   follower ever calls the provider.
//
// THE BOUNDARY (deliberately not overstated): this is NOT crash-proof
// "exactly once" delivery, and it cannot be. If the owning process dies
// after the provider produced an answer but before markAnswerReady()
// committed it, that answer is lost and the lease eventually expires, so a
// later retry legitimately calls the provider a second time. Mongo can
// guarantee mutual exclusion and durable state transitions; it cannot make
// a remote HTTP call to OpenAI atomic with a local database write. What is
// guaranteed is: no DUPLICATE CONCURRENT provider call, no silently
// divergent answer, and no unbounded lock.
//
// Never stores or returns the structured financial context, the system
// prompt, the raw provider response, or an API key -- only the bounded
// fields models/SiaRequest.js's schema allows.
"use strict";

const crypto = require("crypto");

const SiaRequest = require("../models/SiaRequest");
const { REQUEST_STATUS } = require("../models/SiaRequest");
const config = require("./config");

// How long a single reservation may hold the exclusive right to call the
// provider. Aligned with the ACTUAL provider timeout (sia/config.js's
// timeoutMs, default 8000ms) plus a fixed allowance for the work that
// surrounds the provider call inside one request: context building before
// it, and grounded-response validation plus session persistence after it.
// Bounded on purpose -- an owner that crashes mid-flight must not hold the
// key forever, and this is the interval after which a later retry may
// safely take over.
const LEASE_OVERHEAD_MS = 7000;
const LEASE_MS = () => config.timeoutMs + LEASE_OVERHEAD_MS;

// How long a FOLLOWER (a concurrent duplicate that lost the reservation
// race) waits for the owner to finish before giving up with a deterministic
// 409. Deliberately shorter than the owner's own lease so a follower always
// resolves one way or the other while the owner is still legitimately
// working -- it never waits long enough to see the lease expire and
// mistake itself for an eligible new owner.
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

// Normalizes a question for fingerprinting ONLY -- never for answering.
// Trims and collapses internal whitespace runs so that cosmetically
// identical submissions (a trailing newline, a double space) are correctly
// recognized as the same request. Deliberately case-SENSITIVE: treating
// two differently-cased questions as identical would risk replaying an
// answer for a question the user did not actually ask, and the safe
// failure mode here is a 409 conflict, not a wrong replay.
function normalizeQuestion(question) {
  return typeof question === "string" ? question.trim().replace(/\s+/g, " ") : "";
}

// A hash, not the question text -- the question is already stored once, in
// models/SiaMessage.js, under the conversation's own ownership rules.
// Storing it a second time here would duplicate user content into an
// operational record for no benefit.
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

// True when the supplied session id materially disagrees with the one
// already recorded for this request. An OMITTED session id never
// conflicts -- that is exactly the first-turn-retry case (the client never
// learned the session id because the original response was lost), and it
// must be allowed to recover.
function sessionConflicts(existingSessionId, requestedSessionId) {
  if (!requestedSessionId) return false;
  if (!existingSessionId) return false;
  return String(existingSessionId) !== String(requestedSessionId);
}

// Atomically takes ownership of a request whose lease has expired (an
// abandoned owner) or which is sitting in `answer_ready` (a completed
// provider call whose persistence never finished). The compare-and-set is
// the `findOneAndUpdate` filter itself: it matches on the EXACT prior
// ownerToken and status, so two racing takeover attempts cannot both
// succeed -- only the first to reach MongoDB matches, and the second finds
// the document already mutated and matches nothing.
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
      // A concurrent duplicate won the unique-index race between our
      // findOne above and this create. MongoDB -- not application logic --
      // is what decided the single winner. We are definitively the
      // follower; fall through to evaluate the winner's record below.
      if (!err || err.code !== 11000) throw err;
      const winner = await SiaRequest.findOne({ user: userId, clientMessageId });
      if (!winner) throw err;
      return evaluateExisting(winner, questionFingerprint, requestedSessionId);
    }
  }

  return evaluateExisting(existing, questionFingerprint, requestedSessionId);
}

async function evaluateExisting(existing, questionFingerprint, requestedSessionId) {
  // Same key, different payload -- always a conflict, decided BEFORE the
  // provider could ever be reached, regardless of what state the prior
  // request is in.
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
    // A validated answer already exists. Take ownership so exactly one
    // caller finishes the outstanding persistence -- and note that no
    // provider call happens on this path at all.
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
    // An owner is legitimately active. This caller is a follower and must
    // NOT call the provider.
    return { outcome: OUTCOME.IN_PROGRESS, record: existing };
  }

  // The lease expired -- the previous owner crashed or failed without
  // releasing. Controlled takeover so the key stays retryable rather than
  // being permanently poisoned.
  const taken = await takeOverRequest(existing, REQUEST_STATUS.PROCESSING);
  if (taken) {
    return { outcome: OUTCOME.OWNED, record: taken.record, ownerToken: taken.ownerToken };
  }
  return { outcome: OUTCOME.IN_PROGRESS, record: existing };
}

// Commits the validated answer before session creation/persistence is
// attempted. This is the checkpoint that makes a persistence failure
// recoverable WITHOUT a second provider call.
async function markAnswerReady({ requestId, ownerToken, answer, intent, sessionId }) {
  return SiaRequest.findOneAndUpdate(
    { _id: requestId, ownerToken },
    {
      $set: {
        status: REQUEST_STATUS.ANSWER_READY,
        answer,
        intent,
        session: sessionId || null,
        processingExpiresAt: leaseExpiryFromNow(),
      },
    },
    { new: true }
  );
}

// Records the exact public payload that was returned, so any later
// duplicate replays it verbatim rather than regenerating anything.
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

// Releases a reservation after a failure that produced no usable answer
// (provider error, grounding rejection, unclassifiable question). Deleting
// rather than marking failed is deliberate: it leaves the key immediately
// and cleanly retryable, which is exactly the required "a provider or
// validation failure must not permanently poison the key" behaviour. The
// compare-and-set on ownerToken means a caller can only ever release a
// reservation it actually owns.
async function releaseRequest({ requestId, ownerToken }) {
  return SiaRequest.deleteOne({ _id: requestId, ownerToken });
}

// Bounded follower wait. Polls for the owner to reach `completed` and
// returns the stored response so the duplicate caller receives exactly the
// same answer the original caller did. Returns null if the owner is still
// working when the budget expires -- the controller then answers with the
// deterministic in-progress 409 rather than calling the provider itself.
async function awaitCompletedResponse({ userId, clientMessageId, waitMs }) {
  const budget = typeof waitMs === "number" ? waitMs : FOLLOWER_WAIT_MS();
  const deadline = Date.now() + budget;

  for (;;) {
    const current = await SiaRequest.findOne({ user: userId, clientMessageId }).lean();

    if (!current) {
      // The owner released the reservation after a failure. There is no
      // stored response to replay and this caller must not silently become
      // a new provider caller inside the same request -- report
      // in-progress/unresolved and let the client retry explicitly.
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
  normalizeQuestion,
  fingerprintQuestion,
  OUTCOME,
  LEASE_MS,
  FOLLOWER_WAIT_MS,
};
