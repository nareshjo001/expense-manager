const crypto = require('crypto');
const cron = require('node-cron');

const { RecurringExpenseModel } = require('../models/RecurringExpense');
const { ExpenseModel } = require('../config/Schemas');
const Notification = require("../models/Notification");

const { sendPush } = require('../Services/push.service');
const { recalculateBudget } = require('../Services/BudgetServices/budget.service');
const { clearUserExpenseCache } = require('../utils/expenseCache');
const { refreshReport } = require('../Services/reportService');
const { normalizeCategory, UNCATEGORIZED } = require('../utils/categoryNormalization');

cron.schedule("30 20 * * *", async () => {

   try {

      console.log("Recurring cron running at:", new Date());

      // Get current time
      const now = new Date();

      // Find all recurring expenses whose due date has passed
      const dueExpenses = await RecurringExpenseModel.find({
         nextDueDate: { $lte: now }
      }).lean();

      // If no due expenses, exit early
      if (!dueExpenses.length) return;

      // Process each due recurring expense
      for (const recurring of dueExpenses) {

         const originalNextDue = recurring.nextDueDate;

         // Advance the due date to the first of next month.
         const newNextDue = new Date(Date.UTC(
            originalNextDue.getUTCFullYear(),
            originalNextDue.getUTCMonth() + 1,
            1,
            0, 0, 0
         ));

         // Claim this recurrence atomically to prevent duplicates.
         const updated = await RecurringExpenseModel.findOneAndUpdate(
            {
               _id: recurring._id,
               nextDueDate: originalNextDue
            },
            {
               $set: {
                  lastLoggedDate: new Date(),
                  nextDueDate: newNextDue
               }
            }
         );

         if (!updated) continue; // already processed

         // Category Normalization -- this path constructs a brand-new
         // ExpenseModel document directly, entirely bypassing
         // Controllers/ExpenseControllers/addexpense.js and its
         // normalization above. Normalized here defensively/independently
         // so an auto-logged recurring expense is canonical even if the
         // RecurringExpense definition itself predates this change or was
         // otherwise never normalized. Falls back to the explicit
         // "Uncategorized" marker (never silently to "Others", a real,
         // distinct, user-choosable category) in the practically
         // unreachable case where the stored value fails to normalize at
         // all -- this auto-logger must never throw and skip logging a due
         // recurring expense over a category data-quality issue.
         const normalizedRecurringCategory = normalizeCategory(recurring.expenseCategory) || UNCATEGORIZED;

         // Log the recurring expense.
         const expense = await ExpenseModel.create({
            userId: recurring.userId,
            id: crypto.randomUUID(),
            expenseName: recurring.expenseName,
            expenseCategory: normalizedRecurringCategory,
            expenseAmount: recurring.expenseAmount,
            expenseDate: new Date(),
            expenseDescription: "Auto logged recurring expense",
            isRecurring: true
         });

         // Refresh budget, cache and report for the new expense.
         try {
            await Promise.all([
               recalculateBudget(recurring.userId, expense.expenseDate),
               clearUserExpenseCache(recurring.userId)
            ]);
            await refreshReport(recurring.userId);
         } catch (propagationErr) {
            console.error(
               `Recurring cron: post-create propagation failed for user ${recurring.userId}:`,
               propagationErr
            );
         }

         // Create notification (DB FIRST)
         const notification = await Notification.create({
            userId: recurring.userId,
            title: "Recurring Expense Added 💸",
            message: `${recurring.expenseName} has been logged ✅`,
            type: "recurring-expense",
            relatedId: expense._id
         });

         // Attempt to send push notification
         const pushResult = await sendPush(
            recurring.userId.toString(),
            notification.title,
            notification.message
         );

         // If push successful, mark notification as sent
         if (pushResult.success) {
            await Notification.updateOne(
               { _id: notification._id },
               {
                  pushStatus: "sent"
               }
            );
         
         } else {
            // If push failed, mark as failed and schedule retry
            await Notification.updateOne(
               { _id: notification._id },
               {
                  pushStatus: "failed",
                  retryCount: 1,
                  nextRetryAt: new Date(Date.now() + 5 * 60 * 1000) // retry in 5 mins
               }
            );
         }

         console.log("Processed recurring:", recurring.expenseName);
      }
   } catch (err) {
      // Handle any unexpected errors
      console.error("Recurring cron failed:", err);
   }

});