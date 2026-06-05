const { UserModel } = require('../../config/Schemas');
const { fetchExpense } = require('../GetExpenseControllers/fetchExpenses');
const { categoryTotals } = require('../../Services/ChartServices/chart.service');
const { groupByCategoryHelper } = require('../../Services/HelperServices/getexpense.service');

const barchartbycategory = async (req, res) => {
  try {
    // Validate authenticated user
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    let expenses;
    const month = req.query.month; // Expected format: "YYYY-MM"

    if (month) {
      // Parse year and month from query
      const [year, monthNum] = month.split("-").map(Number);

      // Create date range for selected month
      const startDate = new Date(year, monthNum - 1, 1);
      const endDate = new Date(year, monthNum, 0);

      // Fetch expenses within selected month
      expenses = await fetchExpense(startDate, endDate, req.userId);
    
    } else {
      // Default: use full current year
      const currentYear = new Date().getFullYear();
      const startDate = new Date(currentYear, 0, 1);
      const endDate = new Date(currentYear, 11, 31, 23, 59, 59, 999);

      expenses = await fetchExpense(startDate, endDate, req.userId);
    }

    // Group expenses by category
    const groupedByCategory = groupByCategoryHelper(expenses);

    // Calculate total amount per category
    const result = categoryTotals(groupedByCategory);

    // Send success response
    res.status(200).json({ success: true, data: result });
  
  } catch (err) {
      // Handle server errors
      console.error("Error in barchartbycategory:", err);
      res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { barchartbycategory };