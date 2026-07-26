const { UserModel, BudgetModel } = require('../../config/Schemas');
const { recalculateBudget } = require('../../Services/BudgetServices/budget.service');
const { refreshReport } = require('../../Services/reportService');

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

        // Create/update the budget amount for the current month
        await BudgetModel.findOneAndUpdate(
          { userId: user._id, month: currentMonthYear },
          { budget: budgetAmount },
          { new: true, upsert: true, runValidators: true }
        );

        // Recalculate spent from live expense data. This guarantees a budget
        // document created here (via upsert) always ends up with a valid
        // `spent` field, matching the same guarantee setbudget.js already
        // provides through setBudgetForCurrentMonth.
        const updatedBudget = await recalculateBudget(user._id, now);

        await refreshReport(req.userId);

        // Send successful response with budget data
        res.status(200).json({ message: 'Success', data: updatedBudget, success: true });
    
      } catch(err) {
        // Catch unexpected server/database errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { updatebudget };