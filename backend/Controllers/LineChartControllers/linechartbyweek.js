const { UserModel } = require('../../config/Schemas');
const { getWeeklyLineChart } = require('../../Services/ChartServices/chart.service');

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

        // Resolve range, fetch expenses, and bucket into calendar weeks
        const result = await getWeeklyLineChart(req.userId, selectedYear, selectedMonth);

        // Send success response
        res.status(200).json({ success: true, data: result });

        } catch (err) {
            // Handle server errors
            console.error('Error in linechartbyweek:', err);
            res.status(500).json({ message: 'Internal Server Error', success: false });
    }
};

module.exports = { linechartbyweek };
