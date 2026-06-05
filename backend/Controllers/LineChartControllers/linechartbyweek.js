const { UserModel } = require('../../config/Schemas');
const { fetchExpense } = require('../GetExpenseControllers/fetchExpenses');
const { bucketByWeek } = require('../../Services/HelperServices/getexpense.service');

const linechartbyweek = async (req, res) => {
    try {
        // Validate user
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        const { selectedYear, selectedMonth } = req.query;

        // Validate query params
        if (!selectedYear || !selectedMonth) {
            return res.status(400).json({ message: 'Year and month are required', success: false });
        }

        // Create month range
        const startDate = new Date(selectedYear, selectedMonth - 1, 1);
        const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59); // end of the month

        // Fetch monthly expenses
        const expenses = await fetchExpense(startDate, endDate, req.userId);

        // Group into calendar weeks (Mon–Sun)
        const result = bucketByWeek(expenses, { labelType: 'weekNumber' });

        // Send success response
        res.status(200).json({ success: true, data: result });

        } catch (err) {
            // Handle server errors 
            console.error('Error in linechartbyweek:', err);
            res.status(500).json({ message: 'Internal Server Error', success: false });
    }
};

module.exports = { linechartbyweek };