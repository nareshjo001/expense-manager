const { ExpenseModel } = require('../../config/Schemas');
const { annotateRecurringState } = require('../../Services/RecurringServices/recurringStateService');

// Raw primitive: fetch one user's expenses within an inclusive date range,
// with no isRecurring annotation. Used by callers that will batch-annotate
// several date-range collections together in one shared query (see
// analytics/dataProvider.js + analytics/analyticsContext.js) instead of
// paying one annotateRecurringState query per collection.
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
// isRecurring on each returned object is corrected against
// RecurringExpenseModel existence here (one batched query) so every
// standalone caller (lastweekexpense/getbycategory/getbycustom/
// chart.service) inherits the authoritative value without each querying it
// separately.
const fetchExpense = async (startDate, endDate, userId) => {
    const expenses = await fetchExpenseRaw(startDate, endDate, userId);
    return annotateRecurringState(userId, expenses);
};

module.exports = { fetchExpense, fetchExpenseRaw }