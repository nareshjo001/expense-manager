const { parseISO, getYear, getMonth } = require('date-fns');
const { MONTH_NAMES: monthNames } = require('./chartConstants');
const { fetchExpense } = require('../../Controllers/GetExpenseControllers/fetchExpenses');
const { groupByCategoryHelper, bucketByWeek } = require('../HelperServices/getexpense.service');
const { BudgetModel, ExpenseModel } = require('../../config/Schemas');
const { resolveYearRange, resolveMonthRange, resolveMultiYearRange } = require('./chartRangeResolver');
const syncRecoveryService = require('../syncRecoveryService');

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

// Aggregate expenses by category as totals or transaction counts.
const getCategoryBreakdown = async ({ userId, startDate, endDate, type = 'total' }) => {
    const expenses = await fetchExpense(startDate, endDate, userId);
    const grouped = groupByCategoryHelper(expenses);
    return type === 'count' ? categoryCounts(grouped) : categoryTotals(grouped);
};

// Fetch budget versus spent totals for a year or a single month.
const getBudgetComparison = async ({ userId, mode, year, monthKey }) => {
    // Repair-on-read, matching getbudgets.js's established convention:
    // best-effort, never throws (repairIfPending self-catches internally);
    // a failed/no-op repair simply leaves existing stored values in place.
    // Without this, a pending budget-recompute crash-gap could stay
    // invisible to these chart endpoints indefinitely -- unlike
    // GET /api/getbudgets, this was the only read path that never
    // triggered repair.
    await syncRecoveryService.repairIfPending(userId);

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

    // Resolve the single month's budget document.
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

// Build monthly line chart data for a selected year.
const getMonthlyLineChart = async (userId, year) => {
    const { startDate, endDate } = resolveYearRange(year);
    const expenses = await fetchExpense(startDate, endDate, userId);

    if (!expenses.length) {
        return [];
    }

    return monthlyTotals(expenses);
};

// Build weekly line chart data for a selected month.
const getWeeklyLineChart = async (userId, year, month) => {
    const { startDate, endDate } = resolveMonthRange(year, month);
    const expenses = await fetchExpense(startDate, endDate, userId);
    return bucketByWeek(expenses, { labelType: 'weekNumber' });
};

// Build line chart data comparing months across multiple years.
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

// Build line chart data totalling all expenses by year.
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