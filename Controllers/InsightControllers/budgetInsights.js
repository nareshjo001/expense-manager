const { UserModel, ExpenseModel, BudgetModel } = require('../../config/Schemas')
const { analyzeBudget } = require('../../Services/BudgetServices/budgetInsight.service')

const budgetInsights = async (req, res) => {
  try {
      // Validate user
      const user = await UserModel.findById(req.userId);
        if (!user) {
          return res.status(401).json({ message: 'User does not exist', success: false });
        }
  
        const startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const endDate = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
  
        const expenses = await ExpenseModel.find({
          userId: req.userId,
          expenseDate: { $gte: startDate, $lte: endDate }
        });

        currentMonth = new Date().toLocaleString('default', {
          month: 'short',
          year: 'numeric'
        });
        
        const budget = await BudgetModel.findOne({
          userId: req.userId,
          month: currentMonth
        });
        
        if (!budget) {
          return res.status(200).json({
            message: 'No budget found for current month',
            success: true,
            data: null
          });
        }

        const report = analyzeBudget(expenses, budget);
  
        return res.status(200).json({ message: 'Budgets insights fetched successfully', success: true, data: report });
  
    } catch (error) {
      // Handle server errors
      console.error('Error fetching card insights:', error);
      return res.status(500).json({ message: 'Internal server error', success: false });
    }
}

module.exports = { budgetInsights }