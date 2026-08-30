// Unit tests for backend/sia/financialQueryService.js -- the sole
// allowlisted read layer SIA controllers may use for a direct financial
// lookup/breakdown question. No real MongoDB connection: ExpenseModel/
// IncomeModel/BudgetModel are replaced (jest.doMock on ../config/Schemas)
// with a small, GENUINE (not canned) in-memory aggregation engine that
// interprets the exact $match/$group/$sort/$limit stages this service
// builds -- so these tests exercise the service's real filter/grouping
// logic, not a pre-scripted mock response.
"use strict";

const mongoose = require("mongoose");

const SCHEMAS_PATH = "../config/Schemas";
const SERVICE_PATH = "../sia/financialQueryService";

function isOperatorObject(cond) {
  if (cond === null || typeof cond !== "object" || cond instanceof RegExp) return false;
  if (typeof cond.equals === "function") return false; // ObjectId and similar
  const keys = Object.keys(cond);
  return keys.length > 0 && keys.every((k) => k.startsWith("$"));
}

function matchOne(doc, cond) {
  if (cond instanceof RegExp) return cond.test(doc);
  if (isOperatorObject(cond)) {
    return Object.entries(cond).every(([op, opVal]) => {
      if (op === "$gte") return doc >= opVal;
      if (op === "$lt") return doc < opVal;
      if (op === "$lte") return doc <= opVal;
      if (op === "$gt") return doc > opVal;
      throw new Error(`unsupported operator ${op}`);
    });
  }
  if (doc && typeof doc.equals === "function") return doc.equals(cond);
  if (cond && typeof cond.equals === "function") return cond.equals(doc);
  return String(doc) === String(cond);
}

function runMatch(docs, matchStage) {
  return docs.filter((doc) => Object.entries(matchStage).every(([key, cond]) => matchOne(doc[key], cond)));
}

function runGroup(docs, groupStage) {
  const idExpr = groupStage._id;
  const groups = new Map();
  for (const doc of docs) {
    const key = idExpr === null ? "__null__" : typeof idExpr === "string" && idExpr.startsWith("$") ? doc[idExpr.slice(1)] : idExpr;
    if (!groups.has(key)) groups.set(key, { _id: idExpr === null ? null : key, __docs: [] });
    groups.get(key).__docs.push(doc);
  }
  const results = [];
  for (const group of groups.values()) {
    const out = { _id: group._id };
    for (const [field, expr] of Object.entries(groupStage)) {
      if (field === "_id") continue;
      const [op, arg] = Object.entries(expr)[0];
      if (op === "$sum") {
        if (arg === 1) out[field] = group.__docs.length;
        else if (typeof arg === "string" && arg.startsWith("$")) {
          out[field] = group.__docs.reduce((sum, d) => sum + (Number(d[arg.slice(1)]) || 0), 0);
        }
      }
    }
    results.push(out);
  }
  return results;
}

function runAggregatePipeline(docs, pipeline) {
  let current = docs.slice();
  for (const stage of pipeline) {
    if (stage.$match) current = runMatch(current, stage.$match);
    else if (stage.$group) current = runGroup(current, stage.$group);
    else if (stage.$sort) {
      const [[field, dir]] = Object.entries(stage.$sort);
      current = current.slice().sort((a, b) => (dir === -1 ? b[field] - a[field] : a[field] - b[field]));
    } else if (stage.$limit) current = current.slice(0, stage.$limit);
    else throw new Error(`unsupported stage ${JSON.stringify(Object.keys(stage))}`);
  }
  return current;
}

