const { UserModel } = require('../../config/Schemas');
const { getBudgetComparison } = require('../../Services/ChartServices/chart.service');
const { getCache, setCache } = require('../../utils/expenseCache');

const getcomparisonforpie = async (req, res) => {
    try {
        // Get current month in format: "Feb 2026"
        const currentMonth = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });

        const cacheKey = `pieComparison:${req.userId}:${currentMonth}`;

        // Check cache first
        const cachedData = await getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: cachedData,
                message: 'Success (cached)'
            });
        }

        // Validate user
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Find budget comparison for current user & current month
        const comparison = await getBudgetComparison({
            userId: req.userId,
            mode: 'month',
            monthKey: currentMonth
        });

        // If no budget record exists → return zero values for pie chart
        // (not cached, matching the original behavior)
        if (!comparison) {
            return res.status(200).json({
                success: true,
                data: [
                { category: 'Budget', total: 0 },
                { category: 'Spent', total: 0 }
                ]
            });
        }

        // Prepare response array for Pie Chart
        const result = [
            { category: 'Remaining', total: comparison.remaining },
            { category: 'Spent', total: comparison.spent }
        ];

        // Store Cache
        await setCache(cacheKey, result);

        // Send success response
        res.status(200).json({ success: true, data: result });

    } catch(err) {
        // Handle server errors
        console.error("Error in getcomparisonforpie:", err);
        res.status(500).json({ message: "Internal Server Error", success: false });
    }
}

module.exports = { getcomparisonforpie };
