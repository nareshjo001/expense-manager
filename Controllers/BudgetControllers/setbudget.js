const { UserModel } = require('../../config/Schemas');
const { setBudgetForCurrentMonth } = require('../../Services/BudgetServices/budget.service');

const setbudget = async (req, res) => {
  try {
    // Validate user
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    // Extract budget value from request body
    const { budget } = req.body;

    // Validate budget input
    if (budget == null) {
      return res.status(400).json({ message: 'Budget amount is required', success: false });
    }

    // Set or update budget for the current month
    setBudgetForCurrentMonth(user._id, budget);

    // Send success response
    res.status(200).json({ message: 'Budget set successfully', success: true });

  } catch (err) {
    // Catch unexpected server or database errors
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { setbudget };