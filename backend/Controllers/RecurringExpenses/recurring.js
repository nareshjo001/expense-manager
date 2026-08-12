const { RecurringExpenseModel } = require('../../models/RecurringExpense');
const { ExpenseModel } = require('../../config/Schemas');
const { normalizeCategory } = require('../../utils/categoryNormalization');

const recurring = async (req, res) => {

   // Extract expense ID and recurring flag from request body
   const { expenseId, isRecurring } = req.body;

   // Validate request input
   if (!expenseId || typeof isRecurring !== "boolean") {
      return res.status(400).json({ message: "Invalid request", success: false });
   }
   
   try {

      // Find the expense belonging to the authenticated user
      const expense = await ExpenseModel.findOne({
         _id: expenseId,
         userId: req.userId
      });

      // Ensure expense exists and belongs to the user
      if (!expense || expense.userId.toString() !== req.userId.toString()) {
         return res.status(403).json({ message: "Unauthorized", success: false });
      }

      // If marking as recurring
      if(isRecurring) {
         const now = new Date();
         const nextDueDate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() + 1,
            1,
            0, 0, 0
         ));

         // Category Normalization -- `expense.expenseCategory` is copied
         // from an already-persisted Expense document. On a fresh write
         // (post-normalization) it is already canonical; this normalizes
         // it again defensively so a pre-existing LEGACY expense (written
         // before this change, potentially inconsistent casing/whitespace)
         // still produces a canonical RecurringExpense definition. Falls
         // back to the raw stored value only in the practically
         // unreachable case where it fails to normalize at all (the source
         // field is itself `required: true`, so this is not expected to
         // ever actually happen) -- never blocks marking an expense
         // recurring over a data-quality issue in an unrelated field.
         const recurringCategory = normalizeCategory(expense.expenseCategory) || expense.expenseCategory;

         // Create a recurring expense entry
         await RecurringExpenseModel.create({
            userId: req.userId,
            expenseId,
            expenseName: expense.expenseName,
            expenseCategory: recurringCategory,
            expenseAmount: expense.expenseAmount,
            lastLoggedDate: new Date(expense.expenseDate),
            nextDueDate
         });

         // Update main expense as recurring
         expense.isRecurring = true;
         await expense.save();

         // Send success response
         return res.status(201).json({ message: "Marked recurring successfully", success: true });
      
      } else {

         // Remove recurring record for this expense
         await RecurringExpenseModel.findOneAndDelete({
            userId: req.userId,
            expenseId
         });

         // Update main expense as non-recurring
         expense.isRecurring = false;
         await expense.save();

         // Send success response
         return res.status(200).json({ message: "Unmarked recurring successfully", success: true });
      }

   } catch (err) {

      // Handle duplicate recurring entry error
      if (err.code === 11000) {
         return res.status(400).json({ message: "Already marked as recurring", success: false });
      }

      // Handle server errors
      console.error(err);
      return res.status(500).json({ message: "Internal Server Error", success: false });
   }
};

module.exports = { recurring };