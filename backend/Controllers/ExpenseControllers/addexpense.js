const { UserModel, ExpenseModel, MlFeedbackModel } = require('../../config/Schemas');
const { recalculateBudget } = require('../../Services/BudgetServices/budget.service');
const { clearUserExpenseCache } = require('../../utils/expenseCache');
const axios = require("axios");

const { refreshReport } = require('../../Services/reportService');

// Lowercases + trims for comparison only; never throws on missing/non-string input.
const normalizeForComparison = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
};

// Server-derived source of truth for whether a genuine ML correction occurred.
// The client-supplied `wasMlCorrected` flag is no longer trusted directly —
// it is recomputed here from the actual predicted vs. saved category.
// Returns { hasPrediction, corrected }:
//   hasPrediction=false  -> no valid ML prediction was involved at all
//   hasPrediction=true, corrected=false -> prediction accepted as-is
//   hasPrediction=true, corrected=true  -> user's saved category differs from the prediction
const deriveMlCorrection = (mlPredictedCategory, expenseCategory) => {
  const predicted = normalizeForComparison(mlPredictedCategory);

  if (!predicted) {
    return { hasPrediction: false, corrected: false };
  }

  const actual = normalizeForComparison(expenseCategory);
  return { hasPrediction: true, corrected: predicted !== actual };
};

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

    // Create new ML feedback document if a genuine ML prediction is available.
    // `corrected` and `status` are derived server-side from the actual
    // predicted vs. saved category — the client-supplied `wasMlCorrected`
    // flag is not trusted for this decision (see deriveMlCorrection above).
    const { hasPrediction, corrected: mlCorrected } = deriveMlCorrection(
      mlPredictedCategory,
      expenseCategory
    );

    if (hasPrediction && mlConfidence !== undefined) {
        const mlFeedback = new MlFeedbackModel({
            expenseName,
            predictedCategory: mlPredictedCategory,
            actualCategory: expenseCategory,
            confidence: mlConfidence,
            // Backward compatibility: the current cron and export_feedback.py
            // still read this boolean directly (Phase A keeps it in sync with
            // `status` rather than migrating those readers yet).
            corrected: mlCorrected,
            // "pending" only for a genuine, server-confirmed correction.
            // Accepted predictions are left as status: null — never assigned
            // "trained" at creation time; that only happens once a real
            // training run has consumed this document (later phases).
            status: mlCorrected ? 'pending' : null,
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