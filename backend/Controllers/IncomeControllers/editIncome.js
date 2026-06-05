const { UserModel, IncomeModel } = require('../../config/Schemas');

const editIncome = async (req, res) => {
  try {
    // Destructure updated data from request body
    const { incomeId, newAmount } = req.body;

    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    // Find the income document to edit
    const income = await IncomeModel.findById(incomeId);
    if (!income) {
      return res.status(404).json({ message: 'Income not found', success: false });
    }

    // Update the income amount
    income.incomeAmount = newAmount;

    // Save the updated income document
    await income.save();

    // Send success response
    res.status(200).json({ message: 'Income updated successfully', success: true });

  } catch (err) {
    // Send generic server error response
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { editIncome };