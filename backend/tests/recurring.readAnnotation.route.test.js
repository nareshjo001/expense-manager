// Recurring-state authority remediation -- proves the authoritative
// isRecurring annotation actually reaches real HTTP responses on the
// endpoints ExpenseItem.js's data ultimately comes from (GET /expense/search
// -> getbycustom.js -> fetchExpenses.js) and on the single-expense edit-data
// endpoint (GET /expense/expense-edit-data -> geteditexpense.js), using a
// stateful fake ExpenseModel + RecurringExpenseModel rather than
// hand-scripted per-test responses.
"use strict";

const jwt = require("jsonwebtoken");
const request = require("supertest");

const SCHEMAS_PATH = "../config/Schemas";
const RECURRING_MODEL_PATH = "../models/RecurringExpense";
const EXPENSE_CACHE_PATH = "../utils/expenseCache";
const APP_PATH = "../app";

const TEST_JWT_SECRET = "recurring-read-annotation-route-test-secret";
let originalJwtSecret;

beforeAll(() => {
  originalJwtSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

afterAll(() => {
  if (originalJwtSecret === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = originalJwtSecret;
  }
});

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

function signToken(userId) {
  return jwt.sign({ email: "recurring-read-annotation-route-test@example.test", _id: userId }, TEST_JWT_SECRET);
}

const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const EXPENSE_ID = "64f1a2b3c4d5e6f7a8b9c0cc";

function loadApp({ expenses, recurringDefinitions }) {
  jest.resetModules();

  // ExpenseModel: only find()/findOne() are needed by the endpoints under
  // test here; findOne returns a document-shaped object with .toObject()
  // so geteditexpense.js's own `.toObject()` call behaves like a real
  // Mongoose document.
  const ExpenseModelMock = {
    find: (query) => ({
      lean: async () =>
        expenses
          .filter((e) => String(e.userId) === String(query.userId))
          .map((e) => ({ ...e })),
    }),
    findOne: async (query) => {
      const doc = expenses.find(
        (e) => String(e._id) === String(query._id) && String(e.userId) === String(query.userId)
      );
      if (!doc) return null;
      return { ...doc, toObject: () => ({ ...doc }) };
    },
  };

  const RecurringExpenseModelMock = {
    find: (filter) => ({
      lean: async () => {
        const ids = new Set((filter.expenseId.$in || []).map(String));
        return recurringDefinitions.filter(
          (d) => String(d.userId) === String(filter.userId) && ids.has(String(d.expenseId))
        );
      },
    }),
  };

  jest.doMock(SCHEMAS_PATH, () => ({
    UserModel: { findById: jest.fn(async (id) => ({ _id: id })) },
    ExpenseModel: ExpenseModelMock,
    MlFeedbackModel: {},
    BudgetModel: {},
    IncomeModel: {},
  }));

  jest.doMock(RECURRING_MODEL_PATH, () => ({ RecurringExpenseModel: RecurringExpenseModelMock }));

  jest.doMock(EXPENSE_CACHE_PATH, () => ({
    clearUserExpenseCache: jest.fn(async () => {}),
    setCache: jest.fn(async () => {}),
    getCache: jest.fn(async () => null),
  }));

  const app = require(APP_PATH);
  return { app };
}

const seedExpense = (overrides = {}) => ({
  _id: EXPENSE_ID,
  userId: USER_ID,
  expenseName: "Netflix",
  expenseCategory: "Entertainment",
  expenseAmount: 15.99,
  expenseDate: new Date("2026-01-05T00:00:00.000Z"),
  isRecurring: false, // stale mirror -- the definition below is authoritative
  ...overrides,
});

describe("Expense read endpoints expose authoritative isRecurring", () => {
  it("GET /expense/search (getbycustom.js -> fetchExpenses.js) overrides a stale false mirror with the authoritative true", async () => {
    const { app } = loadApp({
      expenses: [seedExpense({ isRecurring: false })],
      recurringDefinitions: [{ userId: USER_ID, expenseId: EXPENSE_ID }],
    });

    const res = await request(app)
      .get("/expense/search")
      .query({ startDate: "2026-01-01", endDate: "2026-01-31" })
      .set("Authorization", `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].isRecurring).toBe(true);
  });

  it("GET /expense/expense-edit-data (geteditexpense.js) overrides a stale true mirror with the authoritative false", async () => {
    const { app } = loadApp({
      expenses: [seedExpense({ isRecurring: true })],
      recurringDefinitions: [], // no definition exists -- mirror is stale
    });

    const res = await request(app)
      .get("/expense/expense-edit-data")
      .query({ expenseId: EXPENSE_ID })
      .set("Authorization", `Bearer ${signToken(USER_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isRecurring).toBe(false);
  });
});
