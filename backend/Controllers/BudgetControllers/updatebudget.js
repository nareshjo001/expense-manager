const { UserModel, BudgetModel } = require('../../config/Schemas');
const { refreshReport } = require('../../Services/reportService');

const updatebudget = async (req, res) => {
    try {
        // Check if the authenticated user exists in the database
        const user = await UserModel.findById(req.userId);
        if(!user) {
            return res.status(401).json({ message: 'User does not exist', success: false});
        }

        const { budget } = req.body;
        const currentMonthYear = new Date().toLocaleString("default", {
          month: "short",
          year: "numeric",
        });
        
        // Update the budget for the current month
        const updatedBudget = await BudgetModel.findOneAndUpdate(
          { userId: user._id, month: currentMonthYear },
          { budget: budget },
          { new: true, upsert: true, runValidators: true }
        );

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