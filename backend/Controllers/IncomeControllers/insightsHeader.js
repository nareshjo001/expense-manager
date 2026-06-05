const { UserModel, IncomeModel, ExpenseModel } = require('../../config/Schemas');

const getInsightsHeader = async (req, res) => {
  try {
     // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    const { period } = req.body;

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
    const topSource = incomeRecords.reduce((top, record) => {
      if (!top || record.incomeAmount > top.incomeAmount) {
        return record;
      }
    }, null);
    const totalIncomes = incomeRecords.length;
    const balance = totalIncome - totalExpenses;

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
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = {
  getInsightsHeader,
};