const { UserModel, BudgetModel } = require('../../config/Schemas');

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
    // Assumes month field format like "Jan 2024"
    const budgets = await BudgetModel.find({
      userId: req.userId,
      month: new RegExp(selectedYear + '$', 'i'),
    });

    // Map database results into chart-friendly structure
    const result = budgets.map(b => ({
      month: b.month.split(' ')[0],
      budget: b.budget || 0,
      total: b.spent || 0,
    }));

    // Define correct calendar month order
    const monthOrder = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];

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