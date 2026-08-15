const { BudgetModel } = require('../../config/Schemas');
const { MONTH_ORDER } = require('../../Services/ChartServices/chartConstants');

// Order budget records chronologically by month key.
const sortByMonthKey = (a, b) => {
    const [aMonth, aYear] = a.month.split(' ');
    const [bMonth, bYear] = b.month.split(' ');

    if (Number(aYear) !== Number(bYear)) {
        return Number(aYear) - Number(bYear);
    }

    return MONTH_ORDER.indexOf(aMonth) - MONTH_ORDER.indexOf(bMonth);
};

// Pure read: fetchBudgets() is consumed by backend/analytics/dataProvider.js's
// getAllBudgets(), which feeds analyticsContext.js during report generation
// (reportService -> reportGenerator -> analyticsContext -> dataProvider ->
// fetchBudgets). Report generation must consume already-repaired data, not
// trigger a NEW repair mid-generation -- repairIfPending() belongs at the
// entry points that decide to read Budget.spent (getbudgets.js,
// chart.service.js's getBudgetComparison, and reportService's own
// repair-on-read before it kicks off generation), not inside this internal
// data-loading helper. Calling repairIfPending() here re-entered the sync
// recovery machinery from within report generation itself, which is the
// architectural defect a previous pass introduced while only fixing the
// require-cycle crash -- removed entirely, not just deferred.
const fetchBudgets = async (userId) => {
    const budgets = await BudgetModel.find(
        { userId },
        { month: 1, budget: 1, spent: 1, _id: 0 }
    ).lean();

    return budgets.sort(sortByMonthKey);
};

module.exports = { fetchBudgets };
