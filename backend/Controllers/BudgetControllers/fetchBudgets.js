const { UserModel, BudgetModel } = require('../../config/Schemas');

const fetchBudgets = async (userId) => {
    return await BudgetModel.find(
        { userId },
        { month: 1, budget: 1, spent: 1, _id: 0 }
    )
    .sort({ month: 1 })
    .lean();
};

module.exports = { fetchBudgets };