const { UserModel } = require('../../config/Schemas');
const { fetchExpense } = require('../GetExpenseControllers/fetchExpenses');
const { groupByCategoryHelper } = require('../../Services/HelperServices/getexpense.service'); 
const { categoryTotals, categoryCounts } = require('../../Services/ChartServices/chart.service');
const { getPieDateRange } = require('../../Services/HelperServices/datecal.service');
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
  
        // Get start and end date
        const { startDate, endDate } = getPieDateRange(year);

        // Fetch expenses for user within calculated date range
        const expenses = await fetchExpense(startDate, endDate, req.userId);
        
        // Group expenses by category
        const grouped = groupByCategoryHelper(expenses);
        
        let result;

        // Choose transformation based on query type
        if (type === 'count') {
            result = categoryCounts(grouped);
        } else {
            // Default → totals
            result = categoryTotals(grouped);
        }

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