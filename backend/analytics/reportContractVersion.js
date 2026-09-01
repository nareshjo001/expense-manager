// Single source of truth for the report contract's version number and the "is this report current?" check. Reuses the pre-existing metadata.version field already stamped by analytics/reportGenerator.js and already asserted by tests/fixtures/reportFixtures.js / tests/report.integration.itest.js -- NOT a second, competing version mechanism. History: 1->2 for Anomaly Detection V1 (always includes a complete `anomalies` section); 2->3 for Forecasting V1 (always includes a complete `forecast` section) -- each bump treats a lower-versioned cached/persisted report as stale via the same isCurrentReport() gate below, no second version field, no global cache flush.
// Presence detection deliberately checks metadata.version, not the truthiness/content of `anomalies` itself: a valid current anomaly section can legitimately be `{ hasData: false, reasonCode: ..., }` or `{ hasData: true, flaggedCount: 0, anomalies: [], ... }` -- both "present and current," not "missing" -- so checking `report.anomalies` truthiness would misclassify those as legacy. Checking `Object.keys(doc).includes("anomalies")` would also be defeated by models/Report.js's `anomalies: { ..., default: {} }` schema default, which makes a legacy document with no stored key read back as `{}` once Mongoose applies defaults -- indistinguishable from a migrated document by truthiness/key-presence alone. `metadata.version` has no such default-masking problem: `metadata` is `required: true` with no default, so it's only ever the exact value reportGenerator.js stamped at generation time.
"use strict";

// Bumped 3->4 for Prediction Layer V1: version 4 is the first contract whose `forecast` section always carries the per-category next-month breakdown, the descriptive `dataQuality` summary, `targetMonth`, and the forecast-vs-target-month `budgetRisk` block -- a stale v3 document is simply regenerated on next read via the same isCurrentReport() gate, no migration needed since models/Report.js stores every section as Mixed.
const CURRENT_REPORT_VERSION = 9;

// True only when `report` carries a numeric metadata.version at least as new as the current contract; anything else (missing report, missing/non-object metadata, missing/non-numeric/older version) is treated as stale and regenerated -- never inferred from `anomalies` or any other section's content.
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
