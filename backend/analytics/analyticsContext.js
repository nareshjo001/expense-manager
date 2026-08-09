const dataProvider = require("./dataProvider");
const {
    buildCompletedMonthSeries,
    computeCurrentPartialMonthTotal,
    buildCompletedMonthCategorySeries,
    countActiveDays,
} = require("./forecastInputAggregator");

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
    
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const currentMonthKey = `${monthNames[now.getMonth()]} ${now.getFullYear()}`;

    const currentMonthBudgetDoc = safeBudgetHistory.find(
    b => b.month === currentMonthKey
    );

    const sumExpenses = (safeCurrentMonth) =>
        asArray(safeCurrentMonth).reduce((sum, e) => sum + (Number(e?.expenseAmount) || 0), 0);

    const currentMonthEntry = {
        month: currentMonthKey,
        budget: Number(currentMonthBudgetDoc?.budget) || 0,
        spent: sumExpenses(safeCurrentMonth),
    };

    const pastMonthsHistory = safeBudgetHistory.filter((b) => b?.month !== currentMonthKey);

    const budgetAnalyzerHistory = [currentMonthEntry, ...pastMonthsHistory];

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

    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Forecasting V2 (architecture-closure correction): forecastAnalyzer.js
    // never receives `recentExpensePool` (transaction-shaped, includes
    // _id/expenseName/expenseCategory/userId) directly -- this is the
    // aggregation boundary that reduces it to a bounded, aggregate-only
    // `{ monthKey, totalAmount }` series and a single scalar partial-month
    // total before either ever reaches the analyzer. recentExpensePool
    // itself remains available below for anomaly detection only.
    const forecastMonthlySeries = buildCompletedMonthSeries(recentExpensePool, currentMonthStart);
    const forecastCurrentPartialMonthTotal = computeCurrentPartialMonthTotal(safeCurrentMonth);

    // Prediction Layer V1: the per-category equivalent of the series above,
    // plus a single descriptive active-day count. Both cross the SAME
    // aggregate-only boundary -- forecastAnalyzer.js and
    // categoryForecastAllocator.js still never receive a raw expense
    // record. No new database query: both are derived from the
    // already-fetched recentExpensePool.
    const forecastCategorySeries = buildCompletedMonthCategorySeries(recentExpensePool, currentMonthStart);
    const forecastActiveDays = countActiveDays(recentExpensePool, currentMonthStart);

    // Prediction Layer V1 (corrected): the budget the user has explicitly
    // created for the forecast's TARGET month -- the NEXT calendar month
    // after `currentMonthStart`, which is what
    // forecastAnalyzer.nextCalendarMonthForecast actually predicts. The
    // CURRENT month's budget is deliberately never used here: comparing a
    // next-month projection against this month's limit would be a
    // substitution the user never authorised.
    //
    // Built with Date arithmetic so December -> January year rollover is
    // handled by the platform, then matched EXACTLY against the
    // already-fetched budget history using this file's existing
    // `"MMM YYYY"` key convention -- no new query. config/Schemas.js's
    // budget model is per-calendar-month with no recurring/reusable
    // concept, so when the user has not created that specific month's
    // budget the forecast reports `no_budget` rather than borrowing
    // another month's figure.
    const forecastTargetMonthStart = new Date(
        currentMonthStart.getFullYear(),
        currentMonthStart.getMonth() + 1,
        1
    );
    const forecastTargetMonthKey =
        `${monthNames[forecastTargetMonthStart.getMonth()]} ${forecastTargetMonthStart.getFullYear()}`;
    const forecastTargetMonthBudget =
        safeBudgetHistory.find((entry) => entry?.month === forecastTargetMonthKey) ?? null;

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
        budgetHistory: budgetAnalyzerHistory,
        trendData,
        daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
        // Anomaly detection (V1): recentExpensePool already pools the full
        // previous + current calendar year (see the CRITICAL FIX note
        // above), which always fully contains any "preceding 12 complete
        // calendar months" window ending at the first instant of any month
        // within the current year -- so no new database query is needed
        // here, only exposing this already-computed pool and the shared
        // month anchor.
        recentExpensePool,
        currentMonthStart,
        // Forecasting V2's only inputs -- aggregate-only, bounded, never
        // transaction-shaped. forecastAnalyzer.js must never be passed
        // recentExpensePool/currentMonthExpenses directly.
        forecastMonthlySeries,
        forecastCurrentPartialMonthTotal,
        // Prediction Layer V1 -- all aggregate-only, all derived from data
        // already fetched above.
        forecastCategorySeries,
        forecastActiveDays,
        forecastTargetMonthBudget,
    };

};

module.exports = {
    createAnalyticsContext
};