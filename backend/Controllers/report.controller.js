const reportService = require("../Services/reportService");
const syncRecoveryService = require("../Services/syncRecoveryService");

const getReport = async (req, res) => {
  try {
    // Phase C -- Expense Mutation Reliability: repair-on-read. If an
    const repairResult = await syncRecoveryService.repairIfPending(req.userId);

    // Phase C.1 -- if repair just told us the report component is STILL
    const reportPossiblyStale =
      repairResult.repairLookupFailed || repairResult.reportRepairFailed || repairResult.stillPending;

    if (reportPossiblyStale) {
      try {
        const freshReport = await reportService.refreshReport(req.userId);
        if (freshReport && freshReport.skipped) {
          // Superseded by newer concurrent work for this user -- do not
          return res.status(503).json({
            success: false,
            message: "Financial report is still synchronizing. Please retry shortly.",
            recoveryPending: true,
          });
        }
        return res.status(200).json(freshReport);
      } catch (refreshErr) {
        // The forced refresh itself failed -- do NOT continue into
        console.error("Report Error (forced refresh after repair failure):", refreshErr);
        return res.status(503).json({
          success: false,
          message: "Financial report is still synchronizing. Please retry shortly.",
          recoveryPending: true,
        });
      }
    }

    // Nothing was pending (or repair fully succeeded) -- serve the user's
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