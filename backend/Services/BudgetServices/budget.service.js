const { ExpenseModel, BudgetModel } = require('../../config/Schemas');
const { getMonthRange } = require('../HelperServices/datecal.service');

const recalculateBudget = async (userId, date) => {
    // Get the start and end of the month based on the provided date
    const { monthStart, monthEnd } = getMonthRange(date);

    // Aggregate total expense amount for this user within the month range
    const totalSpent = await ExpenseModel.aggregate([
        {
            // Match expenses belonging to this user within the current month
            $match: {
                userId,
                expenseDate: { $gte: monthStart, $lt: monthEnd }
            }
        },
        {
            // Group all matched expenses and calculate total sum
            $group: { _id: null, total: { $sum: "$expenseAmount" } }
        }
    ]);

    // If aggregation returns data, extract total. Otherwise, default to 0
    const spentAmount = totalSpent.length > 0 ? totalSpent[0].total : 0;
    
    // This is used as identifier in Budget collection (e.g., "Feb 2026")
    const month = monthStart.toLocaleString('default', {
        month: 'short',
        year: 'numeric'
    });

    // Update the budget document for this user and month.
    // Returned so callers can use the freshly recalculated document without an
    // extra query. Existing callers that ignore the return value are unaffected.
    return await BudgetModel.findOneAndUpdate(
        { userId, month },
        { $set: { spent: spentAmount } },
        { new: true, runValidators: true }
    );
};

const setBudgetForCurrentMonth = async (userId, budgetAmount) => {
  const { monthStart } = getMonthRange(new Date());

  // Month Key
  const month = monthStart.toLocaleString('default', {
    month: 'short',
    year: 'numeric'
  });

  // Ensure budget exists (upsert)
  await BudgetModel.findOneAndUpdate(
    { userId, month },
    { $set: { budget: budgetAmount } },
    { upsert: true, runValidators: true }
  );

  // Recalculate spent automatically
  await recalculateBudget(userId, new Date());
};

module.exports = { recalculateBudget, setBudgetForCurrentMonth };