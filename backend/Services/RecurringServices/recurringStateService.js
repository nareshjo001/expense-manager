const { RecurringExpenseModel } = require('../../models/RecurringExpense');

// Single source of truth for "is this expense recurring": RecurringExpenseModel
// document existence, never the (possibly stale) Expense.isRecurring mirror
// field. Accepts one expense-like object or an array of them and always
// returns the same shape back (single in -> single out, array in -> array
// out). Read-only -- never writes to the database -- and issues at most one
// batched query total, never one per expense.
const annotateRecurringState = async (userId, expenseOrExpenses) => {
    const isArrayInput = Array.isArray(expenseOrExpenses);
    const list = isArrayInput ? expenseOrExpenses : [expenseOrExpenses];

    // Collect unique expense ids up front so a mixed/duplicate collection
    // still results in exactly one query.
    const idSet = new Set();
    for (const exp of list) {
        if (exp && exp._id !== undefined && exp._id !== null) {
            idSet.add(String(exp._id));
        }
    }

    let recurringIdSet = new Set();
    if (idSet.size > 0) {
        // User-scoped -- another user's RecurringExpense definitions can
        // never influence this result, even if expense ids were somehow
        // shared/guessed.
        const definitions = await RecurringExpenseModel.find(
            { userId, expenseId: { $in: [...idSet] } },
            { expenseId: 1 }
        ).lean();
        recurringIdSet = new Set(definitions.map((d) => String(d.expenseId)));
    }

    const annotated = list.map((exp) => {
        if (!exp || exp._id === undefined || exp._id === null) return exp;
        // Always overwritten -- the stored mirror value is never trusted or
        // exposed once authoritative data is available.
        return { ...exp, isRecurring: recurringIdSet.has(String(exp._id)) };
    });

    return isArrayInput ? annotated : annotated[0];
};

module.exports = { annotateRecurringState };
