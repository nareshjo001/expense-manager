const crypto = require('crypto');
const cron = require('node-cron');

const { RecurringExpenseModel } = require('../models/RecurringExpense');
const { ExpenseModel, UserModel } = require('../config/Schemas');
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
   // REC-001-T03 -- the only job that opts into failing open when Redis is
   // unreachable. That is safe HERE and nowhere else: every occurrence this
   // job creates carries a unique occurrence ID with a uniqueness constraint
   // behind it, so a duplicate concurrent run loses the race on insert
   // rather than producing a duplicate expense. The lease is an efficiency
   // measure for this job, not its correctness guarantee.
   await runWithLease(JOB_NAME, LEASE_TTL_MS, runRecurringJob, { failOpen: true });
});

async function runRecurringJob() {

   try {

      console.log("Recurring cron running at:", new Date());

      // Get current time
      const now = new Date();

      // PRV-001-T05 (ADR-0007 Tier A) -- "stop jobs first": a user with a
      // pending account deletion must not have new recurring expenses
      // logged for them, even during the 14-day grace period -- Tier A is
      // meant to freeze the account's forward-going state immediately, not
      // just its historical data at purge time. Queried fresh every cycle
      // (not cached) so a pending set that changes between runs -- a fresh
      // deletion request, or a cancellation -- is always current, which is
      // simpler and safer than keeping a second signal in sync.
      const pendingDeletionUsers = await UserModel.find({ deletionRequestedAt: { $ne: null } })
         .select('_id')
         .lean();
      const pendingDeletionUserIds = new Set(pendingDeletionUsers.map((u) => String(u._id)));

      // Find all recurring expenses whose due date has passed. REC-002-T03 --
      // 'paused'/'ended' definitions are excluded up front: a paused
      // definition must not advance or log anything while paused, and an
      // ended one is terminal, so neither belongs in this query at all
      // (as opposed to being fetched and then skipped per-item).
      const dueExpensesRaw = await RecurringExpenseModel.find({
         nextDueDate: { $lte: now },
         status: 'active'
      }).lean();
      const dueExpenses = dueExpensesRaw.filter((r) => !pendingDeletionUserIds.has(String(r.userId)));

      // If no due expenses, exit early
      if (!dueExpenses.length) return;

      // Process each due recurring expense
      for (const recurring of dueExpenses) {

         const originalNextDue = recurring.nextDueDate;

         // REC-002-T03/T06 -- an optional endDate means this occurrence must
         // not be created: the schedule has reached its planned end.
         // Auto-transition to 'ended' instead (mirrors user-initiated end,
         // see recurringLifecycleService.endDefinition) and notify the user,
         // then move on without logging anything for this cycle.
         // scheduleVersion is deliberately NOT incremented here -- same
         // philosophy as this job's routine nextDueDate/lastLoggedDate
         // advancement (see RecurringExpense.js's own comment on that
         // field): every lifecycle mutation already re-checks `status`
         // before trusting scheduleVersion, so a stale client is still
         // caught correctly without this job participating in the CAS
         // protocol.
         if (recurring.endDate && originalNextDue > recurring.endDate) {
            const endedResult = await RecurringExpenseModel.findOneAndUpdate(
               { _id: recurring._id, status: 'active' },
               { $set: { status: 'ended', endedAt: new Date() } }
            );

            if (endedResult) {
               const endedNotification = await Notification.create({
                  userId: recurring.userId,
                  title: "Recurring Expense Ended",
                  message: `${recurring.expenseName} has reached its end date and will no longer be logged.`,
                  type: "recurring-expense-ended"
               });

               const endedPushResult = await sendPush(
                  recurring.userId.toString(),
                  endedNotification.title,
                  endedNotification.message,
                  { type: endedNotification.type }
               );

               // NOT-003-T03/T04 -- a preference-disabled type or an active
               // quiet-hours window comes back `suppressed`, never `failed`.
               // Recording it as "failed" would queue it into
               // retryPush.js's retry loop, which would just re-suppress it
               // (or, worse, could burn through the retry-count ceiling
               // entirely during a long quiet-hours window before it ever
               // ends -- see push.service.js's own note on this). Suppressed
               // is a terminal, non-retried state: the user asked for this.
               await Notification.updateOne(
                  { _id: endedNotification._id },
                  endedPushResult.success
                     ? { pushStatus: "sent" }
                     : endedPushResult.suppressed
                     ? { pushStatus: "suppressed" }
                     : {
                          pushStatus: "failed",
                          retryCount: 1,
                          nextRetryAt: new Date(Date.now() + 5 * 60 * 1000)
                       }
               );
            }

            continue;
         }

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
            notification.message,
            { type: notification.type }
         );

         // If push successful, mark notification as sent
         if (pushResult.success) {
            await Notification.updateOne(
               { _id: notification._id },
               {
                  pushStatus: "sent"
               }
            );

         } else if (pushResult.suppressed) {
            // NOT-003-T03/T04 -- preference-disabled type or quiet hours.
            // Terminal, not retried -- see the matching comment on the
            // ended-notification path above for why "failed" would be wrong
            // here.
            await Notification.updateOne(
               { _id: notification._id },
               { pushStatus: "suppressed" }
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
