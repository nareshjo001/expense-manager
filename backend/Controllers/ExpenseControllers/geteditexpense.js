const mongoose = require('mongoose');
const { UserModel, ExpenseModel } = require('../../config/Schemas');

const geteditexpense = async (req, res) => {
    try {
            // Verify user from JWT (set by authentication middleware)
            const user = await UserModel.findById(req.userId);
            if(!user) {
                return res.status(401).json({ message: 'User does not exist', success: false});
            }

            // Get expense ID from query parameters
            const expenseId = req.query.expenseId;

            // Reject malformed expense IDs.
            if (!mongoose.Types.ObjectId.isValid(expenseId)) {
                return res.status(400).json({ message: 'Invalid expense ID', success: false });
            }

            // Find the expense that belongs to this user
            const expense = await ExpenseModel.findOne({
                userId: user._id,
                _id: expenseId
            })

            // If no expense is found, return 404
            if (!expense) {
                return res.status(404).json({ message: 'Expense not found', success: false });
            }

            // Return the expense data
            res.status(200).json({
                message: 'Expense Retrieved Successfully',
                data: expense,
                success: true
            });

    } catch(err) {
        // Generic server error response
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { geteditexpense };