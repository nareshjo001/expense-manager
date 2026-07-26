const { UserModel } = require('../../config/Schemas');
const { getBudgetComparison } = require('../../Services/ChartServices/chart.service');
const { MONTH_ORDER: monthOrder } = require('../../Services/ChartServices/chartConstants');

const barchartbymonth = async (req, res) => {
  try {
    // Validate authenticated user
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    // Extract and validate selected year
    const selectedYear = req.query.year;
    if (!selectedYear) {
      return res.status(400).json({ message: 'Year is required', success: false });
    }

    // Fetch budgets for the selected year
    const budgetData = await getBudgetComparison({
      userId: req.userId,
      mode: 'year',
      year: selectedYear
    });

    // Map into chart-friendly structure
    const result = budgetData.map(b => ({
      month: b.month.split(' ')[0],
      budget: b.budget,
      total: b.spent,
    }));

    // Sort results chronologically by month
    result.sort(
      (a, b) => monthOrder.indexOf(a.month) - monthOrder.indexOf(b.month)
    );

    // Send success response
    return res.status(200).json({ success: true, data: result });

  } catch (err) {
    // Handle server errors
    console.error('Error in barchartbymonth:', err);
    return res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { barchartbymonth };
