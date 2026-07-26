const { UserModel } = require('../../config/Schemas');
const { getCategoryBreakdown } = require('../../Services/ChartServices/chart.service');
const { resolveYearRange, resolveCurrentMonthRange } = require('../../Services/ChartServices/chartRangeResolver');
const { getCache, setCache } = require('../../utils/expenseCache');

const getPieCategoryData  = async (req, res) => {
    try {
        // Extract year from query parameters
        const { year, type } = req.query;

        const cacheKey = `pie:${req.userId}:${year || 'month'}:${type || 'total'}`;

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

        // Resolve date range: selected year if provided, else current month
        const { startDate, endDate } = year
            ? resolveYearRange(Number(year))
            : resolveCurrentMonthRange();

        // Category totals or counts for the resolved range
        const result = await getCategoryBreakdown({
            userId: req.userId,
            startDate,
            endDate,
            type
        });

        // Store in cache
        await setCache(cacheKey, result);

        // Send success response
        res.status(200).json({ success: true, data: result });

    } catch(err) {
        // Handle server errors
        console.error("Error in getcountforpie:", err);
        res.status(500).json({ message: "Internal Server Error", success: false });
    }
}

module.exports = { getPieCategoryData  };
