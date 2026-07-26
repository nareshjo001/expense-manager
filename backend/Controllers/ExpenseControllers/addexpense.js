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
    
    // Generate a description via ML when none was provided.
    if (!expenseDescription || expenseDescription.trim() === '') {
        try {
            const response = await axios.post(
              `${process.env.ML_ROUTE}/generate-description`,
              {
                  expenseName,
                  expenseCategory,
                  expenseAmount
              },
              { timeout: 5000 }
            );

            finalDescription = response.data.description;
        } catch (mlErr) {
            console.error('ML description generation failed, falling back to "Others":', mlErr.message);
            finalDescription = "";
        }
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

    // Recalculate the budget and clear cached expense reads.
    await Promise.all([
      recalculateBudget(user._id, newExpense.expenseDate),
      clearUserExpenseCache(user._id)
    ]);

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