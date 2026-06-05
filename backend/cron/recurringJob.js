const crypto = require('crypto');
const cron = require('node-cron');

const { RecurringExpenseModel } = require('../models/RecurringExpense');
const { ExpenseModel } = require('../config/Schemas');
const Notification = require("../models/Notification");

const { sendPush } = require('../Services/push.service');

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

         // Store original next due date
         const originalNextDue = recurring.nextDueDate;

         // Calculate next month’s due date (1st of next month in UTC)
         const newNextDue = new Date(Date.UTC(
            originalNextDue.getUTCFullYear(),
            originalNextDue.getUTCMonth() + 1,
            1,
            0, 0, 0
         ));

         // Atomic update to prevent duplicates
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

         // Create expense AFTER safe update
         const expense = await ExpenseModel.create({
            userId: recurring.userId,
            id: crypto.randomUUID(),
            expenseName: recurring.expenseName,
            expenseCategory: recurring.expenseCategory,
            expenseAmount: recurring.expenseAmount,
            expenseDate: new Date(),
            expenseDescription: "Auto logged recurring expense",
            isRecurring: true
         });

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