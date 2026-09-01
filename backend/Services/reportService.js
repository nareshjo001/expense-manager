const reportCache = require('../cache/reportCache');
const { generateReport } = require("../analytics/reportGenerator");
const FinancialReport = require("../models/Report");
const { isCurrentReport } = require("../analytics/reportContractVersion");
// Phase C.4 requirement #2 -- getReport() reads models/PendingSync.js
const PendingSync = require("../models/PendingSync");

// Persists the freshly generated report through the existing upsert
const persistAndCache = async (userId, generatedReport, options = {}) => {
  const { fenceRevision } = options;
  const isFenced = fenceRevision !== undefined && fenceRevision !== null;

  const filter = isFenced
    ? {
        user: userId,
        $or: [
          { syncRevision: { $exists: false } },
          { syncRevision: { $lte: fenceRevision } },
        ],
      }
    : { user: userId };

  // Phase C.3 -- built as a `$set` UPDATE, never a full-document
  const setFields = {
    user: userId,
    ...generatedReport,
  };
  if (isFenced) {
    setFields.syncRevision = fenceRevision;
  }
  // Remove the retired report branch from already-persisted documents as
  const update = { $set: setFields };

  // Phase C.2 correction -- this conditional write is NEVER allowed to
  const savedReport = await FinancialReport.findOneAndUpdate(filter, update, {
    new: true,
    upsert: false,
    runValidators: true,
  }).lean();

  if (savedReport) {
    // Phase C.3 -- pass the SAME revision that just fenced the Mongo write
    await reportCache.set(userId, savedReport, isFenced ? fenceRevision : null);
    return savedReport;
  }

  // No document matched the (possibly fenced) filter -- distinguish "a
  const existing = await FinancialReport.findOne({ user: userId }).lean();
  if (existing) {
    const skipped = { skipped: true, reason: 'superseded' };
    if (Number.isFinite(existing.syncRevision)) {
      skipped.currentRevision = existing.syncRevision;
    }
    return skipped;
  }

  // Genuinely the first report ever generated for this user. See
  return createFirstReport(userId, setFields, fenceRevision, isFenced);
};

// Phase C.3 requirement #3 -- atomic, race-safe first-report creation.
async function createFirstReport(userId, setFields, fenceRevision, isFenced) {
  // Phase C.3 correction -- this FIRST attempt uses the SAME (possibly
  const filter = isFenced
    ? {
        user: userId,
        $or: [
          { syncRevision: { $exists: false } },
          { syncRevision: { $lte: fenceRevision } },
        ],
      }
    : { user: userId };

  try {
    const created = await FinancialReport.findOneAndUpdate(
      filter,
      { $set: setFields, $unset: { risk: "" } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    await reportCache.set(userId, created, isFenced ? fenceRevision : null);
    return created;
  } catch (err) {
    if (!err || err.code !== 11000) {
      throw err;
    }

    // Either a genuinely concurrent first-ever creation won the raw
    const retried = await FinancialReport.findOneAndUpdate(
      filter,
      { $set: setFields, $unset: { risk: "" } },
      { new: true, upsert: false, runValidators: true }
    ).lean();

    if (retried) {
      await reportCache.set(userId, retried, isFenced ? fenceRevision : null);
      return retried;
    }

    // This attempt's own fenceRevision lost to whichever concurrent writer
    return { skipped: true, reason: 'superseded' };
  }
}

// Phase C.4 requirement #2 -- getReport() must not be able to serve a
const getReport = async (userId) => {
  const pendingSync = await PendingSync.findOne({ user: userId }).lean();
  const reportPending = Boolean(pendingSync && pendingSync.reportPending);
  const minAcceptableRevision = pendingSync ? pendingSync.revision : null;

  // A cached/stored revision is fresh enough only when there is no known
  const isFreshEnough = (candidateRevision) => {
    if (reportPending) return false;
    if (minAcceptableRevision === null || minAcceptableRevision === undefined) return true;
    return (
      candidateRevision !== null &&
      candidateRevision !== undefined &&
      candidateRevision >= minAcceptableRevision
    );
  };

  const cachedEnvelope = await reportCache.getWithRevision(userId);

  if (cachedEnvelope) {
    if (isFreshEnough(cachedEnvelope.revision) && isCurrentReport(cachedEnvelope.payload)) {
      console.log("Redis HIT");
      return cachedEnvelope.payload;
    }
    // Either a legacy cached report (stale by CONTRACT, not content -- see
    console.log(
      reportPending
        ? "Redis HIT (report recovery pending, bypassing cache)"
        : "Redis HIT (stale cached revision or contract version, regenerating)"
    );
  } else {
    console.log("Redis MISS");
  }

  let report = await FinancialReport.findOne({ user: userId }).lean();

  if (report) {
    if (isFreshEnough(report.syncRevision) && isCurrentReport(report)) {
      await reportCache.set(userId, report, report.syncRevision ?? null);
      return report;
    }
    // A legacy persisted document, OR the stored document's own revision
    console.log(
      reportPending
        ? "Stored report has a pending recovery marker, regenerating"
        : "Stored report has a stale contract version or revision, regenerating"
    );
  }

  const generatedReport = await generateReport(userId);

  return persistAndCache(userId, generatedReport);
};

// Regenerate and cache the user's financial report.
const refreshReport = async (userId, options = {}) => {
  const { fenceRevision } = options;

  const generatedReport = await generateReport(userId);

  return persistAndCache(userId, generatedReport, { fenceRevision });
};

module.exports = {
  getReport,
  refreshReport,
};
