// REC-002-T01 -- backend/migrations/scripts/20260921-backfill-recurring-lifecycle-fields.js:
// backfills the lifecycle-state fields added to models/RecurringExpense.js
// onto documents written before they existed. Exercised against a small
// fake Mongo collection (find/countDocuments/bulkWrite) since no real/in-
// memory Mongo is available in this environment -- same approach as
// migrationBackfillMoneyMinorFields.test.js (DAT-001-T04) and
// migrationEnsureCoreIndexes.test.js (DAT-003-T06).
"use strict";

const migration = require("../migrations/scripts/20260921-backfill-recurring-lifecycle-fields");

function matchesQuery(doc, query) {
  return Object.entries(query).every(([field, cond]) => {
    if (cond && typeof cond === "object" && "$exists" in cond) {
      const exists = Object.prototype.hasOwnProperty.call(doc, field) && doc[field] !== undefined;
      return exists === cond.$exists;
    }
    return doc[field] === cond;
  });
}

function makeFakeCollection(initialDocs) {
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

describe("migration 20260921-backfill-recurring-lifecycle-fields", () => {
  test("exports a well-formed migration module", () => {
    expect(migration.id).toBe("20260921-backfill-recurring-lifecycle-fields");
    expect(typeof migration.description).toBe("string");
    expect(typeof migration.up).toBe("function");
    expect(typeof migration.verify).toBe("function");
  });

  test("backfills all lifecycle fields to their active/never-happened defaults for a pre-REC-002 document", async () => {
    const ctx = makeContext({
      recurringexpenses: [
        { _id: "r1", userId: "u1", expenseId: "e1", expenseName: "Rent", nextDueDate: new Date("2026-10-01") },
      ],
    });

    await migration.up(ctx);

    const doc = ctx.db.collection("recurringexpenses").__docs[0];
    expect(doc.status).toBe("active");
    expect(doc.recurrenceFrequency).toBe("monthly");
    expect(doc.scheduleVersion).toBe(0);
    expect(doc.pausedAt).toBeNull();
    expect(doc.resumedAt).toBeNull();
    expect(doc.endedAt).toBeNull();
    expect(doc.endDate).toBeNull();
    // Untouched: this migration never reads or rewrites pre-existing fields.
    expect(doc.expenseName).toBe("Rent");
  });

  test("uses the real collection name 'recurringexpenses', not 'recurringExpenses'", async () => {
    const ctx = makeContext({
      recurringexpenses: [{ _id: "r1", userId: "u1" }],
    });

    await migration.up(ctx);

    expect(ctx.db.collection("recurringexpenses").__docs[0].status).toBe("active");
    // The wrong-cased name was never touched -- confirms the migration
    // didn't accidentally target it (guards against reintroducing the exact
    // DAT-002-T06 collection-name bug this migration's own header warns
    // about).
    expect(ctx.db.__collections.has("recurringExpenses")).toBe(false);
  });

  test("a document that already has 'status' is left completely untouched", async () => {
    const already = {
      _id: "r1",
      userId: "u1",
      status: "paused",
      recurrenceFrequency: "monthly",
      scheduleVersion: 3,
      pausedAt: new Date("2026-09-01"),
      resumedAt: null,
      endedAt: null,
      endDate: null,
    };
    const ctx = makeContext({ recurringexpenses: [{ ...already }] });

    await migration.up(ctx);

    expect(ctx.db.collection("recurringexpenses").__docs[0]).toEqual(already);
  });

  test("a mix of already-migrated and not-yet-migrated documents only backfills the latter", async () => {
    const ctx = makeContext({
      recurringexpenses: [
        { _id: "r1", userId: "u1", status: "ended", scheduleVersion: 5 },
        { _id: "r2", userId: "u1" }, // pre-REC-002
      ],
    });

    await migration.up(ctx);

    const docs = ctx.db.collection("recurringexpenses").__docs;
    expect(docs.find((d) => d._id === "r1").status).toBe("ended"); // untouched
    expect(docs.find((d) => d._id === "r1").scheduleVersion).toBe(5); // untouched
    expect(docs.find((d) => d._id === "r2").status).toBe("active"); // backfilled
  });

  test("dryRun reports the count without writing anything", async () => {
    const ctx = makeContext(
      { recurringexpenses: [{ _id: "r1", userId: "u1" }, { _id: "r2", userId: "u1" }] },
      { dryRun: true }
    );

    await migration.up(ctx);

    const docs = ctx.db.collection("recurringexpenses").__docs;
    expect(docs.every((d) => d.status === undefined)).toBe(true);
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "would_backfill", count: 2 })
    );
  });

  test("verify() passes once every document has been backfilled", async () => {
    const ctx = makeContext({
      recurringexpenses: [{ _id: "r1", userId: "u1" }],
    });

    await migration.up(ctx);
    await expect(migration.verify(ctx)).resolves.toBeUndefined();
  });

  test("verify() throws with a clear count when documents are still missing status", async () => {
    const ctx = makeContext({
      recurringexpenses: [
        { _id: "r1", userId: "u1", status: "active" },
        { _id: "r2", userId: "u1" }, // never backfilled
      ],
    });

    await expect(migration.verify(ctx)).rejects.toThrow(/1 document\(s\).*recurringexpenses.*status/);
  });

  test("an empty collection is a no-op that still verifies clean", async () => {
    const ctx = makeContext({ recurringexpenses: [] });

    await migration.up(ctx);
    await expect(migration.verify(ctx)).resolves.toBeUndefined();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "backfilled", count: 0 })
    );
  });

  test("backfills more documents than one batch (BATCH_SIZE=500) correctly", async () => {
    const docs = Array.from({ length: 750 }, (_, i) => ({ _id: `r${i}`, userId: "u1" }));
    const ctx = makeContext({ recurringexpenses: docs });

    await migration.up(ctx);

    const stored = ctx.db.collection("recurringexpenses").__docs;
    expect(stored.every((d) => d.status === "active")).toBe(true);
    expect(stored).toHaveLength(750);
    await expect(migration.verify(ctx)).resolves.toBeUndefined();
  });
});
