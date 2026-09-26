// BUD-001-T03 -- Services/BudgetServices/categoryBudget.service.js.
//
// The Mongoose models are replaced by a small in-memory fake supporting
// exactly the query shapes the service issues, so the reconciliation rules
// (I5 cap, I7 check, I8 compensation, I12 idempotency, I13 ownership, I14
// alert reset) are exercised against real, mutable state. The analyzer is
// mocked so this suite proves only what the service hands it.
"use strict";

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const SERVICE_PATH = "../Services/BudgetServices/categoryBudget.service";
const ANALYZER_PATH = "../analytics/analyzers/categoryBudgetAnalyzer";
const USER_ID = "64f1a2b3c4d5e6f7a8b9c0aa";
const OTHER_USER_ID = "64f1a2b3c4d5e6f7a8b9c0bb";
// Mid-September 2026, server-local: writable window is 2026-09..2027-08.
const NOW = new Date(2026, 8, 15, 12, 0, 0);

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => String(doc[key]) === String(value));
}

function makeCategoryBudgetModel(seed = []) {
  const docs = seed.map((d) => ({ lastAlertLevel: 0, ...d }));
  const hooks = { afterUpsert: null };
  const copy = (d) => (d ? { ...d } : d);
  const leanable = (fn) => ({ lean: jest.fn(fn) });

  const model = {
    docs,
    hooks,
    find: jest.fn((filter) => leanable(async () => docs.filter((d) => matches(d, filter)).map(copy))),
    findOne: jest.fn((filter) => leanable(async () => copy(docs.find((d) => matches(d, filter)) || null))),
    findOneAndUpdate: jest.fn((filter, update, options) =>
      leanable(async () => {
        expect(options).toMatchObject({ upsert: true, returnDocument: "before" });
        let doc = docs.find((d) => matches(d, filter));
        const before = copy(doc) || null;
        if (!doc) {
          doc = { _id: new mongoose.Types.ObjectId(), ...filter, lastAlertLevel: 0 };
          docs.push(doc);
        }
        Object.assign(doc, update.$set);
        if (hooks.afterUpsert) await hooks.afterUpsert(docs);
        return before;
      })
    ),
    updateOne: jest.fn(async (filter, update) => {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      Object.assign(doc, update.$set);
      return { matchedCount: 1, modifiedCount: 1 };
    }),
    deleteOne: jest.fn(async (filter) => {
      const idx = docs.findIndex((d) => matches(d, filter));
      if (idx === -1) return { deletedCount: 0 };
      docs.splice(idx, 1);
      return { deletedCount: 1 };
    }),
    findOneAndDelete: jest.fn((filter) =>
      leanable(async () => {
        const idx = docs.findIndex((d) => matches(d, filter));
        if (idx === -1) return null;
        return docs.splice(idx, 1)[0];
      })
    ),
  };
  return model;
}

function allocation(category, amountMinor, overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(USER_ID),
    month: "2026-09",
    category,
    amount: amountMinor / 100,
    amountMinor,
    lastAlertLevel: 0,
    ...overrides,
  };
}

// Module graph loaded ONCE (mongoose and the contract's dependencies are
// slow to re-require per test); each test swaps fresh fakes into these
// shared objects, which the service holds by reference.
const shared = {
  CategoryBudgetModel: {},
  BudgetModel: {},
  ExpenseModel: {},
  analyzeCategoryBudgets: jest.fn(),
  logEvent: jest.fn(),
};
let service;
let getMonthKey;

beforeAll(() => {
  jest.resetModules();
  jest.doMock("../models/CategoryBudget", () => ({
    CategoryBudgetModel: shared.CategoryBudgetModel,
    MONTH_PATTERN: /^\d{4}-(0[1-9]|1[0-2])$/,
  }));
  jest.doMock("../config/Schemas", () => ({
    BudgetModel: shared.BudgetModel,
    ExpenseModel: shared.ExpenseModel,
  }));
  const analyzerExists = fs.existsSync(path.join(__dirname, `${ANALYZER_PATH}.js`));
  jest.doMock(
    ANALYZER_PATH,
    () => ({ analyzeCategoryBudgets: (...args) => shared.analyzeCategoryBudgets(...args) }),
    { virtual: !analyzerExists }
  );
  jest.doMock("../utils/logger", () => ({ logEvent: (...args) => shared.logEvent(...args) }));

  service = require(SERVICE_PATH);
  ({ getMonthKey } = require("../Services/BudgetServices/budget.service"));
});

