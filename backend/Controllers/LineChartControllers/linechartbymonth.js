const { UserModel } = require('../../config/Schemas');
const { getMonthlyLineChart } = require('../../Services/ChartServices/chart.service');

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

        // Resolve range, fetch expenses, and generate monthly totals
        const result = await getMonthlyLineChart(req.userId, selectedYear);

        // Success response
        res.status(200).json({ success: true, data: result });

    } catch(err) {
        // Handle server errors
        console.error('Error in linechartbymonth:', err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { linechartbymonth };
