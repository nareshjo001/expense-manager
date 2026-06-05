const { UserModel, IncomeModel } = require('../../config/Schemas');

const addIncome = async (req, res) => {
  try {
    // Destructure income data from request body
    const { incomeSource, incomeAmount, incomeDate } = req.body;

    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    // Create new income document linked to the authenticated user
    const newIncome = new IncomeModel({
        userId: user._id,
        incomeSource, 
        incomeAmount, 
        incomeDate
    });

    // Save income to database
    await newIncome.save();
    
    // Send success response
    res.status(201).json({ message: 'Income Created Successfully', success: true });
  
  } catch (err) {
    // Send generic server error response
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = {  addIncome };