function load({ allocations = [], totalBudgetDoc = null, expenseGroups = [] } = {}) {
  const CategoryBudgetModel = shared.CategoryBudgetModel;
  for (const key of Object.keys(CategoryBudgetModel)) delete CategoryBudgetModel[key];
  Object.assign(CategoryBudgetModel, makeCategoryBudgetModel(allocations));

  const BudgetModel = shared.BudgetModel;
  BudgetModel.findOne = jest.fn(() => ({ lean: jest.fn(async () => totalBudgetDoc) }));
  const ExpenseModel = shared.ExpenseModel;
  ExpenseModel.aggregate = jest.fn(async () => expenseGroups);

  shared.analyzeCategoryBudgets = jest.fn((input) => ({ analyzed: true, month: input.month }));
  shared.logEvent = jest.fn();

  return {
    service,
    CategoryBudgetModel,
    BudgetModel,
    ExpenseModel,
    analyzeCategoryBudgets: shared.analyzeCategoryBudgets,
    logEvent: shared.logEvent,
    getMonthKey,
  };
}

const opts = { now: NOW };
const upsertInput = (overrides = {}) => ({ month: "2026-09", category: "Food", amount: 500, ...overrides });

afterAll(() => {
  jest.resetModules();
});

describe("upsertCategoryBudget -- validation", () => {
  test.each([
    [{ month: "2026-13" }, "INVALID_MONTH", "month"],
    [{ month: "Sep 2026" }, "INVALID_MONTH", "month"],
    [{ month: undefined }, "INVALID_MONTH", "month"],
    [{ month: "2026-08" }, "MONTH_NOT_WRITABLE", "month"],
    [{ month: "2027-09" }, "MONTH_NOT_WRITABLE", "month"],
    [{ category: "" }, "INVALID_CATEGORY", "category"],
    [{ category: "x".repeat(51) }, "INVALID_CATEGORY", "category"],
    [{ category: "uncategorized" }, "RESERVED_CATEGORY", "category"],
    [{ amount: "abc" }, "INVALID_AMOUNT", "amount"],
    [{ amount: -5 }, "INVALID_AMOUNT", "amount"],
    [{ amount: "12.345" }, "INVALID_AMOUNT", "amount"],
    [{ amount: 0 }, "AMOUNT_OUT_OF_RANGE", "amount"],
    [{ amount: 1000000001 }, "AMOUNT_OUT_OF_RANGE", "amount"],
  ])("%j -> %s", async (override, reason, field) => {
    const { service, CategoryBudgetModel } = load();
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput(override), opts);
    expect(result).toEqual({ ok: false, reason, field });
    expect(CategoryBudgetModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("the last writable month (11 ahead) is accepted", async () => {
    const { service } = load();
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ month: "2027-08" }), opts);
    expect(result.ok).toBe(true);
  });
});

