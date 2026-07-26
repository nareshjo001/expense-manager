const { parseISO, getYear, getMonth } = require('date-fns');
const { MONTH_NAMES: monthNames } = require('./chartConstants');
const { fetchExpense } = require('../../Controllers/GetExpenseControllers/fetchExpenses');
const { groupByCategoryHelper, bucketByWeek } = require('../HelperServices/getexpense.service');
const { BudgetModel, ExpenseModel } = require('../../config/Schemas');
const { resolveYearRange, resolveMonthRange, resolveMultiYearRange } = require('./chartRangeResolver');

// Group expenses by year
const groupByYear = (expenses = []) => {
    const yearlyExpenses = {};

    expenses.forEach((expense) => {
        const date = parseISO(expense.expenseDate.toISOString());
        const year = getYear(date);

        if(!yearlyExpenses[year]) yearlyExpenses[year] = [];
        yearlyExpenses[year].push(expense);
    });

    const result = Object.entries(yearlyExpenses).map(([year, yearExpenses]) => {
        const total = yearExpenses.reduce((sum, exp) => sum + Number(exp.expenseAmount), 0);
        return { year: Number(year), total };
    });

    return result;
}

// Group and total expenses by month Jan - Dec
const monthlyTotals = (expenses = []) => {
    const monthlyTotals = Array(12).fill(0);

    expenses.forEach((expense) => {
        const monthIndex = getMonth(expense.expenseDate);
        monthlyTotals[monthIndex] += Number(expense.expenseAmount);
    });

    const result = monthNames.map((month, index) => ({
        month,
        total: monthlyTotals[index],
    })).filter(item => item.total > 0);

    return result;
}

// To calculate category wise totals
const categoryTotals = (groupedByCategory) => {
    const result = Object.entries(groupedByCategory).map(([category, categoryExpenses]) => {
        const total = categoryExpenses.reduce(
            (sum, exp) => sum + Number(exp.expenseAmount),
            0
        );
            return { category, total };
    });

    return result;
}

// To calculate category wise transaction counts
const categoryCounts = (groupedByCategory) => {
    const result = Object.entries(groupedByCategory).map(([category, categoryExpenses]) => {
            const total = categoryExpenses.reduce(
                (sum, exp) => sum + Number(1),
                0
            );
            return { category, total };
    });

    return result;
}

// Shared category-breakdown computation used by both the bar (category)
// chart and the pie (category) chart, replacing the two independent
// fetchExpense -> groupByCategoryHelper -> categoryTotals/categoryCounts
// chains that previously existed separately in each controller.
//
// type === 'count' -> transaction counts per category (categoryCounts)
// anything else (including undefined) -> amount totals per category
// (categoryTotals) — matches the exact dispatch logic both controllers
// already used individually.
const getCategoryBreakdown = async ({ userId, startDate, endDate, type = 'total' }) => {
    const expenses = await fetchExpense(startDate, endDate, userId);
    const grouped = groupByCategoryHelper(expenses);
    return type === 'count' ? categoryCounts(grouped) : categoryTotals(grouped);
};

// Shared budget-vs-spent retrieval used by both the monthly budget
// comparison bar chart and the current-month budget comparison pie chart.
// BudgetModel documents are keyed by a "month" string (e.g. "Jan 2026"),
// not a Date range, so this is driven by month-key string(s) rather than
// startDate/endDate — see Phase 4 disclosure for why chartRangeResolver
// doesn't apply here.
//
// mode: 'year'  -> all budget docs for a given year (barchartbymonth).
//                  Returns an array of { month, budget, spent }, each
//                  field already null-safe (0 fallback applied), with
//                  `month` left as the full "Mon YYYY" string — splitting
//                  to just the month abbreviation and sorting is display
//                  formatting specific to that one chart and stays in its
//                  controller.
// mode: 'month' -> a single budget doc for one exact month key
//                  (getcomparisonforpie). Returns null if no document
//                  exists (caller decides what "no budget set" should
//                  look like), otherwise { remaining, spent }, computed in
//                  the exact same order as the original controller
//                  (raw subtraction first, then normalize) so a
//                  document missing `spent` resolves to remaining = 0,
//                  not remaining = budget.
const getBudgetComparison = async ({ userId, mode, year, monthKey }) => {
    if (mode === 'year') {
        const budgets = await BudgetModel.find({
            userId,
            month: new RegExp(year + '$', 'i'),
        });

        return budgets.map(b => ({
            month: b.month,
            budget: b.budget || 0,
            spent: b.spent || 0,
        }));
    }

    // mode === 'month'
    const budgetDoc = await BudgetModel.findOne({ userId, month: monthKey });

    if (!budgetDoc) {
        return null;
    }

    const remaining = Math.max(0, budgetDoc.budget - budgetDoc.spent);

    return {
        remaining: Number(remaining) || 0,
        spent: Number(budgetDoc.spent) || 0,
    };
};

