const reportService = require("../Services/reportService");
const syncRecoveryService = require("../Services/syncRecoveryService");

const getReport = async (req, res) => {
  try {
    // Phase C -- Expense Mutation Reliability: repair-on-read. If an
    // earlier expense mutation's budget/report synchronization failed, this
    // user has a durable pending marker (models/PendingSync.js). Attempt to
    // repair it before serving the report so a user who never retries the
    // original mutation still eventually sees fresh data on a normal read,
    // not only after another mutation happens to fix it as a side effect.
    // Never throws and never blocks the report on its own failure -- a
    // repair attempt that itself fails simply leaves the marker pending for
    // the next read, and the existing report (cached, stored, or freshly
    // regenerated below) is still served.
    const repairResult = await syncRecoveryService.repairIfPending(req.userId);

    // Phase C.1 -- if repair just told us the report component is STILL
    // pending (repair failed/was superseded, or the repair lookup itself
    // failed), reportService.getReport()'s normal path must NOT be used: it
    // can return -- and then RE-CACHE -- the very stale Redis or Mongo
    // report this repair attempt just failed to fix, presenting it as if
    // synchronization had succeeded. Instead, force one direct,
    // cache-bypassing regeneration attempt (reportService.refreshReport(),
    // unchanged/untouched aside from its new optional fenceRevision
    // parameter -- not called here) so the response is either genuinely
    // fresh or a controlled, explicit failure -- never silently stale.
    const reportPossiblyStale =
      repairResult.repairLookupFailed || repairResult.reportRepairFailed || repairResult.stillPending;

    if (reportPossiblyStale) {
      try {
        const freshReport = await reportService.refreshReport(req.userId);
        if (freshReport && freshReport.skipped) {
          // Superseded by newer concurrent work for this user -- do not
          // serve a report this call cannot prove is fresh, and do not
          // fall through to the cached/stored path below either. A
          // concurrent, newer attempt is (or will be) responsible for
          // persisting the correct report; ask this client to retry.
          return res.status(503).json({
            success: false,
            message: "Financial report is still synchronizing. Please retry shortly.",
            recoveryPending: true,
          });
        }
        return res.status(200).json(freshReport);
      } catch (refreshErr) {
        // The forced refresh itself failed -- do NOT continue into
        // reportService.getReport() below, which could return/recache the
        // known-stale report as though nothing were wrong. A controlled,
        // explicit temporary failure is the correct contract here.
        console.error("Report Error (forced refresh after repair failure):", refreshErr);
        return res.status(503).json({
          success: false,
          message: "Financial report is still synchronizing. Please retry shortly.",
          recoveryPending: true,
        });
      }
    }

    // Nothing was pending (or repair fully succeeded) -- serve the user's
    // financial report, cached or freshly generated, through the normal
    // path.
    const report = await reportService.getReport(req.userId);

    res.status(200).json(report);
  } catch (error) {
    console.error("Report Error:", error);

    res.status(500).json({
      success: false,
      message: "Failed to fetch financial report.",
    });
  }
};

module.exports = {
  getReport,
};