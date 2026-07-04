const dataProvider = require("./dataProvider");

const asArray = (value) => (Array.isArray(value) ? value : []);

const createAnalyticsContext = async (userId) => {
    const [
        currentMonthExpenses,
        previousMonthExpenses,
        currentYearExpenses,
        previousYearExpenses,
        budgetHistory
    ] = await Promise.all([
        dataProvider.getCurrentMonthExpenses(userId),
        dataProvider.getPreviousMonthExpenses(userId),
        dataProvider.getCurrentYearExpenses(userId),
        dataProvider.getPreviousYearExpenses(userId),
        dataProvider.getAllBudgets(userId)
    ]);

    const safeCurrentMonth = asArray(currentMonthExpenses);
    const safePreviousMonth = asArray(previousMonthExpenses);
    const safeCurrentYear = asArray(currentYearExpenses);
    const safePreviousYear = asArray(previousYearExpenses);
    const safeBudgetHistory = asArray(budgetHistory);

    const now = new Date();
    const weekStartsOn = 1; // Monday
    
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);

    // Distance in days back to the configured week-start weekday.
    const dayOfWeek = startOfToday.getDay(); // 0=Sun .. 6=Sat
    const daysSinceWeekStart = (dayOfWeek - weekStartsOn + 7) % 7;
    
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - daysSinceWeekStart);
    
    const startOfPreviousWeek = new Date(startOfWeek);
    startOfPreviousWeek.setDate(startOfPreviousWeek.getDate() - 7);
    
    const endOfPreviousWeek = new Date(startOfWeek);
    
    const currentQuarter = Math.floor(now.getMonth() / 3);
    
    const startOfQuarter = new Date(now.getFullYear(), currentQuarter * 3, 1);

    const startOfPreviousQuarter = new Date(now.getFullYear(), currentQuarter * 3 - 3, 1);
 
    const endOfPreviousQuarter = new Date(startOfQuarter);

    const filterBetween = (expenses, start, end) => {
        return asArray(expenses).filter((e) => {
            const d = new Date(e?.expenseDate);
            if (Number.isNaN(d.getTime())) return false; // skip malformed dates silently, don't crash
            return d >= start && d < end;
        });
    };

    // CRITICAL FIX: `yesterday`, `previousWeek`, and `previousQuarter` can
    // all fall in the PREVIOUS calendar year (any date near Jan 1st).
    // Filtering only against `currentYearExpenses` silently returns an
    // empty array for those periods near year boundaries, which then
    // looks like "₹0 spent last quarter" and manufactures a bogus 100%+
    // spike in the trend report. Pool both years before filtering.
    const recentExpensePool = [...safePreviousYear, ...safeCurrentYear];

    const trendData = {
        today: filterBetween(recentExpensePool, startOfToday, startOfTomorrow),
        yesterday: filterBetween(recentExpensePool, startOfYesterday, startOfToday),
        currentWeek: filterBetween(recentExpensePool, startOfWeek, startOfTomorrow),
        previousWeek: filterBetween(recentExpensePool, startOfPreviousWeek, endOfPreviousWeek),
        currentQuarter: filterBetween(recentExpensePool, startOfQuarter, startOfTomorrow),
        previousQuarter: filterBetween(
        recentExpensePool,
        startOfPreviousQuarter,
        endOfPreviousQuarter
        ),
    };

    return {
        currentMonthExpenses: safeCurrentMonth,
        previousMonthExpenses: safePreviousMonth,
        currentYearExpenses: safeCurrentYear,
        previousYearExpenses: safePreviousYear,
        budgetHistory: safeBudgetHistory,
        trendData,
        daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    };

};

module.exports = {
    createAnalyticsContext
};