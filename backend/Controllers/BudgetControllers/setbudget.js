const { UserModel, BudgetModel } = require('../../config/Schemas');
const { getMonthRange } = require('../../Services/HelperServices/datecal.service');
const syncRecoveryService = require('../../Services/syncRecoveryService');
const { clearUserExpenseCache } = require('../../utils/expenseCache');

// Budget Derived-Spent Authority remediation -- this route used to call
const setbudget = async (req, res) => {
  try {
    // Validate user
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    // Extract budget value from request body
    const { budget } = req.body;

    // Validate budget input: must be present and of a numeric-compatible type
    if (
      budget === undefined ||
      budget === null ||
      budget === '' ||
      (typeof budget !== 'number' && typeof budget !== 'string')
    ) {
      return res.status(400).json({ message: 'Budget amount is required', success: false });
    }

    const budgetAmount = Number(budget);

    // Reject non-numeric strings, NaN, Infinity, and negative values
    if (!Number.isFinite(budgetAmount) || budgetAmount < 0) {
      return res.status(400).json({ message: 'Budget amount must be a valid, non-negative number', success: false });
    }

    const now = new Date();
    const { monthStart } = getMonthRange(now);
    const month = monthStart.toLocaleString('default', { month: 'short', year: 'numeric' });

    // Reserve BEFORE the primary write -- a crash before confirm() still
    // leaves durable Tier-2 evidence for repairIfPending() to find.
    const { budgetReservations } = await syncRecoveryService.reserve({
      userId: user._id,
      budgetDates: [now],
    });

    // Set or update the budget cap for the current month (upsert).
    await BudgetModel.findOneAndUpdate(
      { userId: user._id, month },
      { $set: { budget: budgetAmount } },
      { upsert: true, runValidators: true }
    );

    // Cache clearing is a pure optimization (utils/expenseCache.js's own
    await clearUserExpenseCache(user._id);

    // Recompute spent (fenced) and refresh the report -- synchronizeAfterMutation
    // already calls refreshReport internally, so no separate call is made here.
    const derivedData = await syncRecoveryService.synchronizeAfterMutation({
      userId: user._id,
      budgetDates: [now],
      budgetTokens: budgetReservations.map((r) => r.token),
    });

    // Send success response -- existing fields (`message`, `success`)
    // unchanged; `derivedData` is new and purely additive.
    res.status(200).json({ message: 'Budget set successfully', success: true, derivedData });

  } catch (err) {
    // Catch unexpected server or database errors
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { setbudget };