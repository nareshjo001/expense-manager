const dataProvider = require("./dataProvider");
const { annotateRecurringState } = require("../Services/RecurringServices/recurringStateService");
const {
    buildCompletedMonthSeries,
    computeCurrentPartialMonthTotal,
    buildCompletedMonthCategorySeries,
    countActiveDays,
} = require("./forecastInputAggregator");
const { buildCurrentMonthForecastInput } = require("./currentMonthForecastInputAggregator");

const asArray = (value) => (Array.isArray(value) ? value : []);

const createAnalyticsContext = async (userId, { analysisDate } = {}) => {
    const suppliedDate = analysisDate instanceof Date ? new Date(analysisDate.getTime()) : null;
    const now = suppliedDate && !Number.isNaN(suppliedDate.getTime()) ? suppliedDate : new Date();
    const [
        currentMonthExpenses,
        previousMonthExpenses,
        currentYearExpenses,
        previousYearExpenses,
        budgetHistory
    ] = await Promise.all([
        dataProvider.getCurrentMonthExpenses(userId, now),
        dataProvider.getPreviousMonthExpenses(userId, now),
        dataProvider.getCurrentYearExpenses(userId, now),
        dataProvider.getPreviousYearExpenses(userId, now),
        dataProvider.getAllBudgets(userId)
    ]);

    const rawCurrentMonth = asArray(currentMonthExpenses);
    const rawPreviousMonth = asArray(previousMonthExpenses);
    const rawCurrentYear = asArray(currentYearExpenses);
    const rawPreviousYear = asArray(previousYearExpenses);
    const safeBudgetHistory = asArray(budgetHistory);

    // Recurring-state authority (analytics closure): the four ranges above
    const mergedForAnnotation = [
        ...rawCurrentMonth,
        ...rawPreviousMonth,
        ...rawCurrentYear,
        ...rawPreviousYear,
    ];
    const annotatedMerged = await annotateRecurringState(userId, mergedForAnnotation);
    let annotationOffset = 0;
    const takeAnnotated = (originalRange) => {
        const slice = annotatedMerged.slice(annotationOffset, annotationOffset + originalRange.length);
        annotationOffset += originalRange.length;
        return slice;
    };

    const safeCurrentMonth = takeAnnotated(rawCurrentMonth);
    const safePreviousMonth = takeAnnotated(rawPreviousMonth);
    const safeCurrentYear = takeAnnotated(rawCurrentYear);
    const safePreviousYear = takeAnnotated(rawPreviousYear);

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
    const recentExpensePool = [...safePreviousYear, ...safeCurrentYear];

    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Forecasting V2 (architecture-closure correction): forecastAnalyzer.js
    const forecastMonthlySeries = buildCompletedMonthSeries(recentExpensePool, currentMonthStart);
    const forecastCurrentPartialMonthTotal = computeCurrentPartialMonthTotal(safeCurrentMonth);

    // Prediction Layer V1: the per-category equivalent of the series above,
    const forecastCategorySeries = buildCompletedMonthCategorySeries(recentExpensePool, currentMonthStart);
    const forecastActiveDays = countActiveDays(recentExpensePool, currentMonthStart);

    // Prediction Layer V1 (corrected): the budget the user has explicitly
    const forecastTargetMonthStart = new Date(
        currentMonthStart.getFullYear(),
        currentMonthStart.getMonth() + 1,
        1
    );
    const forecastTargetMonthKey =
        `${monthNames[forecastTargetMonthStart.getMonth()]} ${forecastTargetMonthStart.getFullYear()}`;
    const forecastTargetMonthBudget =
        safeBudgetHistory.find((entry) => entry?.month === forecastTargetMonthKey) ?? null;

    // Current-month nowcast input. Raw expense records stop at this
    const currentMonthForecastInput = buildCurrentMonthForecastInput({
        recentExpensePool,
        currentMonthExpenses: safeCurrentMonth,
        currentMonthStart,
        asOfDate: now,
    });

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
        recentExpensePool,
        currentMonthStart,
        // Forecasting V2's only inputs -- aggregate-only, bounded, never
        forecastMonthlySeries,
        forecastCurrentPartialMonthTotal,
        // Prediction Layer V1 -- all aggregate-only, all derived from data
        // already fetched above.
        forecastCategorySeries,
        forecastActiveDays,
        forecastTargetMonthBudget,
        forecastCurrentMonthBudget: currentMonthBudgetDoc ?? null,
        currentMonthForecastInput,
    };

};

module.exports = {
    createAnalyticsContext
};
