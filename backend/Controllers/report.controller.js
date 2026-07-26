const reportService = require("../Services/reportService");

const getReport = async (req, res) => {
  try {
    // Serve the user's financial report, cached or freshly generated.
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