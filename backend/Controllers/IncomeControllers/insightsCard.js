const { UserModel, IncomeModel, ExpenseModel } = require('../../config/Schemas');
const { getFinancialRunwayData, getSavingsRateData, getIncomeDependencyData } = require('../../Services/InsightServices/income.service');
const { resolvePeriod } = require('../../Services/InsightServices/periodResolver');

const getInsightsCard = async (req, res) => {
  try {
     // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    const { period } = req.body || {};

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

    const totalIncome = incomeRecords.reduce((sum, record) => sum + record.incomeAmount, 0);
    const totalExpenses = expenseRecords.reduce((sum, record) => sum + record.expenseAmount, 0);
        const trackedDays = Math.max(
      1,
      Math.ceil(
        (new Date() - startDate) / (1000 * 60 * 60 * 24)
      ) + 1
    );

    const runwayData = getFinancialRunwayData(
      totalIncome,
      totalExpenses,
      trackedDays
    );

    const savingsRateData = getSavingsRateData(
      totalIncome,
      totalExpenses
    );

    const incomeDependencyData = getIncomeDependencyData(incomeRecords);

    const data = {
      runwayData,
      savingsRateData,
      incomeDependencyData,
    }

    res.json({ success: true, data, message: "Insights card data fetched successfully" });

    // Implementation for fetching insights card data
  } catch (error) {
    console.error("Error fetching insights card:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

module.exports = {
  getInsightsCard,
};