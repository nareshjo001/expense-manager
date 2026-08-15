const { BudgetModel } = require('../../config/Schemas');
const { MONTH_ORDER } = require('../../Services/ChartServices/chartConstants');
const syncRecoveryService = require('../../Services/syncRecoveryService');

// Order budget records chronologically by month key.
const sortByMonthKey = (a, b) => {
    const [aMonth, aYear] = a.month.split(' ');
    const [bMonth, bYear] = b.month.split(' ');

    if (Number(aYear) !== Number(bYear)) {
        return Number(aYear) - Number(bYear);
    }

    return MONTH_ORDER.indexOf(aMonth) - MONTH_ORDER.indexOf(bMonth);
};

// Repair-on-read, matching getbudgets.js / chart.service.js's convention.
// fetchBudgets() feeds backend/analytics/dataProvider.js's getAllBudgets(),
// consumed by analyticsContext.js for report/habit-analysis generation.
// Without this, a pending budget-recompute crash-gap could leak a stale
// Budget.spent value into analytics reports indefinitely -- this was the
// only remaining reader of Budget.spent with no repair step.
const fetchBudgets = async (userId) => {
    await syncRecoveryService.repairIfPending(userId);

    const budgets = await BudgetModel.find(
        { userId },
        { month: 1, budget: 1, spent: 1, _id: 0 }
    ).lean();

    return budgets.sort(sortByMonthKey);
};

module.exports = { fetchBudgets };