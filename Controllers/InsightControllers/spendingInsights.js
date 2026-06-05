const { UserModel, ExpenseModel } = require('../../config/Schemas')
const { groupByCategoryHelper } = require('../../Services/HelperServices/getexpense.service')
const { categoryTotals } = require('../../Services//ChartServices/chart.service')
const { weekSpendingHabit, getLeakyBucketInsight } = require('../../Services/InsightServices/weekSpendingHabit.service')

const spendingInsights = async (req, res) => {
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

    const groupedExpenses = groupByCategoryHelper(expenses);
    const totalsCategory = categoryTotals(groupedExpenses);
    
    let topCategory = null;
    let maxAmount = 0;
    let transactionCount = 0;

    for (const item of totalsCategory) {
      if (item.total > maxAmount) {
        maxAmount = item.total;
        topCategory = item.category;
        transactionCount = groupedExpenses[item.category].length;
      }
    }

    const totalSpent = expenses.reduce(
      (sum, e) => sum + Number(e.expenseAmount),
      0
    );

    const percentage = totalSpent > 0 ? (maxAmount / totalSpent) * 100 : 0;

    const spendingHabit = weekSpendingHabit(expenses); 

    const leakybucket = getLeakyBucketInsight(expenses); 
    
    const showTopCategoryInsight =
      percentage >= 40 &&
      maxAmount >= 1500 &&
      transactionCount >= 3 &&
      totalSpent >= 2000;

    const leftData = {
      topCategory,
      amount: maxAmount,
      percentage,
      showTopCategoryInsight
    }

    const data = {
      leftData,
      middleData: leakybucket,
      rightData: spendingHabit.weekendInsight
    }

    return res.status(200).json({ message: 'Card insights fetched successfully', success: true, data });

  } catch (error) {
    // Handle server errors
    console.error('Error fetching card insights:', error);
    return res.status(500).json({ message: 'Internal server error', success: false });
  }
}

module.exports = { spendingInsights }