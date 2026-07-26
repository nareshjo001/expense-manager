const { UserModel, BudgetModel } = require('../../config/Schemas');

const getbudgets = async (req, res) => {
    try {
        // Check if the authenticated user exists in the database
        const user = await UserModel.findById(req.userId);
        if(!user) {
            return res.status(401).json({ message: 'User does not exist', success: false});
        }

        // Fetch all budgets belonging to this user sorted by ascending
        const budgets = await BudgetModel.find({ userId: user._id }).sort({ month: 1 });

        // Send successful response with budget data
        res.status(200).json({ message: 'Success', data: budgets, success: true });
    
      } catch(err) {
        // Catch unexpected server/database errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { getbudgets };