describe("upsertCategoryBudget -- create/update", () => {
  test("creates a normalized allocation keyed on (userId, month, category)", async () => {
    const { service, CategoryBudgetModel } = load();
    const result = await service.upsertCategoryBudget(
      USER_ID,
      upsertInput({ category: "  food ", amount: "1,250.50" }),
      opts
    );

    expect(result.ok).toBe(true);
    expect(result.budget).toMatchObject({
      month: "2026-09",
      category: "Food",
      amount: 1250.5,
      amountMinor: 125050,
      created: true,
    });
    expect(result.budget.id).toMatch(/^[a-f0-9]{24}$/);

    const [filter, update] = CategoryBudgetModel.findOneAndUpdate.mock.calls[0];
    // Cast from the string id (the service's mongoose instance differs from
    // this file's, so compare by constructor name rather than instanceof).
    expect(filter.userId.constructor.name).toBe("ObjectId");
    expect(String(filter.userId)).toBe(USER_ID);
    expect(filter).toMatchObject({ month: "2026-09", category: "Food" });
    expect(update.$set).toEqual({ amount: 1250.5, amountMinor: 125050, lastAlertLevel: 0 });
    expect(CategoryBudgetModel.docs).toHaveLength(1);
  });

  test("a client-supplied userId in the input is ignored", async () => {
    const { service, CategoryBudgetModel } = load();
    await service.upsertCategoryBudget(USER_ID, { ...upsertInput(), userId: OTHER_USER_ID }, opts);
    expect(String(CategoryBudgetModel.docs[0].userId)).toBe(USER_ID);
  });

  test("changing the amount updates in place and resets lastAlertLevel (I14)", async () => {
    const existing = allocation("Food", 50000, { lastAlertLevel: 2 });
    const { service, CategoryBudgetModel } = load({ allocations: [existing] });

    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 800 }), opts);

    expect(result.ok).toBe(true);
    expect(result.budget).toMatchObject({ id: String(existing._id), amountMinor: 80000, created: false });
    expect(CategoryBudgetModel.docs).toHaveLength(1);
    expect(CategoryBudgetModel.docs[0]).toMatchObject({ amountMinor: 80000, lastAlertLevel: 0 });
  });

  test("replaying the same request converges on the same state and keeps lastAlertLevel (I12)", async () => {
    const { service, CategoryBudgetModel } = load();

    const first = await service.upsertCategoryBudget(USER_ID, upsertInput(), opts);
    CategoryBudgetModel.docs[0].lastAlertLevel = 1; // alert fired in between
    const second = await service.upsertCategoryBudget(USER_ID, upsertInput(), opts);

    expect(first.budget.created).toBe(true);
    expect(second.budget.created).toBe(false);
    expect(second.budget.id).toBe(first.budget.id);
    expect(CategoryBudgetModel.docs).toHaveLength(1);
    expect(CategoryBudgetModel.docs[0]).toMatchObject({ amountMinor: 50000, lastAlertLevel: 1 });
    expect(CategoryBudgetModel.findOneAndUpdate.mock.calls[1][1].$set).not.toHaveProperty("lastAlertLevel");
  });

  test("a stale pre-read still resets lastAlertLevel when the amount really changed", async () => {
    const existing = allocation("Food", 50000, { lastAlertLevel: 2 });
    const { service, CategoryBudgetModel } = load({ allocations: [existing] });
    // A concurrent writer changes the amount between our read and our upsert.
    const originalFind = CategoryBudgetModel.find.getMockImplementation();
    CategoryBudgetModel.find.mockImplementationOnce((filter) => {
      const query = originalFind(filter);
      return {
        lean: async () => {
          const rows = await query.lean();
          CategoryBudgetModel.docs[0].amountMinor = 70000;
          CategoryBudgetModel.docs[0].amount = 700;
          return rows;
        },
      };
    });

    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 500 }), opts);

    expect(result.ok).toBe(true);
    expect(CategoryBudgetModel.docs[0]).toMatchObject({ amountMinor: 50000, lastAlertLevel: 0 });
  });

  test("a duplicate-key race on create retries once and converges on an update", async () => {
    const { service, CategoryBudgetModel } = load();
    const originalImpl = CategoryBudgetModel.findOneAndUpdate.getMockImplementation();
    CategoryBudgetModel.findOneAndUpdate.mockImplementationOnce(() => ({
      lean: async () => {
        CategoryBudgetModel.docs.push(allocation("Food", 30000));
        const err = new Error("E11000 duplicate key");
        err.code = 11000;
        throw err;
      },
    }));
    CategoryBudgetModel.findOneAndUpdate.mockImplementation(originalImpl);

    const result = await service.upsertCategoryBudget(USER_ID, upsertInput(), opts);

    expect(result.ok).toBe(true);
    expect(result.budget.created).toBe(false);
    expect(CategoryBudgetModel.docs).toHaveLength(1);
    expect(CategoryBudgetModel.docs[0].amountMinor).toBe(50000);
  });

  test("unexpected datastore errors are thrown, not mapped to a reason", async () => {
    const { service, CategoryBudgetModel } = load();
    CategoryBudgetModel.findOneAndUpdate.mockImplementationOnce(() => ({
      lean: async () => { throw new Error("connection lost"); },
    }));
    await expect(service.upsertCategoryBudget(USER_ID, upsertInput(), opts)).rejects.toThrow("connection lost");
  });
});

