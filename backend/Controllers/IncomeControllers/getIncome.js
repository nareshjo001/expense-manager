const { UserModel, IncomeModel } = require('../../config/Schemas');
const { resolvePeriod } = require('../../Services/InsightServices/periodResolver');

const getIncome = async (req, res) => {
  try {
    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    const { period } = req.query || {};
    const range = period ? resolvePeriod(period) : null;

    if (period && !range) {
      return res.status(400).json({
        success: false,
        message: 'Invalid period. Use current_month or financial_year.',
      });
    }

    const filter = { userId: user._id };
    if (range) {
      filter.incomeDate = {
        $gte: range.startDate,
        $lt: range.endDate,
      };
    }

    // Fetch income records linked to the authenticated user, optionally within the selected insight period.
    const incomeRecords = await IncomeModel.find(filter).sort({ incomeDate: -1 }); // Sort by date descending

    // Send success response with income records
    res.status(200).json({ message: 'Income records retrieved successfully', success: true, data: incomeRecords });
  } catch (err) {
    // Send generic server error response
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { getIncome };
