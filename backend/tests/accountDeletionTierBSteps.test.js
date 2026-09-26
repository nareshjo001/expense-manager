// PRV-001-T06 -- Tier B hard-deletion steps (ADR-0007). Under test: that
// each step deletes from the right model, scoped by the right ownership
// field -- `userId` for most collections, but `user` for FinancialReport/
// PendingSync/SiaSession/SiaMessage/SiaRequest, confirmed by reading each
// model file directly (see accountDeletionTierBSteps.js's module comment)
// -- and that `delete-user` is the last entry in TIER_B_STEPS, since
// ADR-0007 requires `users` to be deleted after everything else.
"use strict";

const SCHEMAS_PATH = "../config/Schemas";
const MERCHANT_RULE_PATH = "../models/MerchantCategoryRule";
const RECURRING_EXPENSE_PATH = "../models/RecurringExpense";
const REPORT_PATH = "../models/Report";
const PENDING_SYNC_PATH = "../models/PendingSync";
const NOTIFICATION_PATH = "../models/Notification";
const SIA_SESSION_PATH = "../models/SiaSession";
const SIA_MESSAGE_PATH = "../models/SiaMessage";
const SIA_REQUEST_PATH = "../models/SiaRequest";
const MODULE_PATH = "../Services/PrivacyServices/accountDeletionTierBSteps";
const RECEIPT_PATH = "../models/Receipt";
const CATEGORY_BUDGET_PATH = "../models/CategoryBudget";
const RECEIPT_STORAGE_ADAPTER_PATH = "../Services/ReceiptServices/receiptStorageAdapter";

function makeDeleteManyModel() {
  return { deleteMany: jest.fn(async () => ({ deletedCount: 0 })) };
}

