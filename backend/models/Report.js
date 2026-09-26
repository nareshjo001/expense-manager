const mongoose = require("mongoose");
// DAT-002-T04 -- single source of truth for the report contract version,
// reused (not redefined) so this field can never drift from
// analytics/reportContractVersion.js's own CURRENT_REPORT_VERSION or from
// analytics/reportGenerator.js's metadata.version stamp. No require cycle:
// reportContractVersion.js has zero dependencies of its own.
const { CURRENT_REPORT_VERSION } = require("../analytics/reportContractVersion");

// DAT-002-T04 -- typed, but deliberately `strict: false` and with nothing
// but `version` marked `required`: analytics/reportGenerator.js always
// populates every one of these keys with a consistent scalar shape (unlike
// the analyzer-driven sections below, `metadata` never collapses to a
// partial/`{hasData:false}` form), confirmed by reading reportGenerator.js
// directly. `strict: false` means any field this definition does not know
// about (a future addition, or a differently-shaped legacy value) is still
// stored and read back byte-for-byte -- required for
// tests/report.schema.persistence.test.js's round-trip-equality tests,
// which this file must not break.
const reportMetadataSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    generatedAt: { type: String },
    // DAT-002-T04 -- same rationale as summary.riskLevel above: kept as
    // Mixed rather than an inline nested object, to avoid the identical
    // single-nested-subdocument auto-materialization-to-`{}` failure mode
    // on round-trip whenever a document doesn't set this field.
    reportPeriod: { type: mongoose.Schema.Types.Mixed },
    // Confirmed by reading analytics/analyticsContext.js directly: its
    // returned context object never sets lastExpenseUpdate/lastBudgetUpdate,
    // so reportGenerator.js's `?? null` fallback always applies today --
    // these are effectively vestigial. Left as Mixed (not Date) so a future
    // generator that starts populating them with a real timestamp is not
    // silently rejected or miscast before this comment is revisited.
    lastExpenseUpdate: { type: mongoose.Schema.Types.Mixed, default: null },
    lastBudgetUpdate: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false, strict: false }
);

// DAT-002-T04 -- same rationale as reportMetadataSchema above: `summary`'s
// fields are consistently scalar across every real generateReport() call
// (confirmed by reading analytics/reportGenerator.js's `summary` object
// literal directly), so typing them gives real cast/type protection with
// no risk to the round-trip fidelity tests below (`strict: false`, nothing
// required). `riskLevel` was reverse-engineered from
// analytics/analyzers/healthAnalyzer.js as `{ label, color, reason? }`, not
// the flat string this field's name alone would suggest.
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
    // DAT-002-T04 -- kept as Mixed, not a nested sub-schema: a single
    // nested subdocument path materializes to `{}` on read even when the
    // source document never set it at all, which
    // tests/report.schema.persistence.test.js caught as a real
    // byte-for-byte round-trip regression (a summary object with no
    // riskLevel key came back with `riskLevel: {}`). Mixed has no such
    // auto-materialization, so the original shape (including "absent"
    // rather than "empty object") round-trips exactly.
    riskLevel: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false, strict: false }
);

const financialReportSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      // DAT-002-T04 -- fixes docs/data/DAT-002-T01-schema-and-index-
      // inventory.md's gap 3.1: config/Schemas.js registers the user model
      // as `mongoose.model('users', userSchema)` (lowercase, plural), so a
      // `ref: "User"` here never matched any registered model name. T01
      // confirmed this was latent (no `.populate()` call anywhere in the
      // codebase depends on it), so fixing the name changes no runtime
      // behavior today -- it only stops a future `.populate('user')` call
      // from silently resolving nothing.
      ref: "users",
      required: true,
      unique: true,
      index: true,
    },

    // DAT-002-T04 -- schemaVersion is the real, top-level, typed sibling of
    // the pre-existing metadata.version stamp (analytics/
    // reportContractVersion.js's CURRENT_REPORT_VERSION, currently 9).
    // metadata.version remains the field isCurrentReport() actually reads
    // (see reportContractVersion.js's own comment on why: `metadata` is
    // `required: true` with no default, so it can never be masked by a
    // schema default the way a Mixed section with `default: {}` can) --
    // this field is additive, not a replacement, so no existing read path
    // changes. Populated by analytics/reportGenerator.js from the same
    // shared constant, so the two can never drift apart.
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

    // DAT-002-T04 -- left as Mixed, deliberately. Investigated whether this
    // (and every other section below) could be strictly typed: read every
    // analyzer that produces it (analytics/analyzers/spendingAnalyzer.js)
    // directly, and confirmed its shape has TWO structurally different
    // forms -- `{ hasData: false }` alone, or a much larger populated
    // object -- plus tests/report.schema.persistence.test.js already
    // enforces byte-for-byte round-trip equality
    // (`expect(rehydrated.spending).toEqual(attrs.spending)`) against
    // exactly this section for both forms. A strict sub-schema risks
    // rejecting or reshaping a real write the moment any analyzer's output
    // varies even slightly from what was typed -- unverifiable here since
    // this environment has no live MongoDB to prove `runValidators: true`
    // (Services/reportService.js's real write path) tolerates it. Current
    // (v9) shape, confirmed by reading spendingAnalyzer.js directly:
    // `{ hasData: false }`, or `{ hasData: true, totalSpent, totalRefunds,
    // transactionCount, largestExpense, smallestExpense, trackingDays,
    // trackingWeeks, dailyAverage, weeklyAverage, periodStart,
    // dataQualityWarning?, stability: { coefficientOfVariation,
    // weeklyTotals, reason } }`.
    spending: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // DAT-002-T04 -- left as Mixed; see `spending` above for why. Current
    // (v9) shape (analytics/analyzers/budgetAnalyzer.js +
    // Services/BudgetServices/budgetInsight.service.js): always
    // `{ hasData: true, budget, spent, hasBudget, isOverspent, exceededBy,
    // status, currentStreak, longestStreak, streakBrokenReason,
    // projectedSpent, projectedOverspend, projectedOverspendPercent,
    // daysUntilExhaustion, projectionReliable, projectionStatus,
    // budgetInsights: { type, title, message, tip } }`; utilization/
    // remainingBudget/budgetLeft are null when hasBudget is false.
    budgets: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // DAT-002-T04 -- left as Mixed; see `spending` above for why. Current
    // (v9) shape, confirmed against analytics/reportAssembler.js (which
    // nests categoryAnalyzer.js's two calls under `monthly`/`yearly`, so
    // this field name does match what is actually stored -- T01's gap 3.1
    // note about a possible categories/habits key mismatch was
    // investigated here and refuted): `{ monthly: <categoryAnalyzer
    // output>, yearly: <categoryAnalyzer output> }`, each either
    // `{ hasData: false }` or `{ hasData: true, topCategory,
    // leastCategory, categoryDistribution: [...], concentrationIndex,
    // top3Concentration, categoryGrowth: [...], biggestJump, biggestDrop }`.
    categories: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // DAT-002-T04 -- left as Mixed; see `spending` above for why. Current
    // (v9) shape (analytics/analyzers/trendAnalyzer.js): either
    // `{ hasData: false, dailyTrend, weeklyTrend, monthlyTrend,
    // quarterlyTrend }` (each a `{ current, previous, amountChange,
    // percentageChange, isNewSpending, direction }`), or the same plus
    // `spendingDirection`/`spendingDirectionStrength` when there is data.
    trends: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // DAT-002-T04 -- left as Mixed; see `spending` above for why, and
    // `categories` above for the same monthly/yearly nesting confirmation.
    // Current (v9) shape (analytics/analyzers/habitAnalyzer.js): each of
    // `monthly`/`yearly` is either `{ hasData: false }` or
    // `{ hasData: true, weekendVsWeekday, microSpending, impulseSpending,
    // subscriptionPattern, shoppingFrequency }`.
    habits: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // DAT-002-T04 -- left as Mixed; see `spending` above for why. Current
    // (v9) shape (analytics/analyzers/healthAnalyzer.js): `{ scores: {
    // budget, category, spending, trend, habit, stability } (each
    // { score, maxScore, normalizedScore, reason }), overall,
    // dataCompleteness: { includedModules, excludedModules }, risk:
    // { label, color, reason? }, signals: [{ type, id, metric, value,
    // message }] }`.
    financialHealth: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // DAT-002-T04 -- left as Mixed; see `spending` above for why -- this is
    // the most structurally volatile section of all (two separate
    // analyzers, five forecast horizons, per-category breakdowns, and its
    // own dataQuality/budgetRisk sub-objects). Current (v9) shape
    // (analytics/analyzers/forecastAnalyzer.js +
    // currentMonthForecastAnalyzer.js): `{ hasData, method,
    // historyMonthsAvailable, targetMonth, dataQuality, nextCalendarMonthForecast,
    // budgetRisk, currentPartialMonth, nextMonthForecast,
    // nextQuarterForecast, nextYearForecast, currentMonthForecast }` -- the
    // last of these merged in separately by reportGenerator.js, not part of
    // forecastAnalyzer.js's own return value.
    forecast: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // DAT-002-T04 -- left as Mixed; see `spending` above for why. Current
    // (v9) shape (analytics/analyzers/expenseAnomalyAnalyzer.js): `{
    // hasData, reasonCode, baselineWindow, evaluatedExpenseCount,
    // eligibleCategoryCount, insufficientHistoryCategoryCount,
    // flaggedCount, monthlyReference, anomalies: [{ expenseId,
    // expenseName, category, amount, expenseDate, severity, reasonCode,
    // baseline, impact, detection }] }`.
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
