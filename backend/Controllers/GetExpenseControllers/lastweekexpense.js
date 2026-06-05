const { UserModel } = require('../../config/Schemas');
const { fetchExpense } = require('./fetchExpenses');
const { getLastWeekQueryDates } = require('../../Services/HelperServices/datecal.service');
const { sortDescending, sortAscending, bucketByWeek } = require('../../Services/HelperServices/getexpense.service');
const { getCache, setCache } = require('../../utils/expenseCache');

const lastWeekExpense = async (req, res) => {
    try {
        const cacheKey = `lastWeek:${req.userId}`;
        
        // Check cache first
        const cachedData = getCache(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                message: 'Success (cached)',
                ...cachedData,
                success: true
            });
        }

        // Validate user existence
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Date ranges
        const {
            now,
            sevenDaysAgo,
            fourteenDaysAgo,
            fourtyTwoDaysAgo
        } = getLastWeekQueryDates();

        // Fetch all expenses for the last 42 days (single DB call)
        const allExpenses = await fetchExpense(
            fourtyTwoDaysAgo,
            now,
            user._id
        );

        // Last 7 days expenses (sorted newest → oldest)
        const expenses = sortDescending(
            allExpenses.filter(e =>
                e.expenseDate >= sevenDaysAgo
            )
        );

        // Previous 7 days expenses (sorted newest → oldest)
        const previousSeven = sortDescending(
            allExpenses.filter(e =>
                e.expenseDate >= fourteenDaysAgo &&
                e.expenseDate < sevenDaysAgo
            )
        );

        // Weekly grouped data for last 42 days (needs ascending)
        const weeklyData = bucketByWeek(
            sortAscending(allExpenses)
        );

        const responseData = {
            data: expenses,
            previousData: previousSeven,
            weeklyData
        };

        // Store in cache
        setCache(cacheKey, responseData);

        // Send response
        res.status(200).json({ message: 'Success', data: expenses, previousData: previousSeven, weeklyData: weeklyData, success: true });
    
    } catch (err) {
        // Handle server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
};

module.exports = { lastWeekExpense }