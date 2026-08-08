// SIA conversation session -- Batch 2. One document per authenticated
// user's conversation thread. Deliberately carries NO message content
// itself (no unbounded array on this document) -- individual turns live in
// their own SiaMessage documents (see models/SiaMessage.js), queried with
// bounded pagination. This keeps a single session document small and
// growth-safe regardless of how long a conversation runs.
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

    // Bounded, optional, purely cosmetic label -- never used for lookup or
    // ownership. Capped defensively so a client cannot store an
    // unbounded string here.
    title: {
      type: String,
      maxlength: 120,
      default: null,
    },

    // Denormalized counters so the session-list endpoint can render useful
    // metadata without a second aggregation query per session. Maintained
    // exclusively by sia/sessionService.js -- never trusted from a client.
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

// Powers "list this user's sessions, most recently active first" --
// exactly the query sia/sessionService.js's listSessions() runs.
siaSessionSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model("SiaSession", siaSessionSchema);
