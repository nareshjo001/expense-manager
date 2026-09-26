// DAT-002-T07 -- migrations/scripts/20260926-drop-legacy-expense-id-index.js
"use strict";

const migration = require("../migrations/scripts/20260926-drop-legacy-expense-id-index");

function makeContext(initialIndexes, { dryRun = false } = {}) {
  let indexes = initialIndexes.map((i) => ({ ...i }));
  const dropIndex = jest.fn(async (name) => {
    indexes = indexes.filter((i) => i.name !== name);
  });
  const coll = { indexes: async () => indexes.map((i) => ({ ...i })), dropIndex };
  const db = { collection: jest.fn(() => coll) };
  const logger = { info: jest.fn(), warn: jest.fn() };
  return { ctx: { mongoose: { connection: { db } }, logger, dryRun }, dropIndex, db };
}

const ID = { _id: { name: "_id_", key: { _id: 1 } } };
const LEGACY = { name: "id_1", key: { id: 1 }, unique: true };
const COMPOUND = { name: "userId_1_id_1", key: { userId: 1, id: 1 }, unique: true };

describe("20260926-drop-legacy-expense-id-index", () => {
  test("targets the real expenses collection", async () => {
    const { ctx, db } = makeContext([ID._id, COMPOUND]);
    await migration.up(ctx);
    expect(db.collection).toHaveBeenCalledWith("expenses");
  });

  test("drops id_1 when the compound index exists, and verify passes", async () => {
    const { ctx, dropIndex } = makeContext([ID._id, LEGACY, COMPOUND]);
    await migration.up(ctx);
    expect(dropIndex).toHaveBeenCalledWith("id_1");
    await expect(migration.verify(ctx)).resolves.toBeUndefined();
  });

  test("refuses to drop id_1 while userId_1_id_1 is missing", async () => {
    const { ctx, dropIndex } = makeContext([ID._id, LEGACY]);
    await expect(migration.up(ctx)).rejects.toThrow(/userId_1_id_1 is missing/);
    expect(dropIndex).not.toHaveBeenCalled();
  });

  test("is a no-op when id_1 is already gone (idempotent)", async () => {
    const { ctx, dropIndex } = makeContext([ID._id, COMPOUND]);
    await migration.up(ctx);
    expect(dropIndex).not.toHaveBeenCalled();
    await expect(migration.verify(ctx)).resolves.toBeUndefined();
  });

  test("never drops a differently-shaped index that happens to be named id_1", async () => {
    const { ctx, dropIndex } = makeContext([ID._id, { name: "id_1", key: { id: 1, userId: 1 } }, COMPOUND]);
    await migration.up(ctx);
    expect(dropIndex).not.toHaveBeenCalled();
  });

  test("dry run reports but does not drop", async () => {
    const { ctx, dropIndex } = makeContext([ID._id, LEGACY, COMPOUND], { dryRun: true });
    await migration.up(ctx);
    expect(dropIndex).not.toHaveBeenCalled();
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.objectContaining({ event: "would_drop_index", name: "id_1" }));
  });

  test("verify fails while id_1 is still present", async () => {
    const { ctx } = makeContext([ID._id, LEGACY, COMPOUND]);
    await expect(migration.verify(ctx)).rejects.toThrow(/still present/);
  });

  test("a database without an expenses collection is a no-op (CI's fresh Mongo)", async () => {
    const nsErr = Object.assign(new Error("ns does not exist: db.expenses"), { code: 26, codeName: "NamespaceNotFound" });
    const coll = { indexes: jest.fn(async () => { throw nsErr; }), dropIndex: jest.fn() };
    const ctx = { mongoose: { connection: { db: { collection: () => coll } } }, logger: { info: jest.fn() }, dryRun: true };
    await expect(migration.up(ctx)).resolves.toBeUndefined();
    expect(coll.dropIndex).not.toHaveBeenCalled();
    expect(ctx.logger.info).toHaveBeenCalledWith(expect.objectContaining({ event: "legacy_index_absent" }));
  });

  test("any other error from listing indexes still fails the migration", async () => {
    const coll = { indexes: jest.fn(async () => { throw new Error("connection reset"); }), dropIndex: jest.fn() };
    const ctx = { mongoose: { connection: { db: { collection: () => coll } } }, logger: { info: jest.fn() }, dryRun: false };
    await expect(migration.up(ctx)).rejects.toThrow("connection reset");
  });
});
