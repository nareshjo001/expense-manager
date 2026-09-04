// DAT-003-T06 -- backend/migrations/scripts/20260903-ensure-core-indexes.js:
// the first real migration through this pipeline. No real/in-memory Mongo
// is available in this environment, so up()/verify() are exercised
// against a fake db.collection(name).{createIndex,indexes} pair that
// mirrors the real Mongo driver's shape closely enough to catch a wrong
// collection name, key, or option -- not to substitute for running this
// migration against a real database once one is reachable (T07/CI).
"use strict";

const migration = require("../migrations/scripts/20260903-ensure-core-indexes");

function makeFakeDb() {
  const indexesByCollection = new Map(); // collectionName -> [{name, key, ...options}]

  const collection = (name) => ({
    createIndex: jest.fn(async (key, options) => {
      const list = indexesByCollection.get(name) || [];
      list.push({ key, ...options });
      indexesByCollection.set(name, list);
      return options.name;
    }),
    indexes: jest.fn(async () => indexesByCollection.get(name) || []),
  });

  return { collection, __indexesByCollection: indexesByCollection };
}

function makeContext({ dryRun = false } = {}) {
  const db = makeFakeDb();
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const mongoose = { connection: { db } };
  return { mongoose, logger, dryRun, db };
}

describe("migration 20260903-ensure-core-indexes", () => {
  test("exports a well-formed migration module", () => {
    expect(migration.id).toBe("20260903-ensure-core-indexes");
    expect(typeof migration.description).toBe("string");
    expect(migration.description.length).toBeGreaterThan(0);
    expect(typeof migration.up).toBe("function");
    expect(typeof migration.verify).toBe("function");
  });

  test("up() creates every declared index on its target collection", async () => {
    const ctx = makeContext();

    await migration.up(ctx);

    const expensesIdx = await ctx.db.collection("expenses").indexes();
    expect(expensesIdx.map((i) => i.name)).toEqual(
      expect.arrayContaining(["userId_1_id_1", "userId_1_expenseDate_1"])
    );
    const uniqueIdx = expensesIdx.find((i) => i.name === "userId_1_id_1");
    expect(uniqueIdx.unique).toBe(true);

    const incomesIdx = await ctx.db.collection("incomes").indexes();
    expect(incomesIdx.map((i) => i.name)).toContain("userId_1_incomeDate_1");

    const budgetIdx = await ctx.db.collection("budget").indexes();
    expect(budgetIdx.map((i) => i.name)).toContain("userId_1_month_1");

    const recurringIdx = await ctx.db.collection("recurringExpenses").indexes();
    expect(recurringIdx.map((i) => i.name)).toEqual(
      expect.arrayContaining(["userId_1_expenseId_1", "nextDueDate_1"])
    );
  });

  test("verify() passes once every index up() asked for is present", async () => {
    const ctx = makeContext();
    await migration.up(ctx);
    await expect(migration.verify(ctx)).resolves.toBeUndefined();
  });

  test("verify() throws, naming the missing index, when one was never created", async () => {
    const ctx = makeContext();
    // Deliberately skip up() so no indexes exist yet.
    await expect(migration.verify(ctx)).rejects.toThrow(/userId_1_id_1/);
    await expect(migration.verify(ctx)).rejects.toThrow(/expenses/);
  });

  test("dry run logs what it would create and never calls createIndex", async () => {
    const ctx = makeContext({ dryRun: true });
    const createIndexSpy = ctx.db.collection("expenses").createIndex;

    await migration.up(ctx);

    // up() calls db.collection(name) fresh per spec in the fake, so assert
    // via the logger instead of a single collection's spy call count.
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "would_create_index", collection: "expenses" })
    );
    expect(createIndexSpy).not.toHaveBeenCalled();
    expect((await ctx.db.collection("expenses").indexes()).length).toBe(0);
  });
});
