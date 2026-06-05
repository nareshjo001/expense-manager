const { UserModel, IncomeModel, ExpenseModel } = require('../../config/Schemas');
const { getFinancialRunwayData, getSavingsRateData, getIncomeDependencyData } = require('../../Services/InsightServices/income.service');

const getInsightsCard = async (req, res) => {
  try {
     // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    const { period } = req.body || {};

    const now = new Date();
    let startDate;
    let endDate;

    switch (period) {
      case 'current_month':
        startDate = new Date(
          now.getFullYear(),
          now.getMonth(),
          1
        );

        // First day of next month
        endDate = new Date(
          now.getFullYear(),
          now.getMonth() + 1,
          1
        );
        break;

      case 'financial_year': {
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth(); // 0-11

        // Indian FY: Apr 1 -> Mar 31
        const fyStartYear =
          currentMonth >= 3
            ? currentYear
            : currentYear - 1;

        startDate = new Date(fyStartYear, 3, 1); // Apr 1
        endDate = new Date(fyStartYear + 1, 3, 1); // Apr 1 next year

        break;
      }

      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid period. Use current_month or financial_year.',
        });
    }

    const incomeRecords = await IncomeModel.find({
      userId: user._id,
      incomeDate: {
        $gte: startDate,
        $lt: endDate,
      },
    }).sort({ incomeDate: -1 });

    const expenseRecords = await ExpenseModel.find({
      userId: user._id,
      expenseDate: {
        $gte: startDate,
        $lt: endDate,
      },
    }).sort({ expenseDate: -1 }); 

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
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getInsightsCard,
};