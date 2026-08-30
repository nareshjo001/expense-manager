// SIA conversation message -- one document per turn (one user question OR one assistant answer, never both), scoped to exactly one SiaSession and owning user. Bounded alternative to an unbounded array on the session document: pagination is a normal indexed query here. Deliberately NEVER stores: the complete Financial Report, raw LLM prompt, API key, raw provider response body, raw structured context, or hidden model reasoning; `metadata` is a small explicit set of safe operational fields, not a free-form dump.
"use strict";

const mongoose = require("mongoose");

// Mirrors ask.js's MAX_QUESTION_LENGTH for a user turn; an assistant answer gets a larger but still bounded ceiling so a malformed provider response can never grow a document unbounded.
const MAX_USER_CONTENT_LENGTH = 500;
const MAX_ASSISTANT_CONTENT_LENGTH = 4000;

// The answer-grounding transparency snapshot -- which analytics sections grounded THIS assistant answer, deterministically produced by groundingService.js at generation time (never by the LLM or client). Assistant messages only. Bounded by construction: at most one entry per groundingService.js allowlist key, each a short server-owned key/label and optional period string. `default: undefined` so a pre-existing or no-data turn stores no field at all rather than a hollow object. `period` declares NO default (not `default: null`) so an unset period stays `undefined` and Mongoose omits it from serialization entirely -- this is what makes the fresh response, persistence, resume, and history paths serialize byte-identically; an earlier `default: null` version broke that guarantee by making an absent period come back present-but-null.
const siaGroundingSourceSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, maxlength: 64 },
    label: { type: String, required: true, maxlength: 120 },
    period: { type: String, maxlength: 32 },
  },
  { _id: false }
);

const siaGroundingSchema = new mongoose.Schema(
  {
    sources: { type: [siaGroundingSourceSchema], default: undefined },
  },
  { _id: false }
);

// Workstream 1 -- bounded QueryPlan-summary sub-schema (see field comment
// below for what this is/is not). `_id: false` and no top-level default
// object literal, mirroring siaGroundingSchema's own pattern exactly, so
// an assistant message that answered via the EXISTING (non-semantic)
// pipeline stores no planSummary field at all rather than a hollow
// object -- verified by the same `default: undefined` discipline
// siaGroundingSchema's header comment documents.
const siaPlanSummarySchema = new mongoose.Schema(
  {
    metrics: { type: [String], default: undefined },
    operation: { type: String, maxlength: 32 },
    periodLabel: { type: String, maxlength: 60 },
    grouping: { type: String, maxlength: 16 },
    categoryFilter: { type: String, maxlength: 60 },
  },
  { _id: false }
);

const siaMessageSchema = new mongoose.Schema(
  {
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SiaSession",
      required: true,
      index: true,
    },

    // Denormalized onto every message (not just the session) so an ownership check never has to join back through the session document -- every message-level query filters on `user` directly.
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

    // The classified intent for a user turn, or the answered intent for an assistant turn -- null only when classification produced no supported intent.
    intent: {
      type: String,
      default: null,
    },

    // Optional client-supplied idempotency key (ask.js's `clientMessageId`). Sparse + unique per session so a retried identical request can't create a duplicate pair of messages, while omitting it stays fully supported.
    clientMessageId: {
      type: String,
      default: null,
      maxlength: 100,
    },

    // Small, explicit, bounded set of safe operational fields only -- never the raw prompt, context, provider response, or API key.
    metadata: {
      provider: { type: String, default: null },
      model: { type: String, default: null },
      latencyMs: { type: Number, default: null },
      errorCode: { type: String, default: null },
    },

    // See siaGroundingSchema above.
    grounding: { type: siaGroundingSchema, default: undefined },

    // Workstream 1 -- a bounded, server-owned QueryPlan SUMMARY
    // (sia/queryPlan.js), stored on an assistant message that answered via
    // the new semantic-routing path, so a later follow-up turn
    // ("what about last month?") can be interpreted against the prior
    // turn's metrics/operation/period/grouping/category filter WITHOUT
    // ever persisting the raw prompt, full financial context, or provider
    // response body. Deliberately NOT the full QueryPlan (no
    // responseMode/safeInterpretation/comparisonPeriod) -- only what a
    // follow-up interpretation genuinely needs.
    planSummary: { type: siaPlanSummarySchema, default: undefined },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Powers "paginate this session's messages in order" (listMessages()) and the ownership-plus-recency query loadRecentTurns() runs to bound LLM history.
siaMessageSchema.index({ session: 1, createdAt: 1 });

// Idempotency: at most one message per (session, clientMessageId) pair, only when supplied (sparse skips the index for the common null case, so omitting it never collides).
siaMessageSchema.index({ session: 1, clientMessageId: 1 }, { unique: true, sparse: true });

const SiaMessage = mongoose.model("SiaMessage", siaMessageSchema);

module.exports = SiaMessage;
module.exports.CONTENT_LIMITS = { MAX_USER_CONTENT_LENGTH, MAX_ASSISTANT_CONTENT_LENGTH };