describe("upsertCategoryBudget -- 25-allocation cap (I5)", () => {
  const twentyFive = () => Array.from({ length: 25 }, (_, i) => allocation(`Cat ${i}`, 100));

  test("a 26th category is rejected", async () => {
    const { service, CategoryBudgetModel } = load({ allocations: twentyFive() });
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ category: "New" }), opts);
    expect(result).toEqual({ ok: false, reason: "TOO_MANY_CATEGORY_BUDGETS", field: "category" });
    expect(CategoryBudgetModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("updating one of the existing 25 is not counted against the cap", async () => {
    const { service } = load({ allocations: twentyFive() });
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ category: "Cat 3", amount: 9 }), opts);
    expect(result.ok).toBe(true);
    expect(result.budget.created).toBe(false);
  });

  test("the cap is per month -- another month's allocations do not count", async () => {
    const { service } = load({ allocations: twentyFive() });
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ month: "2026-10", category: "New" }), opts);
    expect(result.ok).toBe(true);
  });
});

describe("upsertCategoryBudget -- total-budget reconciliation (I7)", () => {
  const total = { budget: 1000, budgetMinor: 100000 };

  test("looks the total up under the legacy MMM YYYY key", async () => {
    const { service, BudgetModel, getMonthKey } = load({ totalBudgetDoc: total });
    await service.upsertCategoryBudget(USER_ID, upsertInput(), opts);
    const filter = BudgetModel.findOne.mock.calls[0][0];
    expect(filter.month).toBe(getMonthKey(new Date(2026, 8, 1)));
    expect(String(filter.userId)).toBe(USER_ID);
  });

  test("rejects a create that would push the allocated sum over the total", async () => {
    const { service, CategoryBudgetModel } = load({
      totalBudgetDoc: total,
      allocations: [allocation("Rent", 60000)],
    });
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 400.01 }), opts);
    expect(result).toEqual({ ok: false, reason: "CATEGORY_BUDGET_EXCEEDS_TOTAL", field: "amount" });
    expect(CategoryBudgetModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test("allows allocating exactly the total", async () => {
    const { service } = load({ totalBudgetDoc: total, allocations: [allocation("Rent", 60000)] });
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 400 }), opts);
    expect(result.ok).toBe(true);
  });

  test("an update is checked against the other categories only", async () => {
    const { service } = load({
      totalBudgetDoc: total,
      allocations: [allocation("Rent", 60000), allocation("Food", 40000)],
    });
    const over = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 401 }), opts);
    expect(over.reason).toBe("CATEGORY_BUDGET_EXCEEDS_TOTAL");
  });

  test("falls back to the rupee budget when budgetMinor is absent", async () => {
    const { service } = load({ totalBudgetDoc: { budget: 300 } });
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 300.01 }), opts);
    expect(result.reason).toBe("CATEGORY_BUDGET_EXCEEDS_TOTAL");
  });

  test.each([
    ["no total budget document", null],
    ["a zero total budget", { budget: 0, budgetMinor: 0 }],
  ])("%s means no ceiling", async (_label, doc) => {
    const { service } = load({ totalBudgetDoc: doc, allocations: [allocation("Rent", 9000000)] });
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 999999 }), opts);
    expect(result.ok).toBe(true);
  });

  test("reducing an allocation is allowed even when the month is already over-allocated", async () => {
    // Total lowered after allocations were made (never blocked, per I7).
    const { service, CategoryBudgetModel } = load({
      totalBudgetDoc: total,
      allocations: [allocation("Rent", 70000), allocation("Food", 60000)],
    });
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 500 }), opts);
    expect(result.ok).toBe(true);
    expect(CategoryBudgetModel.docs.find((d) => d.category === "Food").amountMinor).toBe(50000);
  });
});

