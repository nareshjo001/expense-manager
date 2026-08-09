// SIA idempotent request record -- Batch 3B.1.
//
// One document per (user, clientMessageId) pair. This is the persistent
// coordination point that makes `clientMessageId` a REQUEST-level
// idempotency key rather than only a persistence-deduplication key.
//
// Why this exists (Batch 3B.0 finding): before this model,
// `clientMessageId` was only ever read inside sia/sessionService.js's
// appendTurn(), which runs AFTER Controllers/SiaControllers/ask.js has
// already called askLlm(). A sequential retry therefore invoked the
// provider a second time and returned a NEWLY GENERATED answer while
// silently keeping the ORIGINAL answer in storage, and two concurrent
// duplicates both reached the provider. The unique index on
// models/SiaMessage.js's (session, clientMessageId) deduplicated the
// stored rows only -- never the provider call and never the HTTP response.
// It also could not help a first-turn retry at all, because a brand-new
// conversation has no session to scope that key to yet.
//
// Deliberately NEVER stores: the structured financial context, the system
// prompt, the raw provider response body, an API key, or hidden model
// reasoning. It stores the user's normalized-question FINGERPRINT (a hash,
// not the question text), the final validated answer, and the exact public
// HTTP payload that was already returned to the client -- nothing more.
"use strict";

const mongoose = require("mongoose");

// Batch 3F acceptance remediation (requirement 3): `grounding` below used
// to be `mongoose.Schema.Types.Mixed`, which enforces no shape at all --
// any property, including an accidental `_id`, `__v`, a raw internal
// identifier, or a client-influenced value, could in principle survive a
// write. This mirrors models/SiaMessage.js's own
// siaGroundingSourceSchema/siaGroundingSchema shape exactly (server-owned
// `key`/`label`/optional `period` only, both levels `_id: false` so no
// subdocument identity field is auto-generated). It is duplicated here
// rather than extracted into a shared module: the two models' grounding
// fields are independently small, and this batch's file-count budget does
// not add a new production file for a four-line schema. If a third
// grounding-bearing model is ever added, extracting a shared module then
// would be the right call.
// `period` declares NO default, for exactly the reason documented on
// models/SiaMessage.js's siaGroundingSourceSchema: `default: null` turned
// an absent period into a present-but-null one on the way back out, so an
// answer-ready RESUME reconstructed a snapshot that was not byte-identical
// to the one the original attempt returned. Unset stays undefined, and
// Mongoose omits it from serialization.
const siaRequestGroundingSourceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 64 },
    label: { type: String, required: true, maxlength: 120 },
    period: { type: String, maxlength: 32 },
  },
  { _id: false }
);

const siaRequestGroundingSchema = new mongoose.Schema(
  {
    sources: { type: [siaRequestGroundingSourceSchema], default: undefined },
  },
  { _id: false }
);

// The request lifecycle. `processing` is an exclusive, LEASED reservation:
// exactly one caller owns it at a time, and only the owner may call the
// provider. `answer_ready` means a validated answer exists but session
// persistence may not have finished -- a recovery can complete from here
// WITHOUT calling the provider again. `completed` means the exact response
// payload below was already returned to a client and is safe to replay
// verbatim.
const REQUEST_STATUS = Object.freeze({
  PROCESSING: "processing",
  ANSWER_READY: "answer_ready",
  COMPLETED: "completed",
});

// Mirrors Controllers/SiaControllers/ask.js's own validation ceiling for
// the client-supplied key, and models/SiaMessage.js's existing
// clientMessageId maxlength, so the three can never disagree.
const MAX_CLIENT_MESSAGE_ID_LENGTH = 100;

// Matches models/SiaMessage.js's assistant-content ceiling -- the stored
// answer is the same string that document holds, so the same bound applies.
const MAX_ANSWER_LENGTH = 4000;

// Bounded retention. A request record is operational bookkeeping, not
// conversation history (that lives in SiaMessage), so it does not need to
// be kept for the life of the conversation. 24h is far longer than any
// realistic client retry window and far longer than any processing lease
// (see sia/idempotencyService.js's LEASE_MS, which is bounded by the
// provider timeout), so this TTL can never delete an ACTIVELY processing
// request -- an active lease expires in seconds, this retention in hours.
const RETENTION_SECONDS = 24 * 60 * 60;

const siaRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    // The exact client-supplied key, already trimmed and length-validated
    // by the controller before it ever reaches this model.
    clientMessageId: {
      type: String,
      required: true,
      maxlength: MAX_CLIENT_MESSAGE_ID_LENGTH,
    },

    // A SHA-256 hex digest of the normalized question -- never the question
    // text itself. Enough to detect "same key, different payload" (which
    // must be a 409 conflict) without storing the question a second time.
    questionFingerprint: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: Object.values(REQUEST_STATUS),
      required: true,
      default: REQUEST_STATUS.PROCESSING,
    },

    // Ownership token for the compare-and-set that guarantees only ONE
    // caller ever advances a given request. A follower that loses the race
    // never holds a matching token and therefore can never write to this
    // document or call the provider.
    ownerToken: {
      type: String,
      default: null,
    },

    // When the current `processing` lease expires. A request still in
    // `processing` past this instant is presumed abandoned (crashed owner,
    // killed process) and may be atomically taken over by a later retry --
    // this is what keeps a provider/validation failure from permanently
    // poisoning the key.
    processingExpiresAt: {
      type: Date,
      default: null,
    },

    // The session this request resolved to, once one exists. Null for a
    // brand-new conversation until the validated answer is in hand --
    // session creation is deliberately deferred so a failed first turn
    // never leaves an empty, user-visible conversation behind.
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SiaSession",
      default: null,
    },

    // The validated answer, stored at the `answer_ready` checkpoint so a
    // recovery after a persistence failure can finish WITHOUT a second
    // provider call.
    answer: {
      type: String,
      default: null,
      maxlength: MAX_ANSWER_LENGTH,
    },

    intent: {
      type: String,
      default: null,
    },

    // Batch 3F: the same immutable grounding snapshot
    // (backend/sia/groundingService.js) computed for this answer, stored at
    // the same `answer_ready` checkpoint as `answer`/`intent` above so a
    // RESUME_ANSWER_READY recovery (a persistence failure after a validated
    // answer already exists) can finish without a second provider call AND
    // without losing which analytics sources actually grounded that
    // specific answer. Structured and schema-bound (see
    // siaRequestGroundingSchema above), matching models/SiaMessage.js's own
    // grounding shape exactly -- this is already-small, already-sanitized,
    // non-secret data (server-owned keys/labels/optional periods only,
    // with unknown properties stripped by Mongoose's schema-level casting),
    // never the structured financial context itself.
    grounding: {
      type: siaRequestGroundingSchema,
      default: undefined,
    },

    // The exact HTTP status and body already returned to a client. Replay
    // returns these verbatim -- it never re-classifies, re-builds context,
    // re-invokes the provider, re-validates, or re-appends a turn.
    responseStatus: {
      type: Number,
      default: null,
    },
    responsePayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// THE request-level identity: user-scoped, NOT session-scoped. A
// session-scoped key cannot protect the first turn of a new conversation
// (no session exists yet to scope it to) -- which was exactly the
// unrecoverable case Batch 3B.0 identified. Unique so that two concurrent
// duplicates cannot both create a reservation: MongoDB decides the winner,
// and the loser becomes a follower rather than a second provider caller.
//
// OPERATIONAL NOTE: this index is created by Mongoose's autoIndex on
// connect (config/db.js calls mongoose.connect with default options, so
// autoIndex remains enabled). If autoIndex is ever disabled in a deployed
// environment, this index MUST be created manually before the idempotency
// guarantee holds -- without it, concurrent duplicates can both reserve.
siaRequestSchema.index({ user: 1, clientMessageId: 1 }, { unique: true });

// Bounded retention (see RETENTION_SECONDS above).
siaRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

const SiaRequest = mongoose.model("SiaRequest", siaRequestSchema);

module.exports = SiaRequest;
module.exports.REQUEST_STATUS = REQUEST_STATUS;
module.exports.REQUEST_LIMITS = Object.freeze({
  MAX_CLIENT_MESSAGE_ID_LENGTH,
  MAX_ANSWER_LENGTH,
  RETENTION_SECONDS,
});
