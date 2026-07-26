const { UserModel } = require('../../config/Schemas');
const { getYearlyLineChart } = require('../../Services/ChartServices/chart.service');

const linechartbyyear = async (req, res) => {
    try {
        // Validate authenticated user
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Fetch all expenses for the user and group by year
        const result = await getYearlyLineChart(req.userId);

        // Send successful response
        res.status(200).json({ success: true, data: result });

    } catch(err) {
        // Handle unexpected server errors
        console.error('Error in linechartbyyear:', err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { linechartbyyear };
