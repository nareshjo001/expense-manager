"use strict";

// Js), plus the `users` document itself last.

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
const { CategoryBudgetModel } = require("../../models/CategoryBudget");
const { deleteReceiptObject } = require("../ReceiptServices/receiptStorageAdapter");

async function deleteExpensesStep(userId) { await ExpenseModel.deleteMany({ userId }); }
async function deleteIncomesStep(userId) { await IncomeModel.deleteMany({ userId }); }
async function deleteBudgetsStep(userId) { await BudgetModel.deleteMany({ userId }); }
// BUD-001 (I15) -- per-category allocations, owned by `userId`.
async function deleteCategoryBudgetsStep(userId) { await CategoryBudgetModel.deleteMany({ userId }); }
async function deleteMerchantCategoryRulesStep(userId) { await MerchantCategoryRule.deleteMany({ userId }); }
async function deleteRecurringExpensesStep(userId) { await RecurringExpenseModel.deleteMany({ userId }); }

// Js is the ONLY module allowed to touch it directly, same rule OCR-004's own modules follow).
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

// Order: every other collection before `users`, which is always last.
const TIER_B_STEPS = [
  { name: "delete-expenses", run: deleteExpensesStep },
  { name: "delete-incomes", run: deleteIncomesStep },
  { name: "delete-budgets", run: deleteBudgetsStep },
  { name: "delete-category-budgets", run: deleteCategoryBudgetsStep },
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
  deleteCategoryBudgetsStep,
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
