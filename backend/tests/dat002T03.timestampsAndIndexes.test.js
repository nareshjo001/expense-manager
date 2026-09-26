// DAT-002-T03 -- "Add timestamps and operational compound indexes."
// Investigated before implementing (docs/data/DAT-002-T01-schema-and-index-
// inventory.md, gaps 3.3 and 3.5): six schemas had no createdAt/updatedAt
// (expenseSchema, userSchema, IncomeSchema, budgetSchema,
// RecurringExpenseSchema had none at all; Notification had a manual
// createdAt only), and DeviceToken.userId/Notification.userId had no index
// at all. This file exercises the real schema objects directly -- no live
// MongoDB is available in this environment, so:
//   - timestamps are verified with mongoose's own `initializeTimestamps()`
//     method (a real, synchronous, schema-attached method -- not a
//     hand-rolled substitute -- that the library's own pre('save') hook
//     calls; see node_modules/mongoose/lib/helpers/timestamps/
//     setupTimestamps.js, read directly before writing this test).
//   - indexes are verified via schema.indexes(), mongoose's own accessor
//     for every schema.index(...)/field-level index declaration, not by
//     re-parsing source.
"use strict";

const mongoose = require("mongoose");

const {
  UserModel,
  ExpenseModel,
  IncomeModel,
  BudgetModel,
} = require("../config/Schemas");
const { RecurringExpenseModel } = require("../models/RecurringExpense");
const NotificationModel = require("../models/Notification");
const DeviceTokenModel = require("../models/DeviceToken");

function expectRealCreatedAtAndUpdatedAt(doc) {
  expect(doc.createdAt).toBeUndefined();
  expect(doc.updatedAt).toBeUndefined();
  doc.initializeTimestamps();
  expect(doc.createdAt).toBeInstanceOf(Date);
  expect(doc.updatedAt).toBeInstanceOf(Date);
}

describe("DAT-002-T03: timestamps added to previously-bare schemas", () => {
  test("userSchema: timestamps option is on and initializeTimestamps() populates both fields", () => {
    expect(UserModel.schema.options.timestamps).toBe(true);
    const doc = new UserModel({
      fullName: "Test User",
      email: "test@example.com",
      password: "hashed",
    });
    expectRealCreatedAtAndUpdatedAt(doc);
  });

  test("expenseSchema: timestamps option is on and initializeTimestamps() populates both fields", () => {
    expect(ExpenseModel.schema.options.timestamps).toBe(true);
    const doc = new ExpenseModel({
      userId: new mongoose.Types.ObjectId(),
      id: "exp-1",
      expenseName: "Coffee",
      expenseCategory: "Food",
      expenseAmount: 5,
      expenseDate: new Date(),
    });
    expectRealCreatedAtAndUpdatedAt(doc);
  });

  test("budgetSchema: timestamps option is on and initializeTimestamps() populates both fields", () => {
    expect(BudgetModel.schema.options.timestamps).toBe(true);
    const doc = new BudgetModel({
      userId: new mongoose.Types.ObjectId(),
      month: "Jan 2026",
      budget: 1000,
      spent: 0,
    });
    expectRealCreatedAtAndUpdatedAt(doc);
  });

  test("IncomeSchema: timestamps option is on and initializeTimestamps() populates both fields", () => {
    expect(IncomeModel.schema.options.timestamps).toBe(true);
    const doc = new IncomeModel({
      userId: new mongoose.Types.ObjectId(),
      incomeSource: "Salary",
      incomeAmount: 5000,
      incomeDate: new Date(),
    });
    expectRealCreatedAtAndUpdatedAt(doc);
  });

  test("RecurringExpenseSchema: timestamps option is on and initializeTimestamps() populates both fields", () => {
    expect(RecurringExpenseModel.schema.options.timestamps).toBe(true);
    const doc = new RecurringExpenseModel({
      userId: new mongoose.Types.ObjectId(),
      expenseId: new mongoose.Types.ObjectId(),
      expenseName: "Rent",
      expenseCategory: "Housing",
      expenseAmount: 1200,
      lastLoggedDate: new Date(),
      nextDueDate: new Date(),
    });
    expectRealCreatedAtAndUpdatedAt(doc);
  });

  test("notificationSchema: timestamps option is on; pre-existing manual createdAt default is not disturbed", () => {
    expect(NotificationModel.schema.options.timestamps).toBe(true);
    const doc = new NotificationModel({
      userId: new mongoose.Types.ObjectId(),
      title: "Reminder",
      message: "Your bill is due",
    });
    // Notification's createdAt has always had `default: Date.now`, so
    // (unlike the other models above) it is already set at construction --
    // confirms adding `timestamps: true` did not disturb that pre-existing
    // field/default, only added updatedAt (verified directly against
    // mongoose's own setDocumentTimestamps: it never overwrites an
    // already-set createdAt, see node_modules/mongoose/lib/helpers/
    // timestamps/setDocumentTimestamps.js).
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.updatedAt).toBeUndefined();
    doc.initializeTimestamps();
    expect(doc.updatedAt).toBeInstanceOf(Date);
  });
});

describe("DAT-002-T03: operational userId indexes on previously-unindexed collections", () => {
  test("DeviceToken.userId now has a real schema-declared index", () => {
    const indexes = DeviceTokenModel.schema.indexes();
    const found = indexes.some(([key]) => key.userId === 1);
    expect(found).toBe(true);
  });

  test("Notification.userId now has a real schema-declared index", () => {
    const indexes = NotificationModel.schema.indexes();
    const found = indexes.some(([key]) => key.userId === 1);
    expect(found).toBe(true);
  });
});

describe("DAT-002-T03: previously-timestamped/indexed schemas are unaffected", () => {
  test("MlFeedbackSchema still has timestamps: true (unchanged by this task)", () => {
    const { MlFeedbackModel } = require("../config/Schemas");
    expect(MlFeedbackModel.schema.options.timestamps).toBe(true);
  });

  test("DeviceToken still has its own pre-existing timestamps: true (unchanged by this task)", () => {
    expect(DeviceTokenModel.schema.options.timestamps).toBe(true);
  });
});
