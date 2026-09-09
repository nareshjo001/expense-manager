// Recurring-state authority remediation -- proves the authoritative
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
  // EXP-003-T03 -- find() must now support the chained
  // .sort().limit().lean() form as well as a bare .lean(): GET
  // /expense/search no longer has an unbounded path, so it always goes
  // through the cursor-paginated query. A mock that only answered .lean()
  // made this endpoint return 500, which looked like a product regression
  // but was purely the mock being narrower than the driver it stands in for.
  const ExpenseModelMock = {
    find: (query) => {
      const matches = () =>
        expenses
          .filter((e) => String(e.userId) === String(query.userId))
          .filter((e) => {
            const range = query.expenseDate;
            if (!range) return true;
            const at = new Date(e.expenseDate).getTime();
            if (range.$gte && at < new Date(range.$gte).getTime()) return false;
            if (range.$lte && at > new Date(range.$lte).getTime()) return false;
            return true;
          })
          .map((e) => ({ ...e }));

      const chain = {
        _docs: null,
        sort() {
          // Mirrors the real (expenseDate DESC, _id DESC) keyset order.
          this._docs = (this._docs || matches()).sort((a, b) => {
            const diff = new Date(b.expenseDate) - new Date(a.expenseDate);
            return diff !== 0 ? diff : String(b._id).localeCompare(String(a._id));
          });
          return this;
        },
        limit(n) {
          this._docs = (this._docs || matches()).slice(0, n);
          return this;
        },
        lean: async function () {
          return this._docs || matches();
        },
      };
      return chain;
    },
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
