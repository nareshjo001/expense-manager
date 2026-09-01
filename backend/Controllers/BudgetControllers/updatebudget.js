const { UserModel, BudgetModel } = require('../../config/Schemas');
const syncRecoveryService = require('../../Services/syncRecoveryService');
const { clearUserExpenseCache } = require('../../utils/expenseCache');

// Budget Derived-Spent Authority remediation -- this route used to call
const updatebudget = async (req, res) => {
    try {
        // Check if the authenticated user exists in the database
        const user = await UserModel.findById(req.userId);
        if(!user) {
            return res.status(401).json({ message: 'User does not exist', success: false});
        }

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
        const currentMonthYear = now.toLocaleString("default", {
          month: "short",
          year: "numeric",
        });

        // Reserve BEFORE the primary write -- a crash before confirm() still
        // leaves durable Tier-2 evidence for repairIfPending() to find.
        const { budgetReservations } = await syncRecoveryService.reserve({
          userId: user._id,
          budgetDates: [now],
        });

        // Create or update the budget amount for the current month.
        await BudgetModel.findOneAndUpdate(
          { userId: user._id, month: currentMonthYear },
          { budget: budgetAmount },
          { new: true, upsert: true, runValidators: true }
        );

        // Cache clearing is a pure optimization -- matches the expense-mutation
        // controllers' convention.
        await clearUserExpenseCache(user._id);

        // Recompute spent (fenced) and refresh the report -- synchronizeAfterMutation
        // already calls refreshReport internally, so no separate call is made here.
        const derivedData = await syncRecoveryService.synchronizeAfterMutation({
          userId: user._id,
          budgetDates: [now],
          budgetTokens: budgetReservations.map((r) => r.token),
        });

        // Fetch the current document for the response -- synchronizeAfterMutation
        const updatedBudget = await BudgetModel.findOne({ userId: user._id, month: currentMonthYear }).lean();

        // Send successful response with budget data -- existing fields
        res.status(200).json({ message: 'Success', data: updatedBudget, success: true, derivedData });

      } catch(err) {
        // Catch unexpected server/database errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { updatebudget };