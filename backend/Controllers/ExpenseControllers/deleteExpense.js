const { UserModel, ExpenseModel } = require('../../config/Schemas');
const { recalculateBudget } = require('../../Services/BudgetServices/budget.service');
const { clearUserExpenseCache } = require('../../utils/expenseCache');

const deleteExpense = async (req, res) => {
    try {
            // Verify user from JWT (set by auth middleware)
            const user = await UserModel.findById(req.userId);
            if(!user) {
                return res.status(401).json({ message: 'User does not exist', success: false});
            }

            // Find and delete expense that belongs to this user
            const deletedExpense = await ExpenseModel.findOneAndDelete({
                _id: req.body.id,
                userId: req.userId
            });

            // If expense was found and deleted
            if (deletedExpense) {

                // Recalculate budget for the month of the deleted expense
                await recalculateBudget(user._id, deletedExpense.expenseDate);

                // CLEAR CACHE
                clearUserExpenseCache(user._id);
                
                return res.status(200).json({ 
                    message: "Expense deleted successfully",
                    success: true
                });

            } else {
                // Expense not found
                return res.status(404).json({ 
                    message: "Expense not found",
                    success: false
                });
            }
            
        } catch(err) {
            // Generic server error response
            console.error(err);
            res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { deleteExpense };