const { UserModel, BudgetModel } = require('../../config/Schemas');
const { getCache, setCache } = require('../../utils/expenseCache');

const getcomparisonforpie = async (req, res) => {
    try {
        // Get current month in format: "Feb 2026"
        const currentMonth = new Date().toLocaleString('en-US', { month: 'short', year: 'numeric' });

        const cacheKey = `pieComparison:${req.userId}:${currentMonth}`;

        // Check cache first
        const cachedData = getCache(cacheKey);
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

        // Find budget document for current user & current month
        const budgetDoc = await BudgetModel.findOne({ userId: req.userId, month: currentMonth });

        // If no budget record exists → return zero values for pie chart
        if (!budgetDoc) {
            return res.status(200).json({
                success: true,
                data: [
                { category: 'Budget', total: 0 },
                { category: 'Spent', total: 0 }
                ]
            });
        }

        const remaining = Math.max(0, budgetDoc.budget - budgetDoc.spent);

        // Prepare response array for Pie Chart
        const result = [
            { category: 'Remaining', total: Number(remaining) || 0 },
            { category: 'Spent', total: Number(budgetDoc.spent) || 0 }
        ];

        // Store Cache
        setCache(cacheKey, result);
        
        // Send success response
        res.status(200).json({ success: true, data: result });

    } catch(err) {
        // Handle server errors
        console.error("Error in getcomparisonforpie:", err);
        res.status(500).json({ message: "Internal Server Error", success: false });
    }
}

module.exports = { getcomparisonforpie };