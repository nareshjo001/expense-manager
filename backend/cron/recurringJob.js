const crypto = require('crypto');
const cron = require('node-cron');

const { RecurringExpenseModel } = require('../models/RecurringExpense');
const { ExpenseModel } = require('../config/Schemas');
const Notification = require("../models/Notification");

const { sendPush } = require('../Services/push.service');
const { clearUserExpenseCache } = require('../utils/expenseCache');
const { normalizeCategory, UNCATEGORIZED } = require('../utils/categoryNormalization');
// Remediation follow-up -- durable report/cache synchronization across a
// crash between insert and sync. See the reserve()/synchronizeAfterMutation()
// doc comments below for the exact window this closes; this reuses the SAME
// crash-gap-closing machinery addexpense.js/editExpense.js/addincome.js
// already rely on, rather than the raw recalculateBudget/refreshReport calls
// this file used before, which left NO durable evidence at all if the
// process died between a successful insert and the sync call.
//
// Remediation follow-up #2 -- abandon() is deliberately NOT used on the
// E11000 replay path below. See the doc comment at that call site for the
// full reasoning; the short version: reservedReports/
// reservedUserWideReservations are now owned-token ARRAYS on PendingSync
// (see models/PendingSync.js and Services/syncRecoveryService.js's
// system-wide reservation-ownership correction), so THIS run's own
// reserve() call above can no longer silently overwrite or destroy a
// crashed run's still-unconfirmed reservation entry -- multiple
// reservations for the same user now always coexist. That means calling
// abandon() here would ALSO now be safe in the narrow sense that it could
// never disturb the crashed run's own token. It is still not called,
// though, for a separate, still-valid reason: this run does not own the
// crashed run's token, so it has no standing to retire it, and doing so
// would provide no benefit -- synchronizeAfterMutation() below already
// drives one real, correct reconciliation (recalculateBudget/refreshReport
// recompute from CURRENT authoritative expense data, which by this point
// already includes the crashed run's successfully-inserted occurrence) via
// THIS run's own reservation, and confirm() (its first action) atomically
// upgrades Tier-2 evidence into durable Tier-1 evidence in the SAME write
// that releases only this run's own token -- evidence is only ever
// upgraded, never merely deleted. The crashed run's own orphaned
// reservation entry (if it never confirmed/abandoned before dying) simply
// survives, exactly like any other abandoned reservation in this codebase
// (see repairIfPending()'s Tier-2 doc comment for the accepted, unbounded-
// but-safe cost of that) -- never a correctness problem, since the data
// itself is already correctly synced by this run's own reconciliation.
const { reserve, synchronizeAfterMutation } = require('../Services/syncRecoveryService');

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

         // Remediation Workstream D -- deterministic occurrence identity,
         // tied to (recurring definition, due instant), replacing
         // crypto.randomUUID(). config/Schemas.js's existing
         // `expenseSchema.index({ userId: 1, id: 1 }, { unique: true })`
         // (unchanged -- no migration needed) now does double duty as the
         // durable dedupe guard for this occurrence: two concurrent cron
         // replicas (or a single replica retrying after a crash) computing
         // this SAME hash for the SAME due instant can never both insert an
         // Expense document for it -- the second insert attempt always hits
         // E11000, handled below as a confirmed-idempotent replay rather
         // than an unexpected failure.
         //
         // Root cause this closes: the previous flow advanced
         // RecurringExpenseModel.nextDueDate (via the atomic CAS just below)
         // BEFORE ExpenseModel.create() ran. If create() then threw for any
         // reason, that recurrence's due date had already moved to next
         // month -- the occurrence was silently, permanently lost, with no
         // record it was ever supposed to happen and no future cron run
         // that would ever retry it. The new order -- insert (or confirm an
         // existing insert) FIRST, advance nextDueDate only afterward --
         // means a crash/failure at any point before the insert commits
         // leaves nextDueDate untouched, so the SAME due occurrence is
         // retried on the next cron tick using the SAME deterministic id
         // (never creating a duplicate expense, never losing the
         // occurrence). If the insert succeeds but the subsequent
         // nextDueDate advancement fails/is superseded, the next tick's
         // insert attempt for this same id hits E11000 (proof the
         // occurrence already exists) and safely retries only the
         // advancement -- never a second financial write.
         const occurrenceId = crypto
            .createHash("sha256")
            .update(`${recurring._id}:${originalNextDue.toISOString()}`)
            .digest("hex");

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

         // Crash-gap closure, part 2 (report/cache synchronization) -- the
         // expense date is computed ONCE, here, and reused for BOTH the
         // reservation below and the actual insert -- never two separately
         // computed `new Date()` calls that could (at a month boundary) name
         // different budget months.
         const occurrenceExpenseDate = new Date();

         // Durable, pre-write evidence (Tier-2 reservation on PendingSync,
         // written via a real Mongo update) that this occurrence's insert is
         // ABOUT to happen and will need budget/report synchronization --
         // taken BEFORE the insert, exactly like addexpense.js's own
         // reserve() call. This is what survives a process crash between the
         // insert committing and the synchronizeAfterMutation() call below:
         // even if the process dies immediately after the insert succeeds,
         // repairIfPending() will find this reservation (once it is older
         // than RESERVATION_STALE_MS -- trivially true by the NEXT cron
         // tick, since this job runs once a day) and defensively recompute
         // the budget/report from current data. Before this fix, this file
         // called recalculateBudget/refreshReport directly with NO prior
         // reservation and no PendingSync involvement at all -- a crash (or
         // any propagation failure) between a successful insert and those
         // calls left ZERO durable evidence that sync was ever needed, so a
         // committed recurring expense could leave the report/budget
         // permanently stale until an unrelated mutation happened to
         // refresh it.
         const reserved = await reserve({
            userId: recurring.userId,
            budgetDates: [occurrenceExpenseDate],
            reserveReport: true,
         });

         // Remediation Workstream D -- insert BEFORE advancing nextDueDate.
         // `wasNewInsert` distinguishes a genuine first-time log (do the
         // full downstream work below) from a confirmed replay of an
         // occurrence this or another replica already logged (only the
         // schedule advancement, if still needed, is retried -- never the
         // notification/push/sync side effects a second time).
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
               // replica on a prior crashed attempt, or by a concurrent
               // replica) -- MongoDB's unique index proves it atomically.
               //
               // Reservation-ownership correction (system-wide fix,
               // reassessed here after that fix): reservedReports/
               // reservedUserWideReservations are now owned-token ARRAYS on
               // PendingSync (see models/PendingSync.js and
               // Services/syncRecoveryService.js), not single-object fields
               // -- so THIS run's reserve() call above no longer overwrites
               // or destroys whatever token the CRASHED run that actually
               // inserted this expense had reserved; both entries coexist
               // in the array. That means the ORIGINAL overwrite hazard
               // this comment used to describe (a prior version of this
               // branch called abandon() on this run's own tokens, which
               // under the OLD single-slot design could destroy the
               // crashed run's already-overwritten evidence with nothing
               // left for repairIfPending() to act on) no longer applies as
               // stated. Verified: even under the new array design, this
               // branch still deliberately never calls abandon() here --
               // not because it would be unsafe (it would not be: abandon()
               // now only ever pulls the exact token it is given, never a
               // different reservation's entry), but because this run has
               // no way to know the crashed run's token even exists to
               // target, and no benefit would come from guessing at it.
               // THIS run's own reservation (just taken above, definitely
               // not stale) is instead used to drive one real reconciliation
               // via synchronizeAfterMutation() -- the exact same call the
               // new-insert path below uses. confirm() (its first action)
               // atomically upgrades Tier-2 evidence into durable Tier-1
               // evidence in the SAME write that releases only this run's
               // own token, so evidence is only ever added/upgraded, never
               // merely deleted; if the recompute itself then fails, the
               // Tier-1 marker it just wrote survives and remains retryable
               // by any later read (this cron's next tick, or any ordinary
               // getReport()/getbudgets.js call). Any orphaned reservation
               // entry the crashed run left behind (if it died before its
               // own confirm()) simply survives in the array, untouched --
               // harmless, since the budget/report data itself is already
               // correctly resynced by this run's own reconciliation; at
               // worst it costs one extra defensive Tier-2 recompute on
               // every future repairIfPending() call for this user until
               // something eventually confirms/abandons that exact token
               // (see repairIfPending()'s own doc comment for why this
               // unbounded-but-safe cost is the deliberate, accepted trade).
               // This branch is only ever reached when nextDueDate was NOT
               // yet advanced (see below), which by construction means the
               // occurrence's own synchronization was never completed --
               // so this reconciliation is never wasted/redundant work on
               // an already-fully-synced replay; a fully completed prior
               // run would have advanced nextDueDate into the future and
               // this recurring definition would not have been selected by
               // this tick's due-date query at all.
               expense = await ExpenseModel.findOne({ userId: recurring.userId, id: occurrenceId }).lean();
               wasNewInsert = false;
            } else {
               // A genuine, non-dedupe insert failure is AMBIGUOUS -- it
               // does not prove the insert never reached the server (see
               // addexpense.js's identical writeStatus doc comment). The
               // reservation taken above is deliberately LEFT IN PLACE
               // (never abandoned here) so a write that may have actually
               // landed still has durable evidence a later read-time
               // repair can act on; nextDueDate is also NEVER advanced for
               // this recurring definition this tick -- it remains due, so
               // the next cron run retries this exact occurrence (same
               // deterministic id, so a later successful insert still can
               // never duplicate). Move on to the next due recurring
               // expense in this run rather than aborting the whole batch.
               console.error(
                  `Recurring cron: expense insert failed for recurring ${recurring._id} (occurrence ${occurrenceId}):`,
                  createErr
               );
               continue;
            }
         }

         // Claim/advance the schedule only now that the occurrence is
         // KNOWN to be durably inserted (new or already-existing). The
         // atomic CAS filter (nextDueDate must still equal what this
         // iteration read) is unchanged and still prevents two concurrent
         // replicas from both advancing the same recurring definition; if
         // another replica already advanced it first, this simply no-ops
         // (`updated` is null) -- never an error, since the expense write
         // itself is already safely deduplicated above.
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
            // still needed to be; no duplicate notification or push. Drive
            // ONE reconciliation using THIS run's own (definitely-current,
            // definitely-not-stale) reservation -- see the doc comment at
            // the E11000 catch branch above for why abandon()+
            // repairIfPending() is unsafe here and synchronizeAfterMutation()
            // is used instead. Never throws out of this branch: a failure
            // here leaves the Tier-1 marker confirm() already wrote intact
            // and durable, retryable by a later read, exactly like any
            // other synchronizeAfterMutation() failure elsewhere in this
            // codebase.
            const derivedData = await synchronizeAfterMutation({
               userId: recurring.userId,
               budgetDates: [occurrenceExpenseDate],
               budgetTokens: reserved.budgetReservations.map((r) => r.token),
               reportToken: reserved.reportReservation && reserved.reportReservation.token,
            }).catch((syncErr) => {
               console.error(
                  `Recurring cron: replay reconciliation failed for recurring ${recurring._id} (occurrence ${occurrenceId}):`,
                  syncErr
               );
               return null;
            });
            if (derivedData && derivedData.recoveryPending) {
               console.error(
                  `Recurring cron: report/budget synchronization left pending after replay for user ${recurring.userId} (occurrence ${occurrenceId}, budget=${derivedData.budget}, report=${derivedData.report})`
               );
            }
            continue;
         }

         // Cache clearing is a pure optimization (utils/expenseCache.js's own
         // functions already self-catch every Redis error), so it is never
         // part of the derived-data synchronization durability below.
         await clearUserExpenseCache(recurring.userId);

         // Recalculate the budget and refresh the report using the SAME
         // reserve()-confirm()-recompute-persist lifecycle addexpense.js
         // uses, passing the reservation tokens taken BEFORE the insert
         // above. synchronizeAfterMutation()'s FIRST action is confirm() --
         // an unconditional, durable Tier-1 marker write -- so even if the
         // process crashes immediately after this call is entered (before
         // any recompute even starts), durable evidence already exists that
         // this exact user needs a budget/report resync; a future read
         // (this cron's own next-tick E11000 replay-reconciliation branch
         // above, OR any ordinary getReport()/getbudgets.js call from the
         // user) will repair it. Runs only once per genuinely new occurrence -- see
         // wasNewInsert above -- so a replay never re-bumps the revision or
         // regenerates the report for work that already completed.
         const derivedData = await synchronizeAfterMutation({
            userId: recurring.userId,
            budgetDates: [expense.expenseDate],
            budgetTokens: reserved.budgetReservations.map((r) => r.token),
            reportToken: reserved.reportReservation && reserved.reportReservation.token,
         });
         if (derivedData.recoveryPending) {
            // Not a failure of THIS request -- the expense is already
            // durably committed and the Tier-1 marker synchronizeAfterMutation
            // just wrote is the recovery evidence; only logged for
            // operator visibility.
            console.error(
               `Recurring cron: report/budget synchronization left pending for user ${recurring.userId} (budget=${derivedData.budget}, report=${derivedData.report})`
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