describe("upsertCategoryBudget -- concurrent-write compensation (I8)", () => {
  const total = { budget: 1000, budgetMinor: 100000 };

  test("a create that loses a race is deleted and rejected; the concurrent write survives", async () => {
    const { service, CategoryBudgetModel } = load({ totalBudgetDoc: total });
    CategoryBudgetModel.hooks.afterUpsert = async (docs) => {
      docs.push(allocation("Rent", 60000)); // passed its own check concurrently
    };

    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 500 }), opts);

    expect(result).toEqual({ ok: false, reason: "CATEGORY_BUDGET_EXCEEDS_TOTAL", field: "amount" });
    expect(CategoryBudgetModel.docs.map((d) => d.category)).toEqual(["Rent"]);
  });

  test("an update that loses a race is restored to its previous amount and alert level", async () => {
    const { service, CategoryBudgetModel } = load({
      totalBudgetDoc: total,
      allocations: [allocation("Food", 30000, { lastAlertLevel: 1 })],
    });
    CategoryBudgetModel.hooks.afterUpsert = async (docs) => {
      docs.push(allocation("Rent", 40000));
    };

    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 700 }), opts);

    expect(result.reason).toBe("CATEGORY_BUDGET_EXCEEDS_TOTAL");
    expect(CategoryBudgetModel.docs.find((d) => d.category === "Food")).toMatchObject({
      amount: 300,
      amountMinor: 30000,
      lastAlertLevel: 1,
    });
  });

  test("compensation never clobbers a newer write to the same allocation", async () => {
    const { service, CategoryBudgetModel } = load({ totalBudgetDoc: total });
    CategoryBudgetModel.hooks.afterUpsert = async (docs) => {
      docs.push(allocation("Rent", 60000));
      docs.find((d) => d.category === "Food").amountMinor = 45000; // newer write
    };

    const result = await service.upsertCategoryBudget(USER_ID, upsertInput({ amount: 500 }), opts);

    expect(result.reason).toBe("CATEGORY_BUDGET_EXCEEDS_TOTAL");
    expect(CategoryBudgetModel.docs.find((d) => d.category === "Food").amountMinor).toBe(45000);
  });

  test("no compensation when no total budget exists", async () => {
    const { service, CategoryBudgetModel } = load();
    CategoryBudgetModel.hooks.afterUpsert = async (docs) => { docs.push(allocation("Rent", 9000000)); };
    const result = await service.upsertCategoryBudget(USER_ID, upsertInput(), opts);
    expect(result.ok).toBe(true);
    expect(CategoryBudgetModel.docs).toHaveLength(2);
  });
});

describe("deleteCategoryBudget", () => {
  test("rejects a malformed id without querying", async () => {
    const { service, CategoryBudgetModel } = load();
    const result = await service.deleteCategoryBudget(USER_ID, "not-an-id", opts);
    expect(result).toEqual({ ok: false, reason: "INVALID_ID", field: "id" });
    expect(CategoryBudgetModel.findOne).not.toHaveBeenCalled();
  });

  test("deletes the caller's allocation and returns its id and month", async () => {
    const doc = allocation("Food", 50000);
    const { service, CategoryBudgetModel } = load({ allocations: [doc] });

    const result = await service.deleteCategoryBudget(USER_ID, String(doc._id), opts);

    expect(result).toEqual({ ok: true, deletedId: String(doc._id), month: "2026-09" });
    expect(CategoryBudgetModel.docs).toHaveLength(0);
    const filter = CategoryBudgetModel.findOneAndDelete.mock.calls[0][0];
    expect(String(filter.userId)).toBe(USER_ID);
  });

  test("a replayed delete returns CATEGORY_BUDGET_NOT_FOUND (I12)", async () => {
    const doc = allocation("Food", 50000);
    const { service } = load({ allocations: [doc] });
    await service.deleteCategoryBudget(USER_ID, String(doc._id), opts);
    const replay = await service.deleteCategoryBudget(USER_ID, String(doc._id), opts);
    expect(replay).toEqual({ ok: false, reason: "CATEGORY_BUDGET_NOT_FOUND", field: "id" });
  });

  test("another user's allocation is indistinguishable from a missing one and untouched (I13)", async () => {
    const theirs = allocation("Food", 50000, { userId: new mongoose.Types.ObjectId(OTHER_USER_ID) });
    const { service, CategoryBudgetModel } = load({ allocations: [theirs] });

    const result = await service.deleteCategoryBudget(USER_ID, String(theirs._id), opts);
    const missing = await service.deleteCategoryBudget(USER_ID, String(new mongoose.Types.ObjectId()), opts);

    expect(result).toEqual(missing);
    expect(result.reason).toBe("CATEGORY_BUDGET_NOT_FOUND");
    expect(CategoryBudgetModel.docs).toHaveLength(1);
    expect(CategoryBudgetModel.findOneAndDelete).not.toHaveBeenCalled();
  });

  test("a past month's allocation is read-only (I6)", async () => {
    const doc = allocation("Food", 50000, { month: "2026-08" });
    const { service, CategoryBudgetModel } = load({ allocations: [doc] });
    const result = await service.deleteCategoryBudget(USER_ID, String(doc._id), opts);
    expect(result).toEqual({ ok: false, reason: "MONTH_NOT_WRITABLE", field: "id" });
    expect(CategoryBudgetModel.docs).toHaveLength(1);
  });

  test("a delete that races another delete returns NOT_FOUND", async () => {
    const doc = allocation("Food", 50000);
    const { service, CategoryBudgetModel } = load({ allocations: [doc] });
    CategoryBudgetModel.findOneAndDelete.mockImplementationOnce(() => ({ lean: async () => null }));
    const result = await service.deleteCategoryBudget(USER_ID, String(doc._id), opts);
    expect(result.reason).toBe("CATEGORY_BUDGET_NOT_FOUND");
  });
});

