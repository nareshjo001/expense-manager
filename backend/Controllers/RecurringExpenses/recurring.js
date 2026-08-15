const mongoose = require('mongoose');
const { RecurringExpenseModel } = require('../../models/RecurringExpense');
const { ExpenseModel } = require('../../config/Schemas');
const { normalizeCategory } = require('../../utils/categoryNormalization');
const { clearUserExpenseCache } = require('../../utils/expenseCache');

// PATCH /api/recurring is a desired-state operation, not a one-shot action:
// {isRecurring:true} means "ensure recurring is enabled", {isRecurring:false}
// means "ensure recurring is disabled". Repeating either request for an
// already-achieved state must succeed, not conflict -- see the crash-gap
// remediation this file implements below.
//
// RecurringExpenseModel document existence is the single authoritative fact.
// Expense.isRecurring is kept only as a best-effort compatibility mirror for
// any code/response still reading it directly; callers that need the
// authoritative value should use Services/RecurringServices/
// recurringStateService.js instead of trusting this field.
const recurring = async (req, res) => {

   const { expenseId, isRecurring } = req.body;

   // Validate request input.
   if (!expenseId || typeof isRecurring !== "boolean") {
      return res.status(400).json({ message: "Invalid request", success: false });
   }

   // Reject malformed expense IDs before any query -- matches
   // editExpense.js/geteditexpense.js's convention; a Mongoose CastError
   // must never reach the client as a raw 500.
   if (!mongoose.Types.ObjectId.isValid(expenseId)) {
      return res.status(400).json({ message: "Invalid expense ID", success: false });
   }

   try {

      // Find the expense belonging to the authenticated user. The query is
      // already user-scoped, so a foreign-owned expense simply doesn't
      // match -- there is no separate "wrong owner" case to distinguish
      // from "doesn't exist".
      const expense = await ExpenseModel.findOne({
         _id: expenseId,
         userId: req.userId
      });

      // Non-disclosing 404, matching the rest of the codebase's convention
      // (editExpense.js, deleteExpense.js, editIncome.js, deleteIncome.js) --
      // never reveals whether a foreign expense id exists.
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

         let definition;
         try {
            // Atomic upsert on the existing {userId, expenseId} unique
            // index. $setOnInsert means a replay against an
            // ALREADY-EXISTING definition never overwrites its fields
            // (e.g. a since-adjusted nextDueDate/lastLoggedDate survives a
            // later replay of the original mark request untouched).
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
               // definition now durably exists either way. Re-read the
               // winner and continue as a successful replay rather than
               // surfacing an error for a desired state that IS achieved.
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
         // above is already committed at this point -- if this write fails
         // or the process crashes here, the desired state remains correct
         // and a retry (which re-enters this same branch, finds the
         // definition already exists, and repeats this update) safely
         // repairs the mirror. Nothing here ever attempts to undo the
         // already-committed definition.
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
            // outcome, not an error -- the desired state ("no definition
            // exists") is already achieved either way.
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
