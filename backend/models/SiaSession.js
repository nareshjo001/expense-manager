// SIA conversation session -- one document per user's conversation thread. Deliberately carries NO message content itself (no unbounded array) -- individual turns live in their own SiaMessage documents, queried with bounded pagination, keeping this document small and growth-safe regardless of conversation length.
"use strict";

const mongoose = require("mongoose");

const siaSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    // Bounded, optional, purely cosmetic label -- never used for lookup or ownership; capped defensively against an unbounded client-supplied string.
    title: {
      type: String,
      maxlength: 120,
      default: null,
    },

    // Denormalized counters so the session-list endpoint can render metadata without a second aggregation query. Maintained exclusively by sessionService.js -- never trusted from a client.
    messageCount: {
      type: Number,
      default: 0,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Powers "list this user's sessions, most recently active first" -- exactly the query listSessions() runs.
siaSessionSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model("SiaSession", siaSessionSchema);
