const crypto = require('crypto');
const cron = require('node-cron');

const { RecurringExpenseModel } = require('../models/RecurringExpense');
const { ExpenseModel } = require('../config/Schemas');
const Notification = require("../models/Notification");

const { sendPush } = require('../Services/push.service');
const { clearUserExpenseCache } = require('../utils/expenseCache');
const { normalizeCategory, UNCATEGORIZED } = require('../utils/categoryNormalization');
// Remediation follow-up -- durable report/cache synchronization across a
const { reserve, synchronizeAfterMutation } = require('../Services/syncRecoveryService');
// REC-001 -- job-level lease so only one server instance runs this body at
// a time; the expense insert's own occurrence-ID uniqueness constraint
// remains the actual financial-correctness backstop either way.
const { runWithLease } = require('../utils/jobLease');

const JOB_NAME = "recurringJob";
const LEASE_TTL_MS = 10 * 60 * 1000;

cron.schedule("30 20 * * *", async () => {
   await runWithLease(JOB_NAME, LEASE_TTL_MS, runRecurringJob);
});

async function runRecurringJob() {

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

         // Remediation Workstream D -- deterministic occurrence identity,
         const occurrenceId = crypto
            .createHash("sha256")
            .update(`${recurring._id}:${originalNextDue.toISOString()}`)
            .digest("hex");

         // Category Normalization -- this path constructs a brand-new
         const normalizedRecurringCategory = normalizeCategory(recurring.expenseCategory) || UNCATEGORIZED;

         // Crash-gap closure, part 2 (report/cache synchronization) -- the
         const occurrenceExpenseDate = new Date();

         // Durable, pre-write evidence (Tier-2 reservation on PendingSync,
         const reserved = await reserve({
            userId: recurring.userId,
            budgetDates: [occurrenceExpenseDate],
            reserveReport: true,
         });

         // Remediation Workstream D -- insert BEFORE advancing nextDueDate.
         let expense = null;
         let wasNewInsert = false;
         try {
            expense = await ExpenseModel.create({
               userId: recurring.userId,
               id: occurrenceId,
               expenseName: recurring.expenseName,
               expenseCategory: normalizedRecurringCategory,
               expenseAmount: recurring.expenseAmount,
               expenseDate: occurrenceExpenseDate,
               expenseDescription: "Auto logged recurring expense",
               isRecurring: true
            });
            wasNewInsert = true;
         } catch (createErr) {
            if (createErr && createErr.code === 11000) {
               // This exact occurrence was already inserted (by this
               expense = await ExpenseModel.findOne({ userId: recurring.userId, id: occurrenceId }).lean();
               wasNewInsert = false;
            } else {
               // A genuine, non-dedupe insert failure is AMBIGUOUS -- it
               console.error("Recurring cron: expense insert failed.");
               continue;
            }
         }

         // Claim/advance the schedule only now that the occurrence is
         await RecurringExpenseModel.findOneAndUpdate(
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

         if (!wasNewInsert) {
            // Confirmed duplicate/replay -- schedule reconciled above if it
            const derivedData = await synchronizeAfterMutation({
               userId: recurring.userId,
               budgetDates: [occurrenceExpenseDate],
               budgetTokens: reserved.budgetReservations.map((r) => r.token),
               reportToken: reserved.reportReservation && reserved.reportReservation.token,
            }).catch(() => {
               console.error("Recurring cron: replay reconciliation failed.");
               return null;
            });
            if (derivedData && derivedData.recoveryPending) {
               console.error("Recurring cron: report/budget synchronization remains pending after replay.");
            }
            continue;
         }

         // Cache clearing is a pure optimization (utils/expenseCache.js's own
         await clearUserExpenseCache(recurring.userId);

         // Recalculate the budget and refresh the report using the SAME
         const derivedData = await synchronizeAfterMutation({
            userId: recurring.userId,
            budgetDates: [expense.expenseDate],
            budgetTokens: reserved.budgetReservations.map((r) => r.token),
            reportToken: reserved.reportReservation && reserved.reportReservation.token,
         });
         if (derivedData.recoveryPending) {
            // Not a failure of THIS request -- the expense is already
            console.error("Recurring cron: report/budget synchronization remains pending.");
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

         console.log("Processed recurring expense.");
      }
   } catch {
      // Handle any unexpected errors
      console.error("Recurring cron failed.");
   }

}
