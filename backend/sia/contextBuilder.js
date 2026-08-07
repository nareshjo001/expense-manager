// SIA context builder.
//
// M1-2 scope: retrieves a user's existing Financial Report through
// reportService.getReport(userId) -- the same, unmodified service the
// authenticated GET /report route already uses -- and narrows it down to
// only the fields a known SIA intent needs. This module never queries
// MongoDB, Redis, or any model directly, never calls reportGenerator or an
// analyzer directly, and never returns the whole Report object. It performs
// no calculation, transformation, or reinterpretation of any financial
// value -- every returned value is passed through exactly as reportService
// returned it.
"use strict";

const reportService = require("../Services/reportService");

const SUPPORTED_INTENTS = new Set([
  "HEALTH_EXPLANATION",
  "SPENDING_CHANGE_EXPLANATION",
]);

// Deliberately `!== undefined && !== null`, not a truthiness check -- a
// valid `0` (e.g. totalSpent, comparePastMonth, healthScore) or a valid
// falsy-but-real value must never be treated as "missing".
function isPresent(value) {
  return value !== undefined && value !== null;
}

function noDataResult(intent) {
  return { intent, fields: null, reason: "no_data" };
}

// The report's own generation timestamp -- analytics/reportGenerator.js
// sets this exact field (`metadata.generatedAt`, an ISO string produced via
// `new Date().toISOString()`) once, at generation time. It is the only
// existing, authoritative "when was this report generated" value in the
// Report shape (confirmed in analytics/reportGenerator.js and mirrored by
// the M0-2 fixtures' buildFakeCachedReport). This module never generates a
// replacement timestamp of its own.
function getSourceReportGeneratedAt(report) {
  return report.metadata && report.metadata.generatedAt;
}

async function buildContext(userId, intent) {
  // No intent classifier or fuzzy matching exists in this milestone (see
  // backend/sia/README.md). An intent outside the two currently supported
  // values is handled with the same explicit, unguessed result as any other
  // no-data case, rather than being coerced into one of the two known
  // intents.
  if (!SUPPORTED_INTENTS.has(intent)) {
    return noDataResult(intent);
  }

  let report;
  try {
    report = await reportService.getReport(userId);
  } catch (err) {
    return noDataResult(intent);
  }

  if (!isPresent(report)) {
    return noDataResult(intent);
  }

  const sourceReportGeneratedAt = getSourceReportGeneratedAt(report);
  if (!isPresent(sourceReportGeneratedAt)) {
    return noDataResult(intent);
  }

  const summary = report.summary || {};

  if (intent === "HEALTH_EXPLANATION") {
    // Corrected mapping (M1-2 production-contract fix, Option A): the real
    // report shape never populates summary.healthScore/summary.riskLevel --
    // healthAnalyzer.js's return object has no such keys, so
    // reportGenerator.js's `healthScore: healthReport.healthScore` and
    // `riskLevel: healthReport.riskLevel` are always undefined (confirmed
    // by tracing healthAnalyzer.js -> reportGenerator.js -> Report.js).
    // The real, currently-populated source values are
    // report.financialHealth.overall and report.financialHealth.risk.label.
    // The external M1-2 output keys (`healthScore`, `riskLevel`) are kept
    // unchanged -- only their internal source expressions changed, as
    // plain aliases with no calculation or reinterpretation.
    const financialHealth = report.financialHealth;
    const overall = financialHealth && financialHealth.overall;
    const risk = financialHealth && financialHealth.risk;
    const riskLabel = risk && risk.label;

    if (
      !isPresent(financialHealth) ||
      !isPresent(overall) ||
      !isPresent(risk) ||
      !isPresent(riskLabel)
    ) {
      return noDataResult(intent);
    }

    return {
      intent,
      fields: {
        financialHealth,
        summary: {
          healthScore: overall,
          riskLevel: riskLabel,
        },
      },
      sourceReportGeneratedAt,
    };
  }

  // intent === "SPENDING_CHANGE_EXPLANATION" -- unchanged from the original
  // M1-2 implementation; summary.comparePastMonth and summary.totalSpent
  // are genuinely populated in real reports (see the M1-2 contract-gap
  // verification), so no correction applies here.
  const trends = report.trends;
  const comparePastMonth = summary.comparePastMonth;
  const totalSpent = summary.totalSpent;

  if (!isPresent(trends) || !isPresent(comparePastMonth) || !isPresent(totalSpent)) {
    return noDataResult(intent);
  }

  return {
    intent,
    fields: {
      trends,
      summary: {
        comparePastMonth,
        totalSpent,
      },
    },
    sourceReportGeneratedAt,
  };
}

module.exports = {
  buildContext,
};
