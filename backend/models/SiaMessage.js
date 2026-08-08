// SIA conversation message -- Batch 2. One document per turn (one user
// question OR one assistant answer -- never both combined), always scoped
// to exactly one SiaSession and one owning user. This is the bounded
// alternative to storing messages in an unbounded array on the session
// document itself: pagination is a normal indexed query here, not an
// array slice that grows the parent document without limit.
//
// Deliberately NEVER stores: the complete Financial Report, the raw LLM
// prompt, an API key, the raw provider response body, the raw structured
// context payload sent to the LLM, or any hidden model reasoning/
// chain-of-thought. `metadata` is a small, explicit, bounded set of safe
// operational fields only (see the schema below) -- not a free-form dump.
"use strict";

const mongoose = require("mongoose");

// Mirrors Controllers/SiaControllers/ask.js's own MAX_QUESTION_LENGTH for
// a user turn; an assistant answer is allowed a larger but still explicitly
// bounded ceiling so a malformed/misbehaving provider response can never
// grow a document without limit.
const MAX_USER_CONTENT_LENGTH = 500;
const MAX_ASSISTANT_CONTENT_LENGTH = 4000;

const siaMessageSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SiaSession",
      required: true,
      index: true,
    },

    // Denormalized onto every message (not just the session) so an
    // ownership check never has to join back through the session document
    // first -- every message-level query can filter on `user` directly.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },

    content: {
      type: String,
      required: true,
      maxlength: MAX_ASSISTANT_CONTENT_LENGTH,
    },

    // The classified intent for a user turn, or the intent that was
    // answered for an assistant turn -- null only for a turn where
    // classification produced no supported intent.
    intent: {
      type: String,
      default: null,
    },

    // Optional client-supplied idempotency key (see
    // Controllers/SiaControllers/ask.js's optional `clientMessageId` body
    // field). Sparse + unique per session so a retried identical request
    // cannot create a duplicate pair of messages, while omitting it
    // entirely (existing clients) remains fully supported.
    clientMessageId: {
      type: String,
      default: null,
      maxlength: 100,
    },

    // Small, explicit, bounded set of safe operational fields only --
    // never the raw prompt, context, provider response, or API key.
    metadata: {
      provider: { type: String, default: null },
      model: { type: String, default: null },
      latencyMs: { type: Number, default: null },
      errorCode: { type: String, default: null },
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Powers "paginate this session's messages in order" -- the core
// pagination query sia/sessionService.js's listMessages() runs, and the
// ownership-plus-recency query loadRecentTurns() runs to bound how much
// history is ever loaded into an LLM call.
siaMessageSchema.index({ session: 1, createdAt: 1 });

// Idempotency: at most one message per (session, clientMessageId) pair,
// but only when a client actually supplied one (sparse skips the index
// entirely for the common null case, so omitting it never collides).
siaMessageSchema.index({ session: 1, clientMessageId: 1 }, { unique: true, sparse: true });

const SiaMessage = mongoose.model("SiaMessage", siaMessageSchema);

module.exports = SiaMessage;
module.exports.CONTENT_LIMITS = { MAX_USER_CONTENT_LENGTH, MAX_ASSISTANT_CONTENT_LENGTH };
