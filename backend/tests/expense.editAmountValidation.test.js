// Remediation Workstream A -- expense-edit amount integrity.
//
// Root cause: PUT /update-expense (Routes/expense.routes.js) never applied
// expenseValidation (or any equivalent) to the edit route, and
// editExpense.js itself performed no check on `expenseAmount` before
// persisting it -- an edit could set 0, a negative number, NaN, Infinity,
// or any other raw req.body value directly into Mongo.
//
// Unit-level tests against the controller directly (jest.doMock on its
// three seams: config/Schemas, Services/syncRecoveryService,
// utils/expenseCache), proving the full required contract: valid values
// succeed, every invalid class is rejected before any side effect, and a
// valid edit still performs the existing synchronization path unchanged.
"use strict";

const mongoose = require("mongoose");

const SCHEMAS_PATH = "../config/Schemas";
const SYNC_RECOVERY_SERVICE_PATH = "../Services/syncRecoveryService";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const RECURRING_MODEL_PATH = "../models/RecurringExpense";
const EDIT_EXPENSE_PATH = "../Controllers/ExpenseControllers/editExpense";

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";
const EXPENSE_ID = new mongoose.Types.ObjectId().toString();

const SYNCHRONIZED_RESULT = {
  status: "synchronized",
  budget: "synchronized",
  report: "synchronized",
  recoveryPending: false,
};

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function loadEditExpense({ originalExpense, updateResult } = {}) {
  jest.resetModules();

  const findOneMock = jest.fn(async () => originalExpense);
  const findOneAndUpdateMock = jest.fn(async () => updateResult);

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: jest.fn(async (id) => ({ _id: id })) },
    ExpenseModel: {
      findOne: findOneMock,
      findOneAndUpdate: findOneAndUpdateMock,
    },
  }));

  const synchronizeAfterMutationMock = jest.fn(async () => SYNCHRONIZED_RESULT);
  const reserveMock = jest.fn(async () => ({
    userWideReservation: { token: "userwide-token-1" },
    reportReservation: { token: "report-token-1" },
  }));
  const abandonMock = jest.fn(async () => null);
  jest.doMock(SYNC_RECOVERY_SERVICE_PATH, () => ({
    synchronizeAfterMutation: synchronizeAfterMutationMock,
    reserve: reserveMock,
    abandon: abandonMock,
  }));

  const clearUserExpenseCacheMock = jest.fn(async () => {});
  jest.doMock(EXPENSE_CACHE_PATH, () => ({
    clearUserExpenseCache: clearUserExpenseCacheMock,
  }));

  // Recurring-state authority remediation -- editExpense.js now calls
  // annotateRecurringState, which queries RecurringExpenseModel. No
  // recurring definitions exist in this file's scenarios.
  jest.doMock(RECURRING_MODEL_PATH, () => ({
    RecurringExpenseModel: { find: () => ({ lean: async () => [] }) },
  }));

  const { editexpense } = require(EDIT_EXPENSE_PATH);
  return {
    editexpense,
    findOneMock,
    findOneAndUpdateMock,
    synchronizeAfterMutationMock,
    reserveMock,
    abandonMock,
    clearUserExpenseCacheMock,
  };
}

const originalDoc = () => ({
  _id: EXPENSE_ID,
  userId: USER_ID,
  expenseName: "Coffee",
  expenseCategory: "Food",
  expenseAmount: 5,
  expenseDate: new Date("2026-01-10T00:00:00.000Z"),
  toObject() {
    return { ...this };
  },
});

async function runEdit(amount, harness) {
  const req = {
    userId: USER_ID,
    query: { editID: EXPENSE_ID },
    body: { expenseAmount: amount },
  };
  const res = mockRes();
  await harness.editexpense(req, res);
  return res;
}