// Shared monthly line-chart computation for a single selected year —
// replaces linechartbymonth.js's inline year-range math + direct
// fetchExpense + direct monthlyTotals call. resolveYearRange was verified
// in Phase 2 to be byte-identical to the range this controller used to
// compute inline, so this is a zero-date-risk migration.
const getMonthlyLineChart = async (userId, year) => {
    const { startDate, endDate } = resolveYearRange(year);
    const expenses = await fetchExpense(startDate, endDate, userId);

    // Preserved from the original controller: monthlyTotals([]) already
    // resolves to [] on its own (every month ends up 0 and gets filtered
    // out), so this is a redundant-but-preserved explicit short-circuit,
    // not a behavior change.
    if (!expenses.length) {
        return [];
    }

    return monthlyTotals(expenses);
};

// Shared weekly line-chart computation for a single selected month —
// replaces linechartbyweek.js's inline month-range math + direct
// fetchExpense + direct bucketByWeek call. Note: resolveMonthRange's
// end-of-month boundary is 23:59:59.999, while this controller's original
// inline calculation was 23:59:59.000 (no milliseconds) — a disclosed,
// ~1-second widening of the range's last instant, not a functional change
// in practice. See Phase 5.2 disclosure for details.
const getWeeklyLineChart = async (userId, year, month) => {
    const { startDate, endDate } = resolveMonthRange(year, month);
    const expenses = await fetchExpense(startDate, endDate, userId);
    return bucketByWeek(expenses, { labelType: 'weekNumber' });
};

// Shared multi-year line-chart computation — replaces
// linechartbetweenyears.js's inline min/max-year range math + direct
// fetchExpense + inline month-by-year grid aggregation. resolveMultiYearRange
// was verified in Phase 2 to be byte-identical to the range this controller
// used to compute inline (no precision discrepancy, unlike the weekly case).
// The month x year grid-building logic itself is specific to this endpoint
// (distinct shape from the single-year monthlyTotals helper above), so it's
// reproduced here verbatim rather than merged into an existing helper.
const getMultiYearLineChart = async (userId, years) => {
    const { startDate, endDate } = resolveMultiYearRange(years);
    const expenses = await fetchExpense(startDate, endDate, userId);

    if (!expenses.length) {
        return [];
    }

    const grid = monthNames.map((month) => {
        const monthData = { month };
        years.forEach((year) => (monthData[year] = 0));
        return monthData;
    });

    expenses.forEach((expense) => {
        const date = expense.expenseDate;
        const year = getYear(date);
        const monthIndex = getMonth(date);

        if (years.includes(year)) {
            grid[monthIndex][year] += Number(expense.expenseAmount);
        }
    });

    return grid.filter((m) =>
        Object.values(m).some((val) => typeof val === 'number' && val > 0)
    );
};

// Shared all-time yearly line-chart computation — replaces
// linechartbyyear.js's inline ExpenseModel.find call. This intentionally
// does NOT go through fetchExpense/resolveAllTime: fetchExpense has no
// unbounded-query branch (see disclosure), so this preserves the original's
// exact direct-query approach rather than introducing new fetchExpense
// behavior out of scope for this phase.
const getYearlyLineChart = async (userId) => {
    const expenses = await ExpenseModel.find({ userId }).lean();
    return groupByYear(expenses);
};

module.exports = {
    groupByYear,
    monthlyTotals,
    categoryTotals,
    categoryCounts,
    getCategoryBreakdown,
    getBudgetComparison,
    getMonthlyLineChart,
    getWeeklyLineChart,
    getMultiYearLineChart,
    getYearlyLineChart
}