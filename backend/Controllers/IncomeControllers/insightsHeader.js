const { UserModel, IncomeModel, ExpenseModel } = require('../../config/Schemas');
const { resolvePeriod } = require('../../Services/InsightServices/periodResolver');

const getInsightsHeader = async (req, res) => {
  try {
     // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    const { period } = req.body;

    const range = resolvePeriod(period);

    if (!range) {
      return res.status(400).json({
        success: false,
        message: 'Invalid period. Use current_month or financial_year.',
      });
    }

    const { startDate, endDate } = range;

    // Independent queries — run concurrently instead of sequentially.
    const [incomeRecords, expenseRecords] = await Promise.all([
      IncomeModel.find({
        userId: user._id,
        incomeDate: {
          $gte: startDate,
          $lt: endDate,
        },
      }).sort({ incomeDate: -1 }),

      ExpenseModel.find({
        userId: user._id,
        expenseDate: {
          $gte: startDate,
          $lt: endDate,
        },
      }).sort({ expenseDate: -1 }),
    ]);

    // Aggregate period totals and identify the single largest income source.
    const totalIncome = incomeRecords.reduce((sum, record) => sum + record.incomeAmount, 0);
    const totalExpenses = expenseRecords.reduce((sum, record) => sum + record.expenseAmount, 0);
    const topSource = incomeRecords.reduce((top, record) => {
      if (!top || record.incomeAmount > top.incomeAmount) {
        return record;
      }
    }, null);
    const totalIncomes = incomeRecords.length;
    const balance = totalIncome - totalExpenses;

    // Build the header summary response.
    const data = {
      totalIncome,
      totalExpenses,
      topSource: topSource ? topSource.incomeSource : "N/A",
      totalIncomes,
      balance,
    }

    res.json({ success: true, data, message: "Insights header data fetched successfully" });

    // Implementation for fetching insights header data
  } catch (error) {
    console.error("Error fetching insights header:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  getInsightsHeader,
};