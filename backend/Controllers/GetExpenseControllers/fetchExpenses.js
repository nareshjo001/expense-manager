const { ExpenseModel } = require('../../config/Schemas');

// Shared primitive: fetch one user's expenses within an inclusive date range.
const fetchExpense = async (startDate, endDate, userId) => {
    return await ExpenseModel.find({
        userId,
        expenseDate: {
            $gte: startDate,
            $lte: endDate
        }
    }).lean();
};

module.exports = { fetchExpense }