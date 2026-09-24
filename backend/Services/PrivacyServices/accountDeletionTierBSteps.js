"use strict";

// PRV-001-T06 (ADR-0007 Tier B) -- hard-deletes the 13 user-linked
// collections not already handled by Tier A (see accountDeletionTierASteps
// .js), plus the `users` document itself last. Every step here is a plain
// deleteMany scoped to the user's ownership field -- idempotent by
// construction, since deleting an already-empty set is a no-op, which is
// exactly what T04's resumable orchestration (accountDeletionOrchestrator
// .js) requires: a crashed/interrupted purge run is safely resumed by the
// next daily cycle simply re-running the FULL step sequence from the top.
//
// `receipts` (OCR-004) is the one exception to "plain deleteMany" -- see
// deleteReceiptsStep below, added when OCR-004 introduced the first
// Tier-B-owned collection backed by an external blob (a GridFS image, not
// just a Mongo document) rather than being an oversight in this comment.
//
// Field-name note, confirmed by reading each model file directly rather
// than assumed from its collection name: most of these use `userId` as the
// ownership field, but FinancialReport, PendingSync, SiaSession, SiaMessage
// and SiaRequest all use `user` instead (SiaMessage's `user` field is a
// deliberate denormalization onto every message, per that model's own
// comment, so a per-user query needs no join back through `session`).
//
// `mlfeedbacks`: ADR-0007 resolves PRV-001-T01's gap 4.1
// (MlFeedbackSchema.userId is NOT a required field) by treating a
// null/missing-userId document as un-owned and therefore untouched by any
// single user's deletion. That resolution needs no special-casing here --
// a `{ userId }` equality filter with a real ObjectId simply never matches
// a null/missing field, so an orphaned document is already excluded by
// construction, not by an explicit check.
//
// `users` is deleted LAST (ADR-0007): its continued existence with
// deletionRequestedAt/deletionScheduledPurgeAt still set is what
// accountDeletionOrchestrator.js's eligibility query relies on as the
// "not yet fully purged" signal, so nothing may run after it -- see
// cron/accountDeletionJob.js for how this list is combined with Tier A's.

const { ExpenseModel, IncomeModel, BudgetModel, MlFeedbackModel, UserModel } = require("../../config/Schemas");
const MerchantCategoryRule = require("../../models/MerchantCategoryRule");
const { RecurringExpenseModel } = require("../../models/RecurringExpense");
const FinancialReport = require("../../models/Report");
const PendingSync = require("../../models/PendingSync");
const Notification = require("../../models/Notification");
const SiaSession = require("../../models/SiaSession");
const SiaMessage = require("../../models/SiaMessage");
const SiaRequest = require("../../models/SiaRequest");
const Receipt = require("../../models/Receipt");
const { deleteReceiptObject } = require("../ReceiptServices/receiptStorageAdapter");

async function deleteExpensesStep(userId) { await ExpenseModel.deleteMany({ userId }); }
async function deleteIncomesStep(userId) { await IncomeModel.deleteMany({ userId }); }
async function deleteBudgetsStep(userId) { await BudgetModel.deleteMany({ userId }); }
async function deleteMerchantCategoryRulesStep(userId) { await MerchantCategoryRule.deleteMany({ userId }); }
async function deleteRecurringExpensesStep(userId) { await RecurringExpenseModel.deleteMany({ userId }); }

