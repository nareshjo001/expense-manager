const { BudgetModel } = require('../../config/Schemas');
const { MONTH_ORDER } = require('../../Services/ChartServices/chartConstants');
// syncRecoveryService is required LAZILY (inside fetchBudgets(), not here at
// module scope) because it sits on a real CommonJS require cycle:
// syncRecoveryService -> reportService -> analytics/reportGenerator ->
// analytics/analyticsContext -> analytics/dataProvider -> fetchBudgets.
// A top-level require here made fetchBudgets.js's module.exports still
// under construction when syncRecoveryService (transitively) required it
// back, so syncRecoveryService's own export sometimes wasn't finished
// initializing by the time fetchBudgets ran, yielding
// "repairIfPending is not a function". Resolving it at call time, after
// both modules have fully finished their initial `require` pass, avoids
// depending on module load order. chart.service.js and getbudgets.js were
// checked and are NOT on this cycle (both are only required by Controllers
// outside the syncRecoveryService -> reportService -> ... chain), so their
// top-level requires are left unchanged.

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
    // Resolve lazily to break the syncRecoveryService → report generation → fetchBudgets cycle.
    const syncRecoveryService = require('../../Services/syncRecoveryService');
    await syncRecoveryService.repairIfPending(userId);

    const budgets = await BudgetModel.find(
        { userId },
        { month: 1, budget: 1, spent: 1, _id: 0 }
    ).lean();

    return budgets.sort(sortByMonthKey);
};

module.exports = { fetchBudgets };