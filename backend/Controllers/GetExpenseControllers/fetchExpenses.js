const { ExpenseModel } = require('../../config/Schemas');
const { annotateRecurringState } = require('../../Services/RecurringServices/recurringStateService');

// Raw primitive: fetch one user's expenses within an inclusive date range,
const fetchExpenseRaw = async (startDate, endDate, userId) => {
    return await ExpenseModel.find({
        userId,
        expenseDate: {
            $gte: startDate,
            $lte: endDate
        }
    }).lean();
};

// Shared primitive: fetch one user's expenses within an inclusive date range.
const fetchExpense = async (startDate, endDate, userId) => {
    const expenses = await fetchExpenseRaw(startDate, endDate, userId);
    return annotateRecurringState(userId, expenses);
};

module.exports = { fetchExpense, fetchExpenseRaw }