// OCR-004 -- unlike every other step here, a Receipt document is not the
// whole of what this user owns in that collection: each one also has an
// image sitting in the "receipts" GridFS bucket (receiptStorageAdapter.js
// is the ONLY module allowed to touch it directly, same rule OCR-004's own
// modules follow). A plain `Receipt.deleteMany({ userId })` alone would
// hard-delete the metadata but permanently orphan every one of that user's
// receipt images in storage -- a real, ongoing privacy leak for exactly
// the account that just asked to be fully deleted, not a cosmetic gap.
//
// The per-item storage delete is deliberately best-effort (logged, never
// thrown): accountDeletionOrchestrator.js's purgeUser() stops the ENTIRE
// Tier B sequence for this user at the first step that throws, and
// `delete-user` -- the one step that MUST always eventually run, since its
// completion is what the resumable purge relies on as "this user is done"
// -- comes after this one. A single stuck/unreachable GridFS object must
// never be able to block a user's whole account deletion indefinitely (the
// next scheduled cycle would just hit the exact same failure again and
// again). So: best-effort delete every blob this user owns, log any
// failure for ops follow-up, and ALWAYS still remove the Receipt documents
// -- the purge's actual privacy guarantee is "this data is no longer
// queryable or visible to anyone", not "every last byte is synchronously,
// unconditionally freed"; a rare orphaned blob left behind by a storage
// failure is an accepted, logged residual risk, not a silent one.
async function deleteReceiptsStep(userId) {
  const receipts = await Receipt.find({ userId }).select("_id storageKey").lean();
  for (const receipt of receipts) {
    try {
      await deleteReceiptObject(receipt.storageKey);
    } catch (err) {
      console.error("accountDeletionTierBSteps: failed to delete a receipt's storage object", {
        receiptId: String(receipt._id),
        errorCode: (err && err.code) || null,
      });
    }
  }
  await Receipt.deleteMany({ userId });
}

async function deleteMlFeedbackStep(userId) { await MlFeedbackModel.deleteMany({ userId }); }
async function deleteNotificationsStep(userId) { await Notification.deleteMany({ userId }); }
async function deletePendingSyncStep(userId) { await PendingSync.deleteMany({ user: userId }); }
async function deleteFinancialReportStep(userId) { await FinancialReport.deleteMany({ user: userId }); }
async function deleteSiaMessagesStep(userId) { await SiaMessage.deleteMany({ user: userId }); }
async function deleteSiaSessionsStep(userId) { await SiaSession.deleteMany({ user: userId }); }
async function deleteSiaRequestsStep(userId) { await SiaRequest.deleteMany({ user: userId }); }
// MUST be the LAST entry in TIER_B_STEPS -- see module comment.
async function deleteUserStep(userId) { await UserModel.deleteOne({ _id: userId }); }

// Order: every other collection before `users`, which is always last. Among
// the rest, no step depends on another having already run (each deletes a
// disjoint collection), so the order among them is chosen for readability
// only -- financial/transactional data first, derived/secondary data
// (reports, sync markers), then SIA conversation data (messages before
// their parent session, children-before-parent for a human reading this
// list, though nothing here functionally requires that order either).
const TIER_B_STEPS = [
  { name: "delete-expenses", run: deleteExpensesStep },
  { name: "delete-incomes", run: deleteIncomesStep },
  { name: "delete-budgets", run: deleteBudgetsStep },
  { name: "delete-merchant-category-rules", run: deleteMerchantCategoryRulesStep },
  { name: "delete-recurring-expenses", run: deleteRecurringExpensesStep },
  { name: "delete-receipts", run: deleteReceiptsStep },
  { name: "delete-ml-feedback", run: deleteMlFeedbackStep },
  { name: "delete-notifications", run: deleteNotificationsStep },
  { name: "delete-pending-sync", run: deletePendingSyncStep },
  { name: "delete-financial-report", run: deleteFinancialReportStep },
  { name: "delete-sia-messages", run: deleteSiaMessagesStep },
  { name: "delete-sia-sessions", run: deleteSiaSessionsStep },
  { name: "delete-sia-requests", run: deleteSiaRequestsStep },
  { name: "delete-user", run: deleteUserStep },
];

module.exports = {
  TIER_B_STEPS,
  deleteExpensesStep,
  deleteIncomesStep,
  deleteBudgetsStep,
  deleteMerchantCategoryRulesStep,
  deleteRecurringExpensesStep,
  deleteReceiptsStep,
  deleteMlFeedbackStep,
  deleteNotificationsStep,
  deletePendingSyncStep,
  deleteFinancialReportStep,
  deleteSiaMessagesStep,
  deleteSiaSessionsStep,
  deleteSiaRequestsStep,
  deleteUserStep,
};
