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

    // ANL-001-T04 -- fixes a real bug found while starting this task:
    // analytics/reportGenerator.js has computed and attached this field to
    // every generated report since ANL-001-T03, but this schema never
    // declared it, and Mongoose's default `strict: true` mode silently
    // strips any undeclared path from a `$set` update before it reaches
    // MongoDB (confirmed against Services/reportService.js's
    // `FinancialReport.findOneAndUpdate(filter, { $set: setFields }, ...)`
    // write path, the only place a report is persisted). In effect,
    // `report.insights` never survived a single write -- every cached or
    // re-read report was missing it entirely, even though it looked
    // correct in the in-memory object reportGenerator.js returns. Declared
    // here the same way every other analyzer-output section above is
    // (Mixed, defaulting to `{}`), for the same reason documented on
    // `spending` et al.: the shape has multiple structurally different
    // sub-forms (`{hasData:false, ...}` vs a populated object, per
    // analyzer) that a strict sub-schema would risk rejecting or
    // reshaping. See tests/report.schema.persistence.test.js for the
    // round-trip regression test this fix adds.
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
