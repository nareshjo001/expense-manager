// SIA idempotent request record -- one document per (user, clientMessageId) pair, the persistent coordination point that makes `clientMessageId` a REQUEST-level idempotency key rather than only a persistence-deduplication key. Before this model, clientMessageId was only read inside appendTurn() (runs AFTER ask.js's askLlm()), so a sequential retry invoked the provider twice and two concurrent duplicates both reached it -- SiaMessage's unique index deduplicated stored rows only, never the provider call, and couldn't help a first-turn retry (no session yet to scope the key to). Deliberately NEVER stores: structured financial context, system prompt, raw provider response, API key, or hidden model reasoning -- only the question FINGERPRINT (a hash, not the text), the validated answer, and the exact public HTTP payload already returned.
"use strict";

const mongoose = require("mongoose");

// `grounding` used to be Schema.Types.Mixed (no shape enforcement); mirrors SiaMessage.js's siaGroundingSourceSchema/siaGroundingSchema exactly (server-owned key/label/optional period, `_id: false`) -- duplicated here rather than shared since both are small; extract a shared module if a third grounding-bearing model appears. `period` declares NO default for the same reason as SiaMessage.js: `default: null` broke byte-identical RESUME reconstruction by turning an absent period present-but-null; unset stays undefined and Mongoose omits it.
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

// The request lifecycle: `processing` is an exclusive LEASED reservation (only the owner may call the provider); `answer_ready` means a validated answer exists but session persistence may not have finished (recovery completes without calling the provider again); `completed` means the response payload was already returned and is safe to replay verbatim.
const REQUEST_STATUS = Object.freeze({
  PROCESSING: "processing",
  ANSWER_READY: "answer_ready",
  COMPLETED: "completed",
});

// Mirrors ask.js's validation ceiling and SiaMessage.js's clientMessageId maxlength, so the three can never disagree.
const MAX_CLIENT_MESSAGE_ID_LENGTH = 100;

// Matches SiaMessage.js's assistant-content ceiling -- the stored answer is the same string that document holds.
const MAX_ANSWER_LENGTH = 4000;

// Bounded retention -- operational bookkeeping, not conversation history (that's SiaMessage). 24h is far longer than any realistic retry window or processing lease (idempotencyService.js's LEASE_MS, bounded by provider timeout), so this TTL can never delete an actively processing request.
const RETENTION_SECONDS = 24 * 60 * 60;

const siaRequestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    // The exact client-supplied key, already trimmed and length-validated by the controller before it reaches this model.
    clientMessageId: {
      type: String,
      required: true,
      maxlength: MAX_CLIENT_MESSAGE_ID_LENGTH,
    },

    // A SHA-256 hex digest of the normalized question, never the text itself -- enough to detect "same key, different payload" (a 409 conflict) without storing the question again.
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

    // Ownership token for the compare-and-set guaranteeing only ONE caller ever advances a request -- a follower that loses the race never holds a matching token and can never write here or call the provider.
    ownerToken: {
      type: String,
      default: null,
    },

    // When the current `processing` lease expires. A request still `processing` past this is presumed abandoned and may be atomically taken over by a later retry -- keeps a provider/validation failure from permanently poisoning the key.
    processingExpiresAt: {
      type: Date,
      default: null,
    },

    // The session this request resolved to, once one exists. Null for a brand-new conversation until the validated answer is in hand -- creation is deferred so a failed first turn never leaves an empty conversation.
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SiaSession",
      default: null,
    },

    // The validated answer, stored at the `answer_ready` checkpoint so a recovery after a persistence failure can finish WITHOUT a second provider call.
    answer: {
      type: String,
      default: null,
      maxlength: MAX_ANSWER_LENGTH,
    },

    intent: {
      type: String,
      default: null,
    },

    // The same immutable grounding snapshot (groundingService.js) computed for this answer, stored at the same `answer_ready` checkpoint as answer/intent so a RESUME_ANSWER_READY recovery finishes without a second provider call AND without losing which analytics sources grounded it. Schema-bound (siaRequestGroundingSchema above), matching SiaMessage.js's shape exactly -- never the structured financial context itself.
    grounding: {
      type: siaRequestGroundingSchema,
      default: undefined,
    },

    // The exact HTTP status and body already returned to a client -- replay returns these verbatim, never re-classifies, re-builds context, re-invokes the provider, re-validates, or re-appends a turn.
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

// THE request-level identity: user-scoped, NOT session-scoped -- a session-scoped key can't protect a new conversation's first turn (no session to scope it to yet). Unique so two concurrent duplicates can't both create a reservation: MongoDB decides the winner, the loser becomes a follower. OPERATIONAL NOTE: created by Mongoose's autoIndex on connect (db.js uses default options, autoIndex enabled) -- if autoIndex is ever disabled in production, this index MUST be created manually or concurrent duplicates can both reserve.
siaRequestSchema.index({ user: 1, clientMessageId: 1 }, { unique: true });

// Bounded retention -- see RETENTION_SECONDS above.
siaRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

const SiaRequest = mongoose.model("SiaRequest", siaRequestSchema);

module.exports = SiaRequest;
module.exports.REQUEST_STATUS = REQUEST_STATUS;
module.exports.REQUEST_LIMITS = Object.freeze({
  MAX_CLIENT_MESSAGE_ID_LENGTH,
  MAX_ANSWER_LENGTH,
  RETENTION_SECONDS,
});
