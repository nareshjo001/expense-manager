const { UserModel, IncomeModel } = require('../../config/Schemas');

const getIncome = async (req, res) => {
  try {
    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    // Fetch income records linked to the authenticated user
    const incomeRecords = await IncomeModel.find({ userId: user._id }).sort({ incomeDate: -1 }); // Sort by date descending

    // Send success response with income records
    res.status(200).json({ message: 'Income records retrieved successfully', success: true, data: incomeRecords });
  } catch (err) {
    // Send generic server error response
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { getIncome };