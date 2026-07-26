const { UserModel } = require('../../config/Schemas');
const { getCategoryBreakdown } = require('../../Services/ChartServices/chart.service');
const { resolveMonthRange, resolveCurrentYearRange } = require('../../Services/ChartServices/chartRangeResolver');

const barchartbycategory = async (req, res) => {
  try {
    // Validate authenticated user
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    const month = req.query.month; // Expected format: "YYYY-MM"
    let startDate, endDate;

    if (month) {
      // Parse year and month from query
      const [year, monthNum] = month.split("-").map(Number);

      // Resolve date range for the selected month
      ({ startDate, endDate } = resolveMonthRange(year, monthNum));

    } else {
      // Default: full current year
      ({ startDate, endDate } = resolveCurrentYearRange());
    }

    // Category totals for the resolved range
    const result = await getCategoryBreakdown({
      userId: req.userId,
      startDate,
      endDate,
      type: 'total'
    });

    // Send success response
    res.status(200).json({ success: true, data: result });

  } catch (err) {
      // Handle server errors
      console.error("Error in barchartbycategory:", err);
      res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { barchartbycategory };