describe("getSummary", () => {
  test("hands the analyzer allocations, derived spent, the total and the write window", async () => {
    const food = allocation("Food", 50000);
    const other = allocation("Food", 1, { userId: new mongoose.Types.ObjectId(OTHER_USER_ID) });
    const { service, analyzeCategoryBudgets, ExpenseModel } = load({
      allocations: [food, other],
      totalBudgetDoc: { budget: 1000, budgetMinor: 100000 },
      expenseGroups: [{ _id: "food", total: 120.5 }, { _id: "Travel", total: 30 }],
    });

    const summary = await service.getSummary(USER_ID, "2026-09", opts);

    expect(summary).toEqual({ analyzed: true, month: "2026-09" });
    const input = analyzeCategoryBudgets.mock.calls[0][0];
    expect(input.month).toBe("2026-09");
    expect(input.allocations.map((a) => String(a._id))).toEqual([String(food._id)]);
    expect(input.spentByCategory).toBeInstanceOf(Map);
    expect(input.spentByCategory.get("Food")).toBe(12050);
    expect(input.totalSpentMinor).toBe(15050);
    expect(input.totalBudgetMinor).toBe(100000);
    expect(input.now).toBe(NOW);
    expect(input.writable).toBe(true);
    expect(String(ExpenseModel.aggregate.mock.calls[0][0][0].$match.userId)).toBe(USER_ID);
  });

  test("a past month is reported read-only with a null total when none is set", async () => {
    const { service, analyzeCategoryBudgets } = load();
    await service.getSummary(USER_ID, "2025-01", opts);
    const input = analyzeCategoryBudgets.mock.calls[0][0];
    expect(input.writable).toBe(false);
    expect(input.totalBudgetMinor).toBeNull();
  });
});

describe("structured logging", () => {
  test("logs outcomes with reason codes but never amounts or category names", async () => {
    const doc = allocation("Groceries", 50000);
    const { service, logEvent } = load({ allocations: [doc], totalBudgetDoc: { budget: 1000, budgetMinor: 100000 } });

    await service.upsertCategoryBudget(USER_ID, upsertInput({ category: "Medicine", amount: 77 }), opts);
    await service.upsertCategoryBudget(USER_ID, upsertInput({ category: "Medicine", amount: 777 }), opts);
    await service.deleteCategoryBudget(USER_ID, String(doc._id), opts);

    const events = logEvent.mock.calls.map((c) => c[0]);
    expect(events.map((e) => [e.event, e.reason])).toEqual([
      ["created", undefined],
      ["rejected", "CATEGORY_BUDGET_EXCEEDS_TOTAL"],
      ["deleted", undefined],
    ]);
    for (const event of events) {
      expect(event.feature).toBe("BUD-001");
      const serialized = JSON.stringify(event);
      expect(serialized).not.toMatch(/Medicine|Groceries|777|7700|500/);
      expect(Object.keys(event)).not.toEqual(expect.arrayContaining(["amount"]));
    }
  });
});
