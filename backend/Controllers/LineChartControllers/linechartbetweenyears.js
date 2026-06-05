const { UserModel } = require('../../config/Schemas');
const { getYear, getMonth } = require('date-fns');
const { fetchExpense } = require('../GetExpenseControllers/fetchExpenses');

const linechartbetweenyears = async(req, res) => {
    try {
        // Validate authenticated user
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Extract and validate years query parameter (e.g. "2022,2023")
        const yearsParam = req.query.years;
        if (!yearsParam) {
            return res.status(400).json({ success: false, message: "Years not provided" });
        }

        // Convert years string into number array
        const years = yearsParam.split(",").map((y) => Number(y.trim()));
        
        // Ensure all values are valid numbers
        if (years.some(isNaN)) {
            return res.status(400).json({ success: false, message: "Invalid year format" });
        }

        // Determine date range from smallest to largest selected year
        const startDate = new Date(Math.min(...years), 0, 1);
        const endDate = new Date(Math.max(...years), 11, 31, 23, 59, 59, 999);

        // Fetch expenses within calculated year range
        const expenses = await fetchExpense(startDate, endDate, req.userId);

        // Return empty result if no data exists
        if (!expenses.length) {
            return res.status(200).json({ success: true, data: [] });
        }

        // Define month labels for chart structure
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

        // Each month contains totals for each selected year
        const monthlyTotals = monthNames.map((month) => {
            const monthData = { month };
            years.forEach((year) => (monthData[year] = 0)); // initialize each year to 0
            return monthData;
        });

        // Aggregate expenses into corresponding month and year bucket
        expenses.forEach((expense) => {
            const date = expense.expenseDate;
            const year = getYear(date);
            const monthIndex = getMonth(date);

            if (years.includes(year)) {
                monthlyTotals[monthIndex][year] += Number(expense.expenseAmount);
            }
        });

        // Remove months where all selected years have zero totals
        const result = monthlyTotals.filter((m) =>
            Object.values(m).some((val) => typeof val === "number" && val > 0)
        );

        // Send success response
        res.status(200).json({ success: true, data: result });
    
    } catch(err) {
        // Handle server errors
        console.error('Error in linechartbetweenyears:', err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { linechartbetweenyears };