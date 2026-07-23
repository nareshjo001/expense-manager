const { UserModel, ExpenseModel, MlFeedbackModel } = require('../../config/Schemas');
const { recalculateBudget } = require('../../Services/BudgetServices/budget.service');
const { clearUserExpenseCache } = require('../../utils/expenseCache');
const axios = require("axios");

const { refreshReport } = require('../../Services/reportService');

const addExpense = async (req, res) => {
  try {
    // Destructure expense data from request body
    const { id, expenseName, expenseCategory, expenseAmount, expenseDate, expenseDescription, mlPredictedCategory, mlConfidence, wasMlCorrected } = req.body;

    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    let finalDescription = expenseDescription;
    
    // If no description provided, generate one using ML model
    if (!expenseDescription || expenseDescription.trim() === '') {
        const response = await axios.post(
          `${process.env.ML_ROUTE}/generate-description`,
          {
              expenseName,
              expenseCategory,
              expenseAmount
          }
        );

        finalDescription = response.data.description;
    }

    // Create new expense document linked to the authenticated user
    const newExpense = new ExpenseModel({
        userId: user._id,
        id,
        expenseName,
        expenseCategory,
        expenseAmount,
        expenseDate,
        expenseDescription: finalDescription,
        mlPredictedCategory,
        mlConfidence,
        wasMlCorrected
    });

    // Create new ML feedback document if ML predictions are available
    if (mlPredictedCategory && mlConfidence !== undefined) {
        const mlFeedback = new MlFeedbackModel({
            expenseName,
            predictedCategory: mlPredictedCategory,
            actualCategory: expenseCategory,
            confidence: mlConfidence,
            corrected: wasMlCorrected,
            userId: user._id
        });
        await mlFeedback.save();
    }

    // Save expense to database
    await newExpense.save();

    // Recalculate the user's budget for the month of this expense
    // This ensures total spent amount stays updated
    await recalculateBudget(user._id, newExpense.expenseDate);
    
    // CLEAR CACHE
    clearUserExpenseCache(user._id);

    // Update report
    await refreshReport(user._id);
    
    // Send success response
    res.status(201).json({ message: 'Expense Created Successfully', success: true });
  
  } catch (err) {
    // Send generic server error response
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { addExpense };