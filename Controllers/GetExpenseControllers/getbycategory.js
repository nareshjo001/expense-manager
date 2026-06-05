const { UserModel } = require('../../config/Schemas');
const { groupByMonth, groupByCategoryHelper, sortDescending } = require('../../Services/HelperServices/getexpense.service');
const { fetchExpense } = require('./fetchExpenses');
const { getCache, setCache } = require('../../utils/expenseCache');

const getByCategory = async (req, res) => {
    try {
        const cacheKey = `category:${req.userId}:${req.query.period || 'year'}`;
        
        // Check cache FIRST
        const cachedData = getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                message: 'Success (cached)',
                ...cachedData,
                success: true
            });
        }

        // Validate authenticated user
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        let startDate;
        let endDate;
        let history = [];

        // Handle period-based filtering
        if (req.query.period === 'thismonth') {
            
            const now = new Date();
            
             // Current month range
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

            // Go back 3 months for history
            const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);

            // Fetch all expenses for last 3 months (single DB call)
            const allExpenses = await fetchExpense(threeMonthsAgo, endDate, user._id);

            // Generate monthly grouped history
            history = groupByMonth(allExpenses);
        
        } else {

            // Default case: Full current year range
            const now = new Date();
            startDate = new Date(now.getFullYear(), 0, 1);
            endDate = new Date(now.getFullYear() + 1, 0, 0, 23, 59, 59, 999);
        }

        // Fetch expenses for selected range (current month or full year)
        const expenses = sortDescending(
            await fetchExpense(startDate, endDate, user._id)
        )

        // Group expenses by category
        const groupedExpenses = groupByCategoryHelper(expenses);

        const responseData = {
            data: groupedExpenses,
            pastThreeMonths: history
        };

        setCache(cacheKey, responseData);

        // Send response
        res.status(200).json({ message: 'Success', data: groupedExpenses, pastThreeMonths: history, success: true });
    
    } catch (err) {
        // Handle unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
};

module.exports = { getByCategory };