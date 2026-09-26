// DAT-002-T06 -- backend/migrations/scripts/20260921-report-orphan-and-
// duplicate-integrity-checks.js: a read-only report (never a mutation)
// of refreshsessions.userId / recurringexpenses.expenseId documents
// dangling after their referenced parent is deleted, plus the
// users.email collision scan reused from DAT-002-T05. Exercised against
// a small fake Mongo collection (find only), since no real/in-memory
// Mongo is available in this environment -- same approach as
// dat002T05.emailAndMonthNormalizationReport.test.js and
// migrationEnsureCoreIndexes.test.js.
"use strict";

const migration = require("../migrations/scripts/20260921-report-orphan-and-duplicate-integrity-checks");

function makeFakeCollection(initialDocs) {
  const docs = initialDocs.map((d) => ({ ...d }));
  return {
    __docs: docs,
    find: () => ({
      [Symbol.asyncIterator]: async function* asyncIterator() {
        for (const doc of docs) {
          yield doc;
        }
      },
    }),
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
  };
}

function makeContext(collectionsByName) {
  const db = makeFakeDb(collectionsByName);
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const mongoose = { connection: { db } };
  return { mongoose, logger };
}

describe("migration 20260921-report-orphan-and-duplicate-integrity-checks", () => {
  test("exports a well-formed migration module", () => {
    expect(migration.id).toBe("20260921-report-orphan-and-duplicate-integrity-checks");
    expect(typeof migration.description).toBe("string");
    expect(typeof migration.up).toBe("function");
    expect(typeof migration.verify).toBe("function");
  });

  test("reports zero refreshsession orphans when every session's userId has a matching user", async () => {
    const ctx = makeContext({
      users: [{ _id: "u1" }, { _id: "u2" }],
      refreshsessions: [
        { _id: "s1", userId: "u1" },
        { _id: "s2", userId: "u2" },
      ],
      expenses: [],
      recurringexpenses: [],
    });

    const result = await migration.up(ctx);

    expect(result.refreshSessionOrphans.scanned).toBe(2);
    expect(result.refreshSessionOrphans.orphanCount).toBe(0);
    expect(result.refreshSessionOrphans.examples).toEqual([]);
  });

  test("flags a refreshsession whose userId no longer matches any user, naming its doc id", async () => {
    const ctx = makeContext({
      users: [{ _id: "u1" }],
      refreshsessions: [
        { _id: "s1", userId: "u1" },
        { _id: "s2", userId: "deleted-user" },
      ],
      expenses: [],
      recurringexpenses: [],
    });

    const result = await migration.up(ctx);

    expect(result.refreshSessionOrphans.orphanCount).toBe(1);
    expect(result.refreshSessionOrphans.examples).toEqual([{ docId: "s2", userId: "deleted-user" }]);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "orphans_found", label: "refreshsessions.userId -> users" })
    );
  });

  test("reports zero recurringexpenses orphans when every expenseId has a matching expense", async () => {
    const ctx = makeContext({
      users: [],
      refreshsessions: [],
      expenses: [{ _id: "e1" }, { _id: "e2" }],
      recurringexpenses: [
        { _id: "r1", expenseId: "e1" },
        { _id: "r2", expenseId: "e2" },
      ],
    });

    const result = await migration.up(ctx);

    expect(result.recurringExpenseOrphans.scanned).toBe(2);
    expect(result.recurringExpenseOrphans.orphanCount).toBe(0);
  });

  test("flags a recurringexpense whose expenseId no longer matches any expense, naming its doc id", async () => {
    const ctx = makeContext({
      users: [],
      refreshsessions: [],
      expenses: [{ _id: "e1" }],
      recurringexpenses: [
        { _id: "r1", expenseId: "e1" },
        { _id: "r2", expenseId: "deleted-expense" },
      ],
    });

    const result = await migration.up(ctx);

    expect(result.recurringExpenseOrphans.orphanCount).toBe(1);
    expect(result.recurringExpenseOrphans.examples).toEqual([
      { docId: "r2", expenseId: "deleted-expense" },
    ]);
  });

  test("reuses DAT-002-T05's email collision scan rather than reimplementing it -- a real collision is reported here too", async () => {
    const ctx = makeContext({
      users: [
        { _id: "u1", email: "Foo@Example.com" },
        { _id: "u2", email: "foo@example.com" },
      ],
      refreshsessions: [],
      expenses: [],
      recurringexpenses: [],
    });

    const result = await migration.up(ctx);

    expect(result.emailDuplicates.collisions).toHaveLength(1);
    expect(result.emailDuplicates.collisions[0].normalized).toBe("foo@example.com");
  });

  test("never calls anything but find on the collections it reads (report-only, no mutation)", async () => {
    const ctx = makeContext({
      users: [{ _id: "u1" }],
      refreshsessions: [{ _id: "s1", userId: "u1" }],
      expenses: [{ _id: "e1" }],
      recurringexpenses: [{ _id: "r1", expenseId: "e1" }],
    });

    for (const name of ["users", "refreshsessions", "expenses", "recurringexpenses"]) {
      const coll = ctx.mongoose.connection.db.collection(name);
      expect(coll.updateOne).toBeUndefined();
      expect(coll.deleteOne).toBeUndefined();
      expect(coll.bulkWrite).toBeUndefined();
    }

    await expect(migration.up(ctx)).resolves.toBeDefined();
  });

  test("verify() re-scans and resolves without throwing, reporting the same counts as up()", async () => {
    const ctx = makeContext({
      users: [{ _id: "u1" }],
      refreshsessions: [{ _id: "s1", userId: "u1" }, { _id: "s2", userId: "deleted-user" }],
      expenses: [{ _id: "e1" }],
      recurringexpenses: [{ _id: "r1", expenseId: "e1" }],
    });

    await migration.up(ctx);
    await expect(migration.verify(ctx)).resolves.toBeUndefined();

    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "verify_ok",
        refreshSessionScanned: 2,
        recurringExpenseScanned: 1,
        emailScanned: 1,
      })
    );
  });

  test("a document with no referencing field at all (undefined/null) is scanned but never flagged as an orphan", async () => {
    const ctx = makeContext({
      users: [{ _id: "u1" }],
      refreshsessions: [{ _id: "s1" }, { _id: "s2", userId: null }],
      expenses: [],
      recurringexpenses: [],
    });

    const result = await migration.up(ctx);

    expect(result.refreshSessionOrphans.scanned).toBe(2);
    expect(result.refreshSessionOrphans.orphanCount).toBe(0);
  });
});
