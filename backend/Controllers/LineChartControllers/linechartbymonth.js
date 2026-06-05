const { UserModel } = require('../../config/Schemas');
const { monthlyTotals } = require('../../Services/ChartServices/chart.service');
const { fetchExpense } = require('../GetExpenseControllers/fetchExpenses');

const linechartbymonth = async (req, res) => {
    try {
        // Validate authenticated user
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Extract and validate selected year
        const selectedYear = Number(req.query.selectedYear);

        if (!selectedYear || isNaN(selectedYear)) {
            return res.status(400).json({ message: 'Valid selectedYear is required', success: false });
        }

        // Define full year date range
        const startDate = new Date(selectedYear, 0, 1);
        const endDate = new Date(selectedYear + 1, 0, 0, 23, 59, 59, 999);

        // Fetch expenses for the selected year
        const expenses = await fetchExpense(startDate, endDate, req.userId);

        // If no data, return empty array
        if (!expenses.length) {
            return res.status(200).json({ success: true, data: [] });
        }

        // Group expenses into monthly totals
        const result = monthlyTotals(expenses);

        // Success response
        res.status(200).json({ success: true, data: result });

    } catch(err) {
        // Handle server errors
        console.error('Error in linechartbymonth:', err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { linechartbymonth };