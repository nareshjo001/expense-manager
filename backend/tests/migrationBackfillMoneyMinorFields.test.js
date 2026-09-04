// DAT-001-T04 -- backend/migrations/scripts/20260903-backfill-money-minor-fields.js:
// backfills the *Minor integer-paise shadow fields (ADR-0003) from the
// existing float fields. Exercised against a small fake Mongo collection
// (find/countDocuments/bulkWrite) since no real/in-memory Mongo is
// available in this environment -- same limitation and same approach as
// migrationEnsureCoreIndexes.test.js (DAT-003-T06).
"use strict";

const migration = require("../migrations/scripts/20260903-backfill-money-minor-fields");

function matchesQuery(doc, query) {
  return Object.entries(query).every(([field, cond]) => {
    if (cond && typeof cond === "object" && ("$exists" in cond || "$type" in cond)) {
      const exists = Object.prototype.hasOwnProperty.call(doc, field) && doc[field] !== undefined;
      if ("$exists" in cond && exists !== cond.$exists) return false;
      if ("$type" in cond && cond.$type === "number" && typeof doc[field] !== "number") return false;
      return true;
    }
    return doc[field] === cond;
  });
}

function makeFakeCollection(initialDocs) {
  // Deep-ish clone so each test's fixture is independent.
  const docs = initialDocs.map((d) => ({ ...d }));

  return {
    __docs: docs,
    find: (query) => {
      const matched = docs.filter((d) => matchesQuery(d, query));
      return {
        [Symbol.asyncIterator]: async function* asyncIterator() {
          for (const doc of matched) {
            yield doc;
          }
        },
      };
    },
    countDocuments: async (query) => docs.filter((d) => matchesQuery(d, query)).length,
    bulkWrite: async (ops) => {
      for (const op of ops) {
        const { filter, update } = op.updateOne;
        const target = docs.find((d) => String(d._id) === String(filter._id));
        if (!target) throw new Error(`bulkWrite: no doc matching ${JSON.stringify(filter)}`);
        Object.assign(target, update.$set);
      }
      return { modifiedCount: ops.length };
    },
  };
}

function makeFakeDb(collectionsByName) {
  const collections = new Map(
    Object.entries(collectionsByName).map(([name, docs]) => [name, makeFakeCollection(docs)])
  );
  return {
    collection: (name) => {
      if (!collections.has(name)) collections.set(name, makeFakeCollection([]));
      return collections.get(name);
    },
    __collections: collections,
  };
}

function makeContext(collectionsByName, { dryRun = false } = {}) {
  const db = makeFakeDb(collectionsByName);
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const mongoose = { connection: { db } };
  return { mongoose, logger, dryRun, db };
}

describe("migration 20260903-backfill-money-minor-fields", () => {
  test("exports a well-formed migration module", () => {
    expect(migration.id).toBe("20260903-backfill-money-minor-fields");
    expect(typeof migration.description).toBe("string");
    expect(typeof migration.up).toBe("function");
    expect(typeof migration.verify).toBe("function");
  });

  test("backfills expenseAmountMinor for every expense missing it, leaving expenseAmount untouched", async () => {
    const ctx = makeContext({
      expenses: [
        { _id: "e1", expenseAmount: 123.45 },
        { _id: "e2", expenseAmount: 49.995 },
      ],
    });

    await migration.up(ctx);

    const expenses = ctx.db.collection("expenses").__docs;
    expect(expenses.find((d) => d._id === "e1").expenseAmountMinor).toBe(12345);
    expect(expenses.find((d) => d._id === "e2").expenseAmountMinor).toBe(5000); // ADR-0003 rounding example
    expect(expenses.find((d) => d._id === "e1").expenseAmount).toBe(123.45);
    expect(expenses.find((d) => d._id === "e2").expenseAmount).toBe(49.995);
  });

  test("backfills both budgetMinor and spentMinor for the budget collection in one pass", async () => {
    const ctx = makeContext({
      budget: [{ _id: "b1", budget: 10000, spent: 2500.5 }],
    });

    await migration.up(ctx);

    const doc = ctx.db.collection("budget").__docs[0];
    expect(doc.budgetMinor).toBe(1000000);
    expect(doc.spentMinor).toBe(250050);
  });

  test("skips documents that already have the *Minor field (idempotent / resumable)", async () => {
    const ctx = makeContext({
      incomes: [
        { _id: "i1", incomeAmount: 100, incomeAmountMinor: 999999 }, // already set -- must not be touched
        { _id: "i2", incomeAmount: 200 },
      ],
    });

    await migration.up(ctx);

    const incomes = ctx.db.collection("incomes").__docs;
    expect(incomes.find((d) => d._id === "i1").incomeAmountMinor).toBe(999999);
    expect(incomes.find((d) => d._id === "i2").incomeAmountMinor).toBe(20000);
  });

  test("skips a document whose legacy value is non-numeric rather than throwing", async () => {
    const ctx = makeContext({
      expenses: [
        { _id: "e1", expenseAmount: "not-a-number" },
        { _id: "e2", expenseAmount: 50 },
      ],
    });

    await expect(migration.up(ctx)).resolves.toBeUndefined();

    const expenses = ctx.db.collection("expenses").__docs;
    expect(expenses.find((d) => d._id === "e1").expenseAmountMinor).toBeUndefined();
    expect(expenses.find((d) => d._id === "e2").expenseAmountMinor).toBe(5000);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "skip_non_numeric_legacy_value", collection: "expenses" })
    );
  });

  test("dry run never calls bulkWrite and leaves every document unchanged", async () => {
    const ctx = makeContext(
      { expenses: [{ _id: "e1", expenseAmount: 100 }] },
      { dryRun: true }
    );
    const coll = ctx.db.collection("expenses");
    const bulkWriteSpy = jest.spyOn(coll, "bulkWrite");

    await migration.up(ctx);

    expect(bulkWriteSpy).not.toHaveBeenCalled();
    expect(coll.__docs[0].expenseAmountMinor).toBeUndefined();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "would_backfill", collection: "expenses" })
    );
  });

  test("verify() passes once every numeric legacy field has a backfilled shadow field", async () => {
    const ctx = makeContext({
      expenses: [{ _id: "e1", expenseAmount: 100 }],
      incomes: [{ _id: "i1", incomeAmount: 100 }],
      budget: [{ _id: "b1", budget: 100, spent: 50 }],
      recurringExpenses: [{ _id: "r1", expenseAmount: 100 }],
    });

    await migration.up(ctx);

    await expect(migration.verify(ctx)).resolves.toBeUndefined();
  });

  test("verify() throws, naming the collection and field, when a numeric legacy value was never backfilled", async () => {
    const ctx = makeContext({
      expenses: [{ _id: "e1", expenseAmount: 100 }],
    });

    // Deliberately skip up() so expenseAmountMinor was never set.
    await expect(migration.verify(ctx)).rejects.toThrow(/expenses/);
    await expect(migration.verify(ctx)).rejects.toThrow(/expenseAmountMinor/);
  });
});
