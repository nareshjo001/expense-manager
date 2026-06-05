const { UserModel, ExpenseModel, BudgetModel } = require('../../config/Schemas')
const { calStabilityScore, getBudgetStreak, getBiggestSpendingJump } = require('../../Services/InsightServices/overallInsights.service')

const overallInsights = async (req, res) => {
  try {
    // Validate user
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    const now = new Date();

    // Current month
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Previous month
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const expenses = await ExpenseModel.find({
      userId: req.userId,
      expenseDate: { $gte: startDate, $lte: endDate }
    });

    const previousMonthExpenses = await ExpenseModel.find({
      userId: req.userId,
      expenseDate: { 
        $gte: prevMonthStart, 
        $lte: prevMonthEnd 
      }
    });

    const budgets = await BudgetModel.find({
      userId: req.userId
    })

    const stabilityDetails = calStabilityScore(expenses);
    const streak = getBudgetStreak (budgets);
    const biggestSpendingJump = getBiggestSpendingJump(expenses, previousMonthExpenses);

    const data = {
      stabilityDetails,
      streak,
      biggestSpendingJump
    }

    return res.status(200).json({ message: 'Card insights fetched successfully', success: true, data });

  } catch (error) {
    // Handle server errors
    console.error('Error fetching card insights:', error);
    return res.status(500).json({ message: 'Internal server error', success: false });
  }
}

module.exports = { overallInsights }