describe("Remediation Workstream A: PUT /update-expense amount validation", () => {
  const invalidCases = [
    ["zero", 0],
    ["negative", -50],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
    ["null", null],
    ["empty string", ""],
    ["whitespace-only string", "   "],
    ["partially numeric string", "100abc"],
    ["comma-formatted string", "12,000"],
    ["boolean true", true],
    ["boolean false", false],
    ["array", [100]],
    ["object", { amount: 100 }],
  ];

  it.each(invalidCases)("1. rejects %s with a controlled 400 and no side effects", async (_label, value) => {
    const harness = loadEditExpense({ originalExpense: originalDoc() });

    const res = await runEdit(value, harness);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorCode: "INVALID_AMOUNT" })
    );
    // No ML call is possible from this controller at all (editExpense.js
    // never calls ML), but every database/cache/report side effect must
    // also be untouched.
    expect(harness.findOneAndUpdateMock).not.toHaveBeenCalled();
    expect(harness.reserveMock).not.toHaveBeenCalled();
    expect(harness.synchronizeAfterMutationMock).not.toHaveBeenCalled();
    expect(harness.clearUserExpenseCacheMock).not.toHaveBeenCalled();
  });

  it("2. accepts a valid positive finite number", async () => {
    const harness = loadEditExpense({
      originalExpense: originalDoc(),
      updateResult: originalDoc(),
    });

    const res = await runEdit(42.5, harness);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(harness.findOneAndUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ _id: EXPENSE_ID, userId: USER_ID }),
      { $set: expect.objectContaining({ expenseAmount: 42.5 }) },
      expect.anything()
    );
  });

  it("3. accepts a fully-numeric string and persists the normalized number (mirrors the add route's Joi contract)", async () => {
    const harness = loadEditExpense({
      originalExpense: originalDoc(),
      updateResult: originalDoc(),
    });

    const res = await runEdit("42.5", harness);

    expect(res.status).toHaveBeenCalledWith(200);
    const updateArg = harness.findOneAndUpdateMock.mock.calls[0][1];
    expect(updateArg.$set.expenseAmount).toBe(42.5);
    expect(typeof updateArg.$set.expenseAmount).toBe("number");
  });

  it("8. the update query remains user-scoped -- another user's expense cannot be edited", async () => {
    // originalExpense lookup is itself scoped to { _id, userId: req.userId }
    // -- a document owned by a different user is never found, so this
    // always resolves as a 404, never a cross-user mutation.
    const harness = loadEditExpense({ originalExpense: null });

    const req = {
      userId: OTHER_USER_ID,
      query: { editID: EXPENSE_ID },
      body: { expenseAmount: 100 },
    };
    const res = mockRes();
    await harness.editexpense(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(harness.findOneMock).toHaveBeenCalledWith(
      expect.objectContaining({ _id: EXPENSE_ID, userId: OTHER_USER_ID })
    );
  });

  it("10. category normalization remains intact when both category and amount are edited together", async () => {
    const harness = loadEditExpense({
      originalExpense: originalDoc(),
      updateResult: originalDoc(),
    });

    const req = {
      userId: USER_ID,
      query: { editID: EXPENSE_ID },
      body: { expenseAmount: 30, expenseCategory: "  medical  " },
    };
    const res = mockRes();
    await harness.editexpense(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updateArg = harness.findOneAndUpdateMock.mock.calls[0][1];
    expect(updateArg.$set.expenseAmount).toBe(30);
    expect(updateArg.$set.expenseCategory).toBe("Health");
  });

  it("11. a valid edit still performs the existing synchronization path (reserve -> write -> synchronizeAfterMutation)", async () => {
    const harness = loadEditExpense({
      originalExpense: originalDoc(),
      updateResult: originalDoc(),
    });

    await runEdit(99, harness);

    expect(harness.reserveMock).toHaveBeenCalledTimes(1);
    expect(harness.clearUserExpenseCacheMock).toHaveBeenCalledTimes(1);
    expect(harness.synchronizeAfterMutationMock).toHaveBeenCalledTimes(1);
  });

  it("12. does not leak internal validation/database details on rejection", async () => {
    const harness = loadEditExpense({ originalExpense: originalDoc() });

    const res = await runEdit("100abc", harness);

    const payload = res.json.mock.calls[0][0];
    expect(payload).toEqual({
      success: false,
      message: "Expense amount must be a valid, positive, finite number.",
      errorCode: "INVALID_AMOUNT",
    });
  });

  it("an edit that never touches expenseAmount is unaffected (amount validation is skipped entirely)", async () => {
    const harness = loadEditExpense({
      originalExpense: originalDoc(),
      updateResult: originalDoc(),
    });

    const req = {
      userId: USER_ID,
      query: { editID: EXPENSE_ID },
      body: { expenseName: "Renamed" },
    };
    const res = mockRes();
    await harness.editexpense(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const updateArg = harness.findOneAndUpdateMock.mock.calls[0][1];
    expect(updateArg.$set.expenseAmount).toBeUndefined();
  });
});
