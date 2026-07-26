const mongoose = require('mongoose');
const { UserModel, ExpenseModel } = require('../../config/Schemas');
const { recalculateBudget } = require('../../Services/BudgetServices/budget.service');
const { clearUserExpenseCache } = require('../../utils/expenseCache');

const { refreshReport } = require('../../Services/reportService');

const editexpense = async (req, res) => {
  try {
        // Check if user exists in database using authenticated userId
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Get expense ID from query params
        const expenseId = req.query.editID;

        // Reject malformed IDs before hitting the database — otherwise
        // Mongoose throws a CastError that the generic catch below would
        // turn into a misleading 500 for what is really a client error.
        if (!mongoose.Types.ObjectId.isValid(expenseId)) {
            return res.status(400).json({ message: 'Invalid expense ID', success: false });
        }

        // Find the original expense that belongs to this user
        const originalExpense = await ExpenseModel.findOne({
            _id: expenseId,
            userId: req.userId
        });

        // If expense is not found, return 404
        if (!originalExpense) {
            return res.status(404).json({ message: 'Expense not found', success: false });
        }

        // Extract updated fields from request body.
        // Whitelisted to user-authored content fields only — userId, _id, id,
        // ML metadata (mlPredictedCategory/mlConfidence/wasMlCorrected), and
        // isRecurring (set only by the recurring-expense cron job) are
        // server-managed and must never be writable from a client request body.
        const EDITABLE_FIELDS = [
            'expenseName',
            'expenseCategory',
            'expenseAmount',
            'expenseDate',
            'expenseDescription'
        ];

        const updates = {};
        for (const field of EDITABLE_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                updates[field] = req.body[field];
            }
        }

        // Update expense in database and return updated document
        const updatedExpense = await ExpenseModel.findOneAndUpdate(
            { _id: expenseId, userId: req.userId },
            { $set: updates },
            { new: true }
        );

        // If the expense was deleted by another request between the findOne
        // check above and this update, treat it the same as "not found".
        if (!updatedExpense) {
            return res.status(404).json({ message: 'Expense not found', success: false });
        }

        // Budget totals are derived only from expenseAmount and expenseDate,
        // so recalculation is only needed when one of those fields changed.
        const amountOrDateChanged =
            Object.prototype.hasOwnProperty.call(updates, 'expenseAmount') ||
            Object.prototype.hasOwnProperty.call(updates, 'expenseDate');

        if (amountOrDateChanged) {
            // Recalculate budget for OLD month
            // This is needed because original expense amount/date might have changed
            await recalculateBudget(user._id, originalExpense.expenseDate);

            // If expense moved to a different month/year,
            // we must recalculate budget for the NEW month as well
            const oldDate = new Date(originalExpense.expenseDate);
            const newDate = new Date(updatedExpense.expenseDate);

            if (
                oldDate.getMonth() !== newDate.getMonth() ||
                oldDate.getFullYear() !== newDate.getFullYear()
            ) {
                await recalculateBudget(user._id, updatedExpense.expenseDate);
            }
        }

        // CLEAR CACHE
        await clearUserExpenseCache(user._id);

        // Update report
        await refreshReport(user._id);

        // Send response
        res.status(200).json({
            message: 'Expense updated successfully!',
            data: updatedExpense,
            success: true
        });

  } catch (err) {
        // Catch unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { editexpense };