const { UserModel, ExpenseModel } = require('../../config/Schemas');
const { groupByYear } = require('../../Services/ChartServices/chart.service');

const linechartbyyear = async (req, res) => {
    try {
        // Validate authenticated user
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Fetch all expenses for the user
        const expenses = await ExpenseModel.find({ userId: req.userId }).lean();

        // Group expenses by year for line chart visualization
        const result = groupByYear(expenses);

        // Send successful response
        res.status(200).json({ success: true, data: result });

    } catch(err) {
        // Handle unexpected server errors
        console.error('Error in linechartbyyear:', err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { linechartbyyear };