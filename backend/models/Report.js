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

    risk: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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