function loadModule() {
  jest.resetModules();

  const ExpenseModel = makeDeleteManyModel();
  const IncomeModel = makeDeleteManyModel();
  const BudgetModel = makeDeleteManyModel();
  const MlFeedbackModel = makeDeleteManyModel();
  const UserModel = { deleteOne: jest.fn(async () => ({ deletedCount: 0 })) };
  jest.doMock(SCHEMAS_PATH, () => ({ ExpenseModel, IncomeModel, BudgetModel, MlFeedbackModel, UserModel }));

  const MerchantCategoryRule = makeDeleteManyModel();
  jest.doMock(MERCHANT_RULE_PATH, () => MerchantCategoryRule);

  const RecurringExpenseModel = makeDeleteManyModel();
  jest.doMock(RECURRING_EXPENSE_PATH, () => ({ RecurringExpenseModel }));

  const FinancialReport = makeDeleteManyModel();
  jest.doMock(REPORT_PATH, () => FinancialReport);

  const PendingSync = makeDeleteManyModel();
  jest.doMock(PENDING_SYNC_PATH, () => PendingSync);

  const Notification = makeDeleteManyModel();
  jest.doMock(NOTIFICATION_PATH, () => Notification);

  const SiaSession = makeDeleteManyModel();
  jest.doMock(SIA_SESSION_PATH, () => SiaSession);

  const SiaMessage = makeDeleteManyModel();
  jest.doMock(SIA_MESSAGE_PATH, () => SiaMessage);

  const SiaRequest = makeDeleteManyModel();
  jest.doMock(SIA_REQUEST_PATH, () => SiaRequest);

  // Receipt is find()+select()+lean()-queried (not deleteMany'd directly --
  // see deleteReceiptsStep's own comment on why), so its fake needs a
  // chainable find(), plus deleteMany for the actual document removal.
  const receiptDocs = [];
  const Receipt = {
    __docs: receiptDocs,
    find: jest.fn(() => ({
      select: jest.fn(() => ({
        lean: jest.fn(async () => receiptDocs),
      })),
    })),
    deleteMany: jest.fn(async () => ({ deletedCount: receiptDocs.length })),
  };
  jest.doMock(RECEIPT_PATH, () => Receipt);

  const deleteReceiptObject = jest.fn(async () => {});
  jest.doMock(RECEIPT_STORAGE_ADAPTER_PATH, () => ({ deleteReceiptObject }));

  const CategoryBudgetModel = makeDeleteManyModel();
  jest.doMock(CATEGORY_BUDGET_PATH, () => ({ CategoryBudgetModel }));

  const mod = require(MODULE_PATH);
  return {
    ...mod,
    models: {
      ExpenseModel, IncomeModel, BudgetModel, MlFeedbackModel, UserModel,
      MerchantCategoryRule, RecurringExpenseModel, FinancialReport, PendingSync,
      Notification, SiaSession, SiaMessage, SiaRequest, Receipt, CategoryBudgetModel,
    },
    deleteReceiptObject,
  };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("PRV-001-T06 Tier B step -> model/field mapping", () => {
  test("userId-scoped collections", async () => {
    const { models, deleteExpensesStep, deleteIncomesStep, deleteBudgetsStep, deleteCategoryBudgetsStep,
      deleteMerchantCategoryRulesStep, deleteRecurringExpensesStep, deleteMlFeedbackStep,
      deleteNotificationsStep } = loadModule();

    await deleteExpensesStep("user-1");
    expect(models.ExpenseModel.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });

    await deleteIncomesStep("user-1");
    expect(models.IncomeModel.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });

    await deleteBudgetsStep("user-1");
    expect(models.BudgetModel.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });

    await deleteCategoryBudgetsStep("user-1");
    expect(models.CategoryBudgetModel.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });

    await deleteMerchantCategoryRulesStep("user-1");
    expect(models.MerchantCategoryRule.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });

    await deleteRecurringExpensesStep("user-1");
    expect(models.RecurringExpenseModel.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });

    await deleteMlFeedbackStep("user-1");
    expect(models.MlFeedbackModel.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });

    await deleteNotificationsStep("user-1");
    expect(models.Notification.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });
  });

  test("user-scoped collections (FinancialReport, PendingSync, SiaSession, SiaMessage, SiaRequest)", async () => {
    const { models, deletePendingSyncStep, deleteFinancialReportStep,
      deleteSiaMessagesStep, deleteSiaSessionsStep, deleteSiaRequestsStep } = loadModule();

    await deletePendingSyncStep("user-1");
    expect(models.PendingSync.deleteMany).toHaveBeenCalledWith({ user: "user-1" });

    await deleteFinancialReportStep("user-1");
    expect(models.FinancialReport.deleteMany).toHaveBeenCalledWith({ user: "user-1" });

    await deleteSiaMessagesStep("user-1");
    expect(models.SiaMessage.deleteMany).toHaveBeenCalledWith({ user: "user-1" });

    await deleteSiaSessionsStep("user-1");
    expect(models.SiaSession.deleteMany).toHaveBeenCalledWith({ user: "user-1" });

    await deleteSiaRequestsStep("user-1");
    expect(models.SiaRequest.deleteMany).toHaveBeenCalledWith({ user: "user-1" });
  });

  test("deleteUserStep deletes the users document by _id, not deleteMany", async () => {
    const { models, deleteUserStep } = loadModule();
    await deleteUserStep("user-1");
    expect(models.UserModel.deleteOne).toHaveBeenCalledWith({ _id: "user-1" });
  });
});

describe("OCR-004 deleteReceiptsStep -- blob + document cleanup", () => {
  test("deletes each receipt's storage object then removes the documents", async () => {
    const { models, deleteReceiptObject, deleteReceiptsStep } = loadModule();
    models.Receipt.__docs.push(
      { _id: "receipt-1", storageKey: "aaaaaaaaaaaaaaaaaaaaaaaa" },
      { _id: "receipt-2", storageKey: "bbbbbbbbbbbbbbbbbbbbbbbb" }
    );

    await deleteReceiptsStep("user-1");

    expect(models.Receipt.find).toHaveBeenCalledWith({ userId: "user-1" });
    expect(deleteReceiptObject).toHaveBeenCalledWith("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(deleteReceiptObject).toHaveBeenCalledWith("bbbbbbbbbbbbbbbbbbbbbbbb");
    expect(deleteReceiptObject).toHaveBeenCalledTimes(2);
    expect(models.Receipt.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });
  });

  test("a single failed storage delete is logged, never thrown -- the document delete still runs", async () => {
    const { models, deleteReceiptsStep } = loadModule();
    models.Receipt.__docs.push(
      { _id: "receipt-1", storageKey: "aaaaaaaaaaaaaaaaaaaaaaaa" },
      { _id: "receipt-2", storageKey: "bbbbbbbbbbbbbbbbbbbbbbbb" }
    );

    const { deleteReceiptObject: failingDelete } = require(RECEIPT_STORAGE_ADAPTER_PATH);
    failingDelete.mockImplementationOnce(async () => { throw new Error("storage unreachable"); });

    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    // Must not throw -- accountDeletionOrchestrator.js's purgeUser() aborts
    // the ENTIRE Tier B sequence for this user at the first step that
    // throws, and delete-user (the step that must always eventually run)
    // comes after this one. A single unreachable blob must never be able
    // to block a whole account deletion.
    await expect(deleteReceiptsStep("user-1")).resolves.toBeUndefined();

    expect(failingDelete).toHaveBeenCalledTimes(2);
    expect(models.Receipt.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  test("no receipts for this user -- a no-op, not an error", async () => {
    const { models, deleteReceiptObject, deleteReceiptsStep } = loadModule();
    await expect(deleteReceiptsStep("user-1")).resolves.toBeUndefined();
    expect(deleteReceiptObject).not.toHaveBeenCalled();
    expect(models.Receipt.deleteMany).toHaveBeenCalledWith({ userId: "user-1" });
  });
});

describe("PRV-001-T06 TIER_B_STEPS ordering contract", () => {
  test("delete-user is the last entry (ADR-0007: users deleted last)", () => {
    const { TIER_B_STEPS } = loadModule();
    expect(TIER_B_STEPS[TIER_B_STEPS.length - 1].name).toBe("delete-user");
  });

  test("lists exactly the 14 Tier B collections plus users (15 steps total)", () => {
    const { TIER_B_STEPS } = loadModule();
    expect(TIER_B_STEPS).toHaveLength(15);
    expect(TIER_B_STEPS.map((s) => s.name)).toEqual([
      "delete-expenses",
      "delete-incomes",
      "delete-budgets",
      "delete-category-budgets",
      "delete-merchant-category-rules",
      "delete-recurring-expenses",
      "delete-receipts",
      "delete-ml-feedback",
      "delete-notifications",
      "delete-pending-sync",
      "delete-financial-report",
      "delete-sia-messages",
      "delete-sia-sessions",
      "delete-sia-requests",
      "delete-user",
    ]);
    for (const step of TIER_B_STEPS) {
      expect(typeof step.run).toBe("function");
    }
  });
});

describe("PRV-001-T06 orphaned mlfeedbacks are excluded by construction", () => {
  test("deleteMlFeedbackStep's filter can never match a null/missing userId document", async () => {
    // ADR-0007's resolution of PRV-001-T01 gap 4.1: an equality filter on a
    // real ObjectId string never matches a document where userId is null
    // or absent -- there is no special-casing to test because there is
    // none in the implementation; this test documents and locks in that
    // the filter shape itself is what provides the guarantee.
    const { models, deleteMlFeedbackStep } = loadModule();
    await deleteMlFeedbackStep("user-1");
    const filter = models.MlFeedbackModel.deleteMany.mock.calls[0][0];
    expect(filter).toEqual({ userId: "user-1" });
    expect(filter.userId).not.toBeNull();
    expect(Object.keys(filter)).not.toContain("$or");
  });
});
