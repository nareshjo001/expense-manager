const mongoose = require('mongoose');
const { RecurringExpenseModel } = require('../../models/RecurringExpense');
const { ExpenseModel } = require('../../config/Schemas');
const { normalizeCategory } = require('../../utils/categoryNormalization');
const { clearUserExpenseCache } = require('../../utils/expenseCache');

// PATCH /api/recurring is a desired-state operation, not a one-shot action:
const recurring = async (req, res) => {

   const { expenseId, isRecurring } = req.body;

   // Validate request input.
   if (!expenseId || typeof isRecurring !== "boolean") {
      return res.status(400).json({ message: "Invalid request", success: false });
   }

   // Reject malformed expense IDs before any query -- matches
   if (!mongoose.Types.ObjectId.isValid(expenseId)) {
      return res.status(400).json({ message: "Invalid expense ID", success: false });
   }

   try {

      // Find the expense belonging to the authenticated user. The query is
      const expense = await ExpenseModel.findOne({
         _id: expenseId,
         userId: req.userId
      });

      // Non-disclosing 404, matching the rest of the codebase's convention
      if (!expense) {
         return res.status(404).json({ message: "Expense not found", success: false });
      }

      if (isRecurring) {

         const now = new Date();
         const nextDueDate = new Date(Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth() + 1,
            1,
            0, 0, 0
         ));

         // Category Normalization -- `expense.expenseCategory` is copied
         const recurringCategory = normalizeCategory(expense.expenseCategory) || expense.expenseCategory;

         let definition;
         try {
            // Atomic upsert on the existing {userId, expenseId} unique
            definition = await RecurringExpenseModel.findOneAndUpdate(
               { userId: req.userId, expenseId },
               {
                  $setOnInsert: {
                     userId: req.userId,
                     expenseId,
                     expenseName: expense.expenseName,
                     expenseCategory: recurringCategory,
                     expenseAmount: expense.expenseAmount,
                     lastLoggedDate: new Date(expense.expenseDate),
                     nextDueDate
                  }
               },
               { upsert: true, new: true, setDefaultsOnInsert: true }
            );
         } catch (upsertErr) {
            if (upsertErr.code === 11000) {
               // Two concurrent upserts raced at the database level -- the
               definition = await RecurringExpenseModel.findOne({ userId: req.userId, expenseId });
            } else {
               console.error(upsertErr);
               return res.status(500).json({ message: "Internal Server Error", success: false });
            }
         }

         if (!definition) {
            // Should be unreachable after the upsert/re-read above; fail
            // safely rather than silently proceed with no definition.
            console.error("recurring: definition missing after upsert/replay for", expenseId);
            return res.status(500).json({ message: "Internal Server Error", success: false });
         }

         // Repair the compatibility mirror. The authoritative definition
         try {
            await ExpenseModel.updateOne(
               { _id: expenseId, userId: req.userId },
               { $set: { isRecurring: true } }
            );
         } catch (mirrorErr) {
            console.error(mirrorErr);
            return res.status(500).json({ message: "Internal Server Error", success: false });
         }

         // Pure optimization -- self-catches every Redis error internally.
         await clearUserExpenseCache(req.userId);

         // Stable response regardless of whether the definition was newly
         // created or already existed.
         return res.status(200).json({ message: "Recurring enabled", success: true, isRecurring: true });

      } else {

         try {
            // A null result (already absent) is a successful, idempotent
            await RecurringExpenseModel.findOneAndDelete({
               userId: req.userId,
               expenseId
            });
         } catch (deleteErr) {
            console.error(deleteErr);
            return res.status(500).json({ message: "Internal Server Error", success: false });
         }

         try {
            await ExpenseModel.updateOne(
               { _id: expenseId, userId: req.userId },
               { $set: { isRecurring: false } }
            );
         } catch (mirrorErr) {
            console.error(mirrorErr);
            return res.status(500).json({ message: "Internal Server Error", success: false });
         }

         await clearUserExpenseCache(req.userId);

         return res.status(200).json({ message: "Recurring disabled", success: true, isRecurring: false });
      }

   } catch (err) {
      // Generic server error response -- no raw Mongo/CastError detail
      // ever reaches the client.
      console.error(err);
      return res.status(500).json({ message: "Internal Server Error", success: false });
   }
};

module.exports = { recurring };
