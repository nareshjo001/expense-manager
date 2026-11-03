// Durable record of which migrations have already been applied to this environment.
"use strict";

const mongoose = require("mongoose");

const migrationLedgerSchema = new mongoose.Schema(
  {
    // Matches a migration file's exported `id` (backend/migrations/runner.js).
    migrationId: {
      type: String,
      required: true,
      unique: true,
    },
    // Denormalized copy of the migration's description at the time it ran, so the ledger stays readable even if the migration file is later renamed, edited, or deleted.
    description: {
      type: String,
      required: true,
    },
    appliedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    // Set by whatever recorded this entry once a migration actually ran (backend/migrations/T04's execution step) -- optional here since T02 only builds the ledger itself, not migration execution.
    durationMs: {
      type: Number,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MigrationLedger", migrationLedgerSchema);