function loadServiceWithFixtures({ expenses = [], incomes = [], budgets = [] } = {}) {
  jest.resetModules();
  jest.doMock(SCHEMAS_PATH, () => ({
    ExpenseModel: { aggregate: jest.fn((pipeline) => Promise.resolve(runAggregatePipeline(expenses, pipeline))) },
    IncomeModel: { aggregate: jest.fn((pipeline) => Promise.resolve(runAggregatePipeline(incomes, pipeline))) },
    BudgetModel: {
      findOne: jest.fn((filter) => ({
        lean: async () =>
          budgets.find((b) => String(b.userId) === String(filter.userId) && b.month === filter.month) || null,
      })),
    },
  }));
  return require(SERVICE_PATH);
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

const userA = new mongoose.Types.ObjectId().toString();
const userB = new mongoose.Types.ObjectId().toString();

function expense(userId, category, amount, isoDate) {
  return { userId: new mongoose.Types.ObjectId(userId), expenseCategory: category, expenseAmount: amount, expenseDate: new Date(isoDate) };
}
function income(userId, amount, isoDate) {
  return { userId: new mongoose.Types.ObjectId(userId), incomeAmount: amount, incomeDate: new Date(isoDate) };
}

const AUG_2026 = { start: new Date("2026-07-31T18:30:00.000Z"), end: new Date("2026-08-31T18:30:00.000Z") };

describe("backend/sia/financialQueryService", () => {
  describe("user isolation", () => {
    it("never lets user A's aggregate include user B's expenses", async () => {
      const service = loadServiceWithFixtures({
        expenses: [
          expense(userA, "Groceries", 100, "2026-08-05T00:00:00.000Z"),
          expense(userB, "Groceries", 99999, "2026-08-05T00:00:00.000Z"),
        ],
      });
      const result = await service.getExpenseTotal(userA, AUG_2026);
      expect(result.hasData).toBe(true);
      expect(result.value).toBe(100);
    });

    it("returns each user's own independent total for the same period", async () => {
      const service = loadServiceWithFixtures({
        expenses: [
          expense(userA, "Groceries", 100, "2026-08-05T00:00:00.000Z"),
          expense(userB, "Travel", 500, "2026-08-06T00:00:00.000Z"),
        ],
      });
      const resultA = await service.getExpenseTotal(userA, AUG_2026);
      const resultB = await service.getExpenseTotal(userB, AUG_2026);
      expect(resultA.value).toBe(100);
      expect(resultB.value).toBe(500);
    });

    it("rejects an invalid/malformed userId rather than querying with it", async () => {
      const service = loadServiceWithFixtures({ expenses: [expense(userA, "Groceries", 100, "2026-08-05T00:00:00.000Z")] });
      const result = await service.getExpenseTotal("not-an-object-id", AUG_2026);
      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("INVALID_USER_ID");
    });
  });

  describe("date boundary correctness (start-inclusive / end-exclusive)", () => {
    it("includes an expense exactly at the period start", async () => {
      const service = loadServiceWithFixtures({
        expenses: [expense(userA, "Groceries", 50, AUG_2026.start.toISOString())],
      });
      const result = await service.getExpenseTotal(userA, AUG_2026);
      expect(result.value).toBe(50);
    });

    it("excludes an expense exactly at the period end (end-exclusive)", async () => {
      const service = loadServiceWithFixtures({
        expenses: [expense(userA, "Groceries", 50, AUG_2026.end.toISOString())],
      });
      const result = await service.getExpenseTotal(userA, AUG_2026);
      expect(result.value).toBe(0);
    });

    it("excludes an expense one millisecond before the period start", async () => {
      const justBefore = new Date(AUG_2026.start.getTime() - 1);
      const service = loadServiceWithFixtures({
        expenses: [expense(userA, "Groceries", 50, justBefore.toISOString())],
      });
      const result = await service.getExpenseTotal(userA, AUG_2026);
      expect(result.value).toBe(0);
    });
  });

  describe("zero vs no-data semantics", () => {
    it("reports a genuine zero total for a period with no expenses (hasData: true, value: 0)", async () => {
      const service = loadServiceWithFixtures({ expenses: [] });
      const result = await service.getExpenseTotal(userA, AUG_2026);
      expect(result.hasData).toBe(true);
      expect(result.value).toBe(0);
      expect(result.count).toBe(0);
    });

    it("reports hasData:false with NO_BUDGET_CONFIGURED when no budget document exists -- never a coerced zero", async () => {
      const service = loadServiceWithFixtures({ budgets: [] });
      const result = await service.getBudgetSnapshot(userA, { year: 2026, month: 8 });
      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("NO_BUDGET_CONFIGURED");
    });

    it("reports a real configured budget distinctly from the no-budget case", async () => {
      const service = loadServiceWithFixtures({
        budgets: [{ userId: userA, month: "Aug 2026", budget: 10000, spent: 2500 }],
      });
      const result = await service.getBudgetSnapshot(userA, { year: 2026, month: 8 });
      expect(result.hasData).toBe(true);
      expect(result.budget).toBe(10000);
      expect(result.spent).toBe(2500);
      expect(result.remaining).toBe(7500);
      expect(result.isOverspent).toBe(false);
    });
  });

  describe("category grouping and filter", () => {
    it("groups by category using a plain string, never a field path", async () => {
      const service = loadServiceWithFixtures({
        expenses: [
          expense(userA, "Groceries", 100, "2026-08-05T00:00:00.000Z"),
          expense(userA, "Travel", 300, "2026-08-06T00:00:00.000Z"),
          expense(userA, "Groceries", 50, "2026-08-07T00:00:00.000Z"),
        ],
      });
      const result = await service.getCategoryBreakdown(userA, AUG_2026);
      expect(result.hasData).toBe(true);
      const groceries = result.categories.find((c) => c.category === "Groceries");
      expect(groceries.total).toBe(150);
      expect(result.categories[0].total).toBeGreaterThanOrEqual(result.categories[1].total);
    });

    it("matches an exact category name case-insensitively via getCategoryTotal", async () => {
      const service = loadServiceWithFixtures({
        expenses: [expense(userA, "Groceries", 75, "2026-08-05T00:00:00.000Z")],
      });
      const result = await service.getCategoryTotal(userA, AUG_2026, "groceries");
      expect(result.hasData).toBe(true);
      expect(result.value).toBe(75);
    });

    it("rejects a category filter that is not a valid plain string (path/operator-shaped)", async () => {
      const service = loadServiceWithFixtures({ expenses: [] });
      const result = await service.getCategoryTotal(userA, AUG_2026, "$where");
      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("INVALID_CATEGORY_FILTER");
    });

    it("treats regex-special characters in a category name as LITERAL text, not a pattern", async () => {
      const service = loadServiceWithFixtures({
        expenses: [expense(userA, "Food (Dining)", 40, "2026-08-05T00:00:00.000Z")],
      });
      const result = await service.getCategoryTotal(userA, AUG_2026, "Food (Dining)");
      expect(result.hasData).toBe(true);
      expect(result.value).toBe(40);
    });

    it("bounds category breakdown results to the documented cap", async () => {
      const manyCategories = Array.from({ length: 30 }, (_, i) =>
        expense(userA, `Category ${i}`, i + 1, "2026-08-05T00:00:00.000Z")
      );
      const service = loadServiceWithFixtures({ expenses: manyCategories });
      const result = await service.getCategoryBreakdown(userA, AUG_2026);
      expect(result.categories.length).toBeLessThanOrEqual(service.MAX_CATEGORY_RESULTS);
    });
  });

  describe("income and net cash flow", () => {
    it("computes NET_CASH_FLOW as income total minus expense total for the same period", async () => {
      const service = loadServiceWithFixtures({
        expenses: [expense(userA, "Groceries", 400, "2026-08-05T00:00:00.000Z")],
        incomes: [income(userA, 1000, "2026-08-01T00:00:00.000Z")],
      });
      const result = await service.getNetCashFlow(userA, AUG_2026);
      expect(result.hasData).toBe(true);
      expect(result.value).toBe(600);
      expect(result.incomeTotal).toBe(1000);
      expect(result.expenseTotal).toBe(400);
    });

    it("never uses the word 'savings' in any returned field/reason -- NET_CASH_FLOW only", async () => {
      const service = loadServiceWithFixtures({});
      const result = await service.getNetCashFlow(userA, AUG_2026);
      const serialized = JSON.stringify(result).toLowerCase();
      expect(serialized).not.toContain("saving");
    });
  });

  describe("history cap", () => {
    it("rejects a period spanning more than 366 days", async () => {
      const service = loadServiceWithFixtures({});
      const tooLong = { start: new Date("2020-01-01T00:00:00.000Z"), end: new Date("2026-01-01T00:00:00.000Z") };
      const result = await service.getExpenseTotal(userA, tooLong);
      expect(result.hasData).toBe(false);
      expect(result.reasonCode).toBe("PERIOD_EXCEEDS_HISTORY_CAP");
    });
  });
});
