const mongoose = require("mongoose");
// Version stamp. js has zero dependencies of its own.
const { CURRENT_REPORT_VERSION } = require("../analytics/reportContractVersion");

// Js directly. js's round-trip-equality tests, which this file must not break.
const reportMetadataSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    generatedAt: { type: String },
    // RiskLevel above: kept as Mixed rather than an inline nested object, to avoid the identical single-nested-subdocument auto-materialization-to-`{}` failure mode on round-trip whenever a document doesn't set this field.
    reportPeriod: { type: mongoose.Schema.Types.Mixed },
    // Js's `?? null` fallback always applies today -- these are effectively vestigial.
    lastExpenseUpdate: { type: mongoose.Schema.Types.Mixed, default: null },
    lastBudgetUpdate: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false, strict: false }
);

// Js's `summary` object literal directly), so typing them gives real cast/type protection with no risk to the round-trip fidelity tests below (`strict: false`, nothing required).
const reportSummarySchema = new mongoose.Schema(
  {
    totalSpent: { type: Number },
    transactionCount: { type: Number },
    dailyAverage: { type: Number },
    comparePastMonth: { type: Number },
    topCategory: { type: String },
    budgetUtilization: { type: Number },
    budgetStatus: { type: String },
    healthScore: { type: Number },
    // Js caught as a real byte-for-byte round-trip regression (a summary object with no riskLevel key came back with `riskLevel: {}`).
    riskLevel: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false, strict: false }
);

const financialReportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      // Model('users', userSchema)` (lowercase, plural), so a `ref: "User"` here never matched any registered model name.
      ref: "users",
      required: true,
      unique: true,
      index: true,
    },

    // Js's CURRENT_REPORT_VERSION, currently 9).
    schemaVersion: {
      type: Number,
      default: CURRENT_REPORT_VERSION,
    },

    metadata: {
      type: reportMetadataSchema,
      required: true,
    },

    summary: {
      type: reportSummarySchema,
      default: {},
    },

    // Left as Mixed, deliberately. spending)`) against exactly this section for both forms.
    spending: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Left as Mixed; see `spending` above for why.
    budgets: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Left as Mixed; see `spending` above for why. ], biggestJump, biggestDrop }`.
    categories: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Left as Mixed; see `spending` above for why.
    trends: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Left as Mixed; see `spending` above for why, and `categories` above for the same monthly/yearly nesting confirmation.
    habits: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Left as Mixed; see `spending` above for why.
    financialHealth: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Left as Mixed; see `spending` above for why -- this is the most structurally volatile section of all (two separate analyzers, five forecast horizons, per-category breakdowns, and its own dataQuality/budgetRisk sub-objects).
    forecast: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Left as Mixed; see `spending` above for why.
    anomalies: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // )` write path, the only place a report is persisted). js returns.
    insights: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Phase C.2 -- atomic write-fencing generation stamp. Set to the
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
