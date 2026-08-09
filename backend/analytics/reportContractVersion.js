// Single source of truth for the report contract's version number and the
// "is this report current?" check. Reuses the pre-existing
// metadata.version field already stamped by analytics/reportGenerator.js
// and already asserted by tests/fixtures/reportFixtures.js /
// tests/report.integration.itest.js -- this is NOT a second, competing
// version mechanism.
//
// Bumped from 1 to 2 for Anomaly Detection V1 (Batch 1): version 2 is the
// first contract that always includes a complete `anomalies` section.
//
// Bumped from 2 to 3 for Forecasting V1 + Risk Intelligence V1 (Batch 2):
// version 3 is the first contract that always includes complete `forecast`
// and `risk` sections. A version-2 cached or persisted report is now
// treated as stale by the exact same mechanism below -- no second version
// field, no global cache flush, just the same isCurrentReport() gate this
// module already provides, now comparing against 3.
//
// Presence detection deliberately checks metadata.version, not the
// truthiness or content of `anomalies` itself:
//   - A valid, current anomaly section can legitimately be
//     `{ hasData: false, reasonCode: "NO_ELIGIBLE_CURRENT_EXPENSES", ... }`
//     or `{ hasData: true, flaggedCount: 0, anomalies: [], ... }` -- both
//     are "present and current," not "missing."
//   - Checking `report.anomalies` truthiness would treat those valid,
//     legitimate no-data/zero-anomaly shapes as if they were legacy
//     documents, which they are not.
//   - Checking `Object.keys(doc).includes("anomalies")` would be defeated
//     by models/Report.js's own `anomalies: { ..., default: {} }` schema
//     default: a legacy Mongoose document with no stored `anomalies` key
//     would still read back as `{}` in application code once Mongoose
//     applies defaults, making it indistinguishable from a migrated
//     document by truthiness/key-presence alone.
// `metadata.version` has no such default-masking problem: `metadata` is
// `required: true` with no default, so it is only ever the exact value
// analytics/reportGenerator.js stamped at generation time -- a legacy
// document genuinely stored `version: 1` (or nothing, for anything
// generated before metadata existed at all) and a current document
// genuinely stores `version: 2`. There is no schema default in between
// that could make an old document merely *appear* migrated.
"use strict";

// Bumped from 3 to 4 for Prediction Layer V1: version 4 is the first
// contract whose `forecast` section always carries the per-category
// next-month breakdown (`nextMonthForecast.categories`), the descriptive
// `dataQuality` summary, the `targetMonth` label and the
// forecast-vs-target-month `budgetRisk` block. A version-3 cached or
// persisted report is now treated as stale by the exact same
// isCurrentReport() gate below -- no second version field, no global cache
// flush, no migration: models/Report.js stores every section as Mixed, so
// the added keys need no schema change, and a stale v3 document is simply
// regenerated on next read.
const CURRENT_REPORT_VERSION = 4;

// True only when `report` carries a numeric metadata.version at least as
// new as the current contract. Anything else (missing report, missing/
// non-object metadata, missing/non-numeric/older version) is treated as
// stale and must be regenerated -- never inferred from `anomalies` or any
// other section's content.
const isCurrentReport = (report) => {
  if (!report || typeof report !== "object") return false;
  const { metadata } = report;
  if (!metadata || typeof metadata !== "object") return false;
  return typeof metadata.version === "number" && metadata.version >= CURRENT_REPORT_VERSION;
};

module.exports = {
  CURRENT_REPORT_VERSION,
  isCurrentReport,
};
