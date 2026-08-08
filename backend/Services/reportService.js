const reportCache = require('../cache/reportCache');
const { generateReport } = require("../analytics/reportGenerator");
const FinancialReport = require("../models/Report");
const { isCurrentReport } = require("../analytics/reportContractVersion");

// Persists the freshly generated report through the existing upsert
// convention (unchanged options/shape from before Batch 1) and re-caches
// it. A freshly generated report always carries the current
// metadata.version (see analytics/reportGenerator.js), so this call is the
// single place a legacy document gets replaced with a current one -- both
// in MongoDB and in Redis -- without ever touching another user's data or
// flushing the cache wholesale.
const persistAndCache = async (userId, generatedReport) => {
  const savedReport = await FinancialReport.findOneAndUpdate(
    { user: userId },
    {
      user: userId,
      ...generatedReport,
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  ).lean();

  await reportCache.set(userId, savedReport);

  return savedReport;
};

const getReport = async (userId) => {
  const cached = await reportCache.get(userId);

  if (cached) {
    if (isCurrentReport(cached)) {
      console.log("Redis HIT");
      return cached;
    }
    // A legacy cached report (missing/older metadata.version, e.g. cached
    // before the `anomalies` section existed) is stale by contract, not by
    // content -- a valid hasData:false or zero-anomaly section would still
    // pass isCurrentReport, so this branch only ever catches genuinely old
    // documents. Fall through to the stored/regenerate path below instead
    // of returning it; the cache key is overwritten (not flushed) once a
    // current report is available.
    console.log("Redis HIT (stale report contract version, regenerating)");
  } else {
    console.log("Redis MISS");
  }

  let report = await FinancialReport.findOne({ user: userId }).lean();

  if (report) {
    if (isCurrentReport(report)) {
      await reportCache.set(userId, report);
      return report;
    }
    // A legacy persisted document -- same reasoning as the cache branch
    // above. Falls through to regeneration; persistAndCache() below
    // upserts this exact user's document in place (no other user's data is
    // touched, no collection-wide migration/backfill is run here).
    console.log("Stored report has a stale contract version, regenerating");
  }

  const generatedReport = await generateReport(userId);

  return persistAndCache(userId, generatedReport);
};

// Regenerate and cache the user's financial report.
const refreshReport = async (userId) => {
  // Drop the stale cache before regenerating.
  await reportCache.invalidate(userId);

  const generatedReport = await generateReport(userId);

  return persistAndCache(userId, generatedReport);
};

module.exports = {
  getReport,
  refreshReport,
};
