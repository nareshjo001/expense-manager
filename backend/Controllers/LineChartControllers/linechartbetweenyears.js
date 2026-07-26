const { UserModel } = require('../../config/Schemas');
const { getMultiYearLineChart } = require('../../Services/ChartServices/chart.service');

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

        // Resolve range, fetch expenses, and build the month x year grid
        const result = await getMultiYearLineChart(req.userId, years);

        // Send success response
        res.status(200).json({ success: true, data: result });

    } catch(err) {
        // Handle server errors
        console.error('Error in linechartbetweenyears:', err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { linechartbetweenyears };
