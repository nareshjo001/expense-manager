const { ExpenseModel, BudgetModel } = require('../../config/Schemas');
const { getMonthRange } = require('../HelperServices/datecal.service');
// Phase C.2 -- the fenceRevision guard is now enforced entirely inside the
// atomic BudgetModel.findOneAndUpdate call itself (see recalculateBudget
// below), so this module no longer needs to read PendingSync directly.

// Phase C -- Expense Mutation Reliability: the SAME "MMM YYYY" convention
// recalculateBudget/setBudgetForCurrentMonth already use to key BudgetModel
// documents, extracted as a pure, additive helper so
// Services/syncRecoveryService.js can de-duplicate pending-repair months
// without re-deriving (and risking drifting from) this format a second
// time. Does not change either existing function's behavior.
const getMonthKey = (date) => {
    const { monthStart } = getMonthRange(date);
    return monthStart.toLocaleString('default', {
        month: 'short',
        year: 'numeric'
    });
};

// First-instant-of-month anchor for a given date -- the stable value
// syncRecoveryService.js stores/de-duplicates pending budget months by.
// Any date within the same month always normalizes to the same anchor.
const getMonthAnchor = (date) => {
    const { monthStart } = getMonthRange(date);
    return monthStart;
};

const MONTH_ABBREVIATIONS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Phase C.3 -- the exact inverse of getMonthKey/recalculateBudget's own
// `monthStart.toLocaleString('default', { month: 'short', year: 'numeric' })`
// formatting: turns a stored BudgetModel `month` string (e.g. "Jan 2026")
// back into the first-instant-of-month Date recalculateBudget expects.
// Needed by syncRecoveryService.js's broad (reservedUserWide) repair pass,
// which discovers WHICH months to recompute by enumerating existing
// BudgetModel documents for a user -- it only has each one's string
// `month` key, not a Date. Deliberately hand-parsed (not `new Date(key)`)
// because that constructor's exact behavior for a bare "MMM YYYY" string
// is not reliably specified across JS engines -- this always parses
// exactly the format getMonthKey() itself produces, and returns null for
// anything else rather than guessing.
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
// enforced ATOMICALLY at the write itself, not by a separate check before
// it. C.1's original approach (read PendingSync.revision, compare, THEN
// issue an unconditional $set) was proven racy: another writer can confirm
// a newer revision and persist AFTER this call's check passes but BEFORE
// its own write lands, and the unconditional $set would still clobber it.
//
// The fix: the write's own filter requires the stored `syncRevision` on
// THIS EXACT BudgetModel document to be absent or <= fenceRevision, and the
// SAME update that sets `spent` also stamps `syncRevision: fenceRevision`.
// MongoDB evaluates a `findOneAndUpdate` filter and applies its update as a
// single atomic operation on one document -- there is no window between
// "checked" and "written" for another writer to land in. Two concurrent
// calls can never both win for a fenceRevision where one is <= the other;
// whichever one's write lands FIRST sets `syncRevision` to its own value,
// and the second one's filter then fails to match (its fenceRevision is not
// > the now-stored value), so it is atomically rejected -- regardless of
// which call *started* first or how slow its own aggregate was. This is
// true fencing of the write, not of a prior read.
//
// Returns `{ skipped: true, reason: 'superseded' }` when the atomic write
// was rejected because a newer generation already won (the document exists
// but its syncRevision already exceeds fenceRevision). Returns the
// pre-existing `null` when there is genuinely no BudgetModel document for
// this month at all (unchanged from before this fencing existed).
// Callers that omit fenceRevision (setBudgetForCurrentMonth, and any
// direct call that doesn't care about fencing) are completely unaffected --
// byte-for-byte the original unconditional-write behavior.
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
    // exists yet for this month (matches the pre-fencing `null` return), or
    // one exists but a newer generation already won the fence. Distinguish
    // purely for the caller's reporting; the atomicity guarantee above
    // holds identically either way -- this document was never partially or
    // incorrectly written.
    const existing = await BudgetModel.findOne({ userId, month }).select('_id').lean();
    if (existing) {
        return { skipped: true, reason: 'superseded' };
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