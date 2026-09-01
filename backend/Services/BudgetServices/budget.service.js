const { ExpenseModel, BudgetModel } = require('../../config/Schemas');
const { getMonthRange } = require('../HelperServices/datecal.service');
// Phase C.2 -- the fenceRevision guard is now enforced entirely inside the

// Phase C -- Expense Mutation Reliability: the SAME "MMM YYYY" convention
const getMonthKey = (date) => {
    const { monthStart } = getMonthRange(date);
    return monthStart.toLocaleString('default', {
        month: 'short',
        year: 'numeric'
    });
};

// First-instant-of-month anchor for a given date -- the stable value
const getMonthAnchor = (date) => {
    const { monthStart } = getMonthRange(date);
    return monthStart;
};

const MONTH_ABBREVIATIONS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Phase C.3 -- the exact inverse of getMonthKey/recalculateBudget's own
const getMonthAnchorFromKey = (monthKey) => {
    if (typeof monthKey !== 'string') return null;
    const match = monthKey.trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
    if (!match) return null;

    const monthIndex = MONTH_ABBREVIATIONS.indexOf(match[1]);
    if (monthIndex === -1) return null;

    const year = Number(match[2]);
    if (!Number.isFinite(year)) return null;

    return new Date(year, monthIndex, 1);
};

// Phase C.2 -- `options.fenceRevision`: an optimistic-concurrency fence
const recalculateBudget = async (userId, date, options = {}) => {
    const { fenceRevision } = options;

    // Resolve the month range for the given date.
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

    // Build the month key used by the Budget collection.
    const month = monthStart.toLocaleString('default', {
        month: 'short',
        year: 'numeric'
    });

    if (fenceRevision === undefined || fenceRevision === null) {
        // Store the recalculated spend on the budget document -- original,
        // unfenced behavior.
        return await BudgetModel.findOneAndUpdate(
            { userId, month },
            { $set: { spent: spentAmount } },
            { new: true, runValidators: true }
        );
    }

    const updated = await BudgetModel.findOneAndUpdate(
        {
            userId,
            month,
            $or: [
                { syncRevision: { $exists: false } },
                { syncRevision: { $lte: fenceRevision } },
            ],
        },
        { $set: { spent: spentAmount, syncRevision: fenceRevision } },
        { new: true, runValidators: true }
    );

    if (updated) {
        return updated;
    }

    // The atomic write did not apply -- either no BudgetModel document
    const existing = await BudgetModel.findOne({ userId, month }).select('_id syncRevision').lean();
    if (existing) {
        const skipped = { skipped: true, reason: 'superseded' };
        if (Number.isFinite(existing.syncRevision)) {
            skipped.currentRevision = existing.syncRevision;
        }
        return skipped;
    }
    return null;
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

module.exports = { recalculateBudget, setBudgetForCurrentMonth, getMonthKey, getMonthAnchor, getMonthAnchorFromKey };
