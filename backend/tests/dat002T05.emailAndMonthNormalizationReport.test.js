// DAT-002-T05 -- backend/migrations/scripts/20260921-report-email-and-
// month-normalization-gaps.js: a read-only report (never a mutation) of
// User.email documents not yet in canonical lowercase/trimmed form, any
// collisions normalizing them would cause, and Budget.month documents
// that don't parse as the canonical "MMM YYYY" key. Exercised against a
// small fake Mongo collection (find only -- this migration never calls
// countDocuments/bulkWrite/updateOne), since no real/in-memory Mongo is
// available in this environment -- same approach as
// migrationBackfillMoneyMinorFields.test.js (DAT-001-T04) and
// migrationEnsureCoreIndexes.test.js (DAT-003-T06).
"use strict";

const migration = require("../migrations/scripts/20260921-report-email-and-month-normalization-gaps");

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

describe("migration 20260921-report-email-and-month-normalization-gaps", () => {
  test("exports a well-formed migration module", () => {
    expect(migration.id).toBe("20260921-report-email-and-month-normalization-gaps");
    expect(typeof migration.description).toBe("string");
    expect(typeof migration.up).toBe("function");
    expect(typeof migration.verify).toBe("function");
  });

  test("counts already-canonical emails as clean and reports zero collisions when every email is already distinct and normalized", async () => {
    const ctx = makeContext({
      users: [
        { _id: "u1", email: "alice@example.com" },
        { _id: "u2", email: "bob@example.com" },
      ],
      budgets: [],
    });

    const result = await migration.up(ctx);

    expect(result.email.scanned).toBe(2);
    expect(result.email.nonCanonicalCount).toBe(0);
    expect(result.email.collisions).toEqual([]);
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });

  test("counts a mixed-case / untrimmed email as non-canonical without flagging it as a collision on its own", async () => {
    const ctx = makeContext({
      users: [{ _id: "u1", email: " Alice@Example.com " }],
      budgets: [],
    });

    const result = await migration.up(ctx);

    expect(result.email.nonCanonicalCount).toBe(1);
    expect(result.email.collisions).toEqual([]);
  });

  test("flags two documents whose emails only differ by case/whitespace as a collision group, naming both doc ids", async () => {
    const ctx = makeContext({
      users: [
        { _id: "u1", email: "Foo@Example.com" },
        { _id: "u2", email: "foo@example.com " },
        { _id: "u3", email: "unrelated@example.com" },
      ],
      budgets: [],
    });

    const result = await migration.up(ctx);

    expect(result.email.collisions).toHaveLength(1);
    const [collision] = result.email.collisions;
    expect(collision.normalized).toBe("foo@example.com");
    expect(collision.docs.map((d) => d.docId).sort()).toEqual(["u1", "u2"]);
    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: "email_collision", docIds: ["u1", "u2"], docCount: 2 })
    );
    // The log line names documents, never addresses (OBS-001-T01).
    expect(JSON.stringify(ctx.logger.warn.mock.calls)).not.toMatch(/@example\.com/);
  });

  test("never calls anything but find on the users/budget collections (report-only, no mutation)", async () => {
    const ctx = makeContext({
      users: [{ _id: "u1", email: "Foo@Example.com" }, { _id: "u2", email: "foo@example.com" }],
      budgets: [{ _id: "b1", month: "not-a-month", userId: "u1" }],
    });
    const usersColl = ctx.mongoose.connection.db.collection("users");
    const budgetColl = ctx.mongoose.connection.db.collection("budgets");
    expect(usersColl.updateOne).toBeUndefined();
    expect(usersColl.bulkWrite).toBeUndefined();
    expect(budgetColl.updateOne).toBeUndefined();
    expect(budgetColl.bulkWrite).toBeUndefined();

    await expect(migration.up(ctx)).resolves.toBeDefined();
  });

  test("recognizes every canonical MMM YYYY budget month as valid, reporting zero malformed documents", async () => {
    const ctx = makeContext({
      users: [],
      budgets: [
        { _id: "b1", month: "Jan 2026", userId: "u1" },
        { _id: "b2", month: "Dec 2025", userId: "u2" },
      ],
    });

    const result = await migration.up(ctx);

    expect(result.budgetMonth.scanned).toBe(2);
    expect(result.budgetMonth.malformedCount).toBe(0);
    expect(result.budgetMonth.examples).toEqual([]);
  });

  test("flags a legacy/malformed budget month (e.g. YYYY-MM or garbage) as a backfill candidate with an example doc id", async () => {
    const ctx = makeContext({
      users: [],
      budgets: [
        { _id: "b1", month: "2026-01", userId: "u1" },
        { _id: "b2", month: "Jan 2026", userId: "u2" },
        { _id: "b3", month: null, userId: "u3" },
      ],
    });

    const result = await migration.up(ctx);

    expect(result.budgetMonth.malformedCount).toBe(2);
    expect(result.budgetMonth.examples.map((e) => e.docId).sort()).toEqual(["b1", "b3"]);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "budget_month_backfill_report", malformedCount: 2 })
    );
  });

  test("a document with no email at all is scanned but never joins a collision group", async () => {
    const ctx = makeContext({
      users: [{ _id: "u1" }, { _id: "u2", email: "real@example.com" }],
      budgets: [],
    });

    const result = await migration.up(ctx);

    expect(result.email.scanned).toBe(2);
    expect(result.email.collisions).toEqual([]);
  });

  test("verify() re-scans and resolves without throwing, reporting the same counts as up()", async () => {
    const ctx = makeContext({
      users: [{ _id: "u1", email: "Foo@Example.com" }, { _id: "u2", email: "foo@example.com" }],
      budgets: [{ _id: "b1", month: "2026-01", userId: "u1" }],
    });

    await migration.up(ctx);
    await expect(migration.verify(ctx)).resolves.toBeUndefined();

    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "verify_ok", emailScanned: 2, budgetMonthScanned: 1 })
    );
  });

  test("verify() never throws even when it finds collisions/malformed months -- this migration reports, it does not gate", async () => {
    const ctx = makeContext({
      users: [{ _id: "u1", email: "Foo@Example.com" }, { _id: "u2", email: "foo@example.com" }],
      budgets: [{ _id: "b1", month: "garbage" }],
    });

    await expect(migration.verify(ctx)).resolves.toBeUndefined();
  });
});
