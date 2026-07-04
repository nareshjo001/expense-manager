const { UserModel, ExpenseModel } = require('../../config/Schemas');

// Remove
const { generateReport } = require('../../analytics/generateReport');

const cardInsights = async (req, res) => {
  try {
    // Validate user
    const user = await UserModel.findById(req.userId);
      if (!user) {
        return res.status(401).json({ message: 'User does not exist', success: false });
      }

      // Remove 
      await generateReport(req.userId);

      const today = new Date();
      const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);

      const pastMonthExpenses = await ExpenseModel.find({
        userId: req.userId,
        expenseDate: { $gte: new Date(startDate.getTime() - 30*24*60*60*1000), $lt: startDate }
      });

      const expenses = await ExpenseModel.find({
        userId: req.userId,
        expenseDate: { $gte: startDate, $lte: endDate }
      });

      const pastMonthTotal = pastMonthExpenses.reduce((total, expense) => total + expense.expenseAmount, 0);
      const totalExpenses = expenses.reduce((total, expense) => total + expense.expenseAmount, 0);
      
      let averageDailyExpense = 0;

      if (expenses.length > 0) {

        const sortedExpenses = [...expenses].sort(
          (a, b) =>
            new Date(a.expenseDate) -
            new Date(b.expenseDate)
        );

        const firstExpenseDate = new Date(
          sortedExpenses[0].expenseDate
        );

        const trackingDays = Math.max(
          1,
          Math.ceil(
            (today - firstExpenseDate) /
            (1000 * 60 * 60 * 24)
          ) + 1
        );

        averageDailyExpense =
          totalExpenses / trackingDays;
      }

      const topCatogory = expenses.reduce((top, expense) => {
        if (!top[expense.expenseCategory]) {
          top[expense.expenseCategory] = 0;
        }
        top[expense.expenseCategory] += expense.expenseAmount;
        return top;
      }, {});

      const sortedCategories = Object.entries(topCatogory).sort((a, b) => b[1] - a[1]);
      const mostExpensiveCategory = sortedCategories.length > 0 ? sortedCategories[0][0] : null;

      const data = {
        pastMonthTotal,
        totalSpent: totalExpenses,
        dailyAverage: Math.round(averageDailyExpense * 100) / 100,
        transactionsCount: expenses.length,
        topCategory: mostExpensiveCategory,
      }

      return res.status(200).json({ message: 'Card insights fetched successfully', success: true, data });

  } catch (error) {
    // Handle server errors
    console.error('Error fetching card insights:', error);
    return res.status(500).json({ message: 'Internal server error', success: false });
  }
}

module.exports = { cardInsights }