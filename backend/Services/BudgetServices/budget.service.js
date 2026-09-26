const { ExpenseModel, BudgetModel } = require('../../config/Schemas');
const { getMonthRange } = require('../HelperServices/datecal.service');
// DAT-002-T02 -- the "MMM YYYY" Budget.month key's canonical definition now
// lives in utils/monthKeyNormalization.js (shared with setbudget.js/
// updatebudget.js/sia/financialQueryService.js/config/Schemas.js's schema
// validator), instead of being defined independently in this file. getMonthKey
// and getMonthAnchorFromKey below keep their existing names/signatures --
// this module's established public API, already imported by
// Services/syncRecoveryService.js -- as thin wrappers over the shared util.
const { getMonthKey, parseMonthKey } = require('../../utils/monthKeyNormalization');
// Phase C.2 -- the fenceRevision guard is now enforced entirely inside the

// First-instant-of-month anchor for a given date -- the stable value
const getMonthAnchor = (date) => {
    const { monthStart } = getMonthRange(date);
    return monthStart;
};

// Phase C.3 -- the exact inverse of getMonthKey/recalculateBudget's own
// construction, now delegating to the shared parseMonthKey so this and the
// schema validator can never drift apart.
const getMonthAnchorFromKey = (monthKey) => {
    const parsed = parseMonthKey(monthKey);
    if (!parsed) return null;
    return new Date(parsed.year, parsed.monthIndex0Based, 1);
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
    const month = getMonthKey(monthStart);

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
  const month = getMonthKey(monthStart);

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
