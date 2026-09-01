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
const fetchBudgets = async (userId) => {
    const budgets = await BudgetModel.find(
        { userId },
        { month: 1, budget: 1, spent: 1, _id: 0 }
    ).lean();

    return budgets.sort(sortByMonthKey);
};

module.exports = { fetchBudgets };
