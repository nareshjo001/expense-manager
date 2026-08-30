const mongoose = require("mongoose");

const financialReportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    summary: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    spending: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    budgets: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    categories: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    trends: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    habits: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    financialHealth: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    forecast: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    anomalies: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Phase C.2 -- atomic write-fencing generation stamp. Set to the
    // PendingSync.revision value that was authoritative at the moment this
    // exact document content was computed. The write that persists this
    // document is REQUIRED to be conditioned on this field (see
    // Services/reportService.js's persistAndCache) so that an older,
    // slower synchronization attempt can never overwrite a newer one --
    // the guard lives in the write's own filter, not in a separate
    // check-then-write step (which is not atomic and was proven racy).
    syncRevision: {
      type: Number,
      default: 0,
    },

  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model(
  "FinancialReport",
  financialReportSchema
);
