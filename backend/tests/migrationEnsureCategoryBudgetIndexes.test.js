// BUD-001-T03 -- backend/migrations/scripts/20260926-ensure-category-budget-
// indexes.js. Same fake db.collection(name).{createIndex,indexes} approach
// as migrationEnsureCoreIndexes.test.js (no live Mongo in unit tests), plus
// a check that the migration's spec matches the index the model declares,
// and that the runner discovers and accepts the file.
"use strict";

const path = require("path");
const migration = require("../migrations/scripts/20260926-ensure-category-budget-indexes");

function makeFakeDb() {
  const indexesByCollection = new Map();
  const createIndexCalls = [];

  const collection = (name) => ({
    createIndex: jest.fn(async (key, options) => {
      createIndexCalls.push({ collection: name, key, options });
      const list = indexesByCollection.get(name) || [];
      list.push({ key, ...options });
      indexesByCollection.set(name, list);
      return options.name;
    }),
    indexes: jest.fn(async () => indexesByCollection.get(name) || []),
  });

  return { collection, createIndexCalls };
}

function makeContext({ dryRun = false } = {}) {
  const db = makeFakeDb();
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const mongoose = { connection: { db } };
  return { mongoose, logger, dryRun, db };
}

describe("migration 20260926-ensure-category-budget-indexes", () => {
  test("exports a well-formed migration module whose id matches its filename", () => {
    expect(migration.id).toBe("20260926-ensure-category-budget-indexes");
    expect(typeof migration.description).toBe("string");
    expect(migration.description.length).toBeGreaterThan(0);
    expect(typeof migration.up).toBe("function");
    expect(typeof migration.verify).toBe("function");
  });

  test("up() creates the unique {userId, month, category} index on categorybudgets", async () => {
    const ctx = makeContext();

    await migration.up(ctx);

    expect(ctx.db.createIndexCalls).toEqual([
      {
        collection: "categorybudgets",
        key: { userId: 1, month: 1, category: 1 },
        options: { unique: true, name: "userId_month_category_unique" },
      },
    ]);
  });

  test("the spec matches the index and collection models/CategoryBudget.js declares", () => {
    const { CategoryBudgetModel } = require("../models/CategoryBudget");
    expect(CategoryBudgetModel.collection.collectionName).toBe("categorybudgets");
    const declared = CategoryBudgetModel.schema.indexes();
    expect(declared).toContainEqual([
      { userId: 1, month: 1, category: 1 },
      expect.objectContaining({ unique: true, name: "userId_month_category_unique" }),
    ]);
  });

  test("verify() passes once up() has run", async () => {
    const ctx = makeContext();
    await migration.up(ctx);
    await expect(migration.verify(ctx)).resolves.toBeUndefined();
  });

  test("verify() throws, naming the missing index and collection, when it was never created", async () => {
    const ctx = makeContext();
    await expect(migration.verify(ctx)).rejects.toThrow(/userId_month_category_unique/);
    await expect(migration.verify(ctx)).rejects.toThrow(/categorybudgets/);
  });

  test("dry run logs what it would create and never calls createIndex", async () => {
    const ctx = makeContext({ dryRun: true });

    await migration.up(ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "would_create_index", collection: "categorybudgets" })
    );
    expect(ctx.db.createIndexCalls).toHaveLength(0);
  });

  test("the runner discovers the script after the earlier migrations and accepts its shape", () => {
    const runner = require("../migrations/runner");
    const filenames = runner.loadMigrationFilenames(path.join(__dirname, "../migrations/scripts"));
    expect(filenames).toContain("20260926-ensure-category-budget-indexes.js");
    expect(filenames[filenames.length - 1] >= "20260926-ensure-category-budget-indexes.js").toBe(true);
    expect(() =>
      runner.validateMigrationModule(migration, "20260926-ensure-category-budget-indexes.js")
    ).not.toThrow();
  });
});
