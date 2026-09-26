// DAT-002-T03 -- backend/migrations/scripts/20260921-ensure-devicetoken-notification-indexes.js:
// mirrors tests/migrationEnsureCoreIndexes.test.js's (DAT-003-T06) pattern
// exactly. No real/in-memory Mongo is available in this environment, so
// up()/verify() are exercised against a fake db.collection(name).
// {createIndex,indexes} pair that mirrors the real Mongo driver's shape
// closely enough to catch a wrong collection name, key, or option -- not to
// substitute for running this migration against a real database once one is
// reachable (DAT-002-T07/CI, same caveat as the T06 migration's own test).
"use strict";

const migration = require("../migrations/scripts/20260921-ensure-devicetoken-notification-indexes");

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

describe("migration 20260921-ensure-devicetoken-notification-indexes", () => {
  test("exports a well-formed migration module", () => {
    expect(migration.id).toBe("20260921-ensure-devicetoken-notification-indexes");
    expect(typeof migration.description).toBe("string");
    expect(migration.description.length).toBeGreaterThan(0);
    expect(typeof migration.up).toBe("function");
    expect(typeof migration.verify).toBe("function");
  });

  test("up() creates the userId index on both target collections", async () => {
    const ctx = makeContext();

    await migration.up(ctx);

    const deviceTokenIdx = await ctx.db.collection("devicetokens").indexes();
    expect(deviceTokenIdx.map((i) => i.name)).toContain("userId_1");
    expect(deviceTokenIdx.find((i) => i.name === "userId_1").key).toEqual({ userId: 1 });

    const notificationIdx = await ctx.db.collection("notifications").indexes();
    expect(notificationIdx.map((i) => i.name)).toContain("userId_1");
    expect(notificationIdx.find((i) => i.name === "userId_1").key).toEqual({ userId: 1 });
  });

  test("verify() passes once both indexes up() asked for are present", async () => {
    const ctx = makeContext();
    await migration.up(ctx);
    await expect(migration.verify(ctx)).resolves.toBeUndefined();
  });

  test("verify() throws, naming the missing index and collection, when one was never created", async () => {
    const ctx = makeContext();
    // Deliberately skip up() so no indexes exist yet.
    await expect(migration.verify(ctx)).rejects.toThrow(/userId_1/);
    await expect(migration.verify(ctx)).rejects.toThrow(/devicetokens/);
  });

  test("dry run logs what it would create and never calls createIndex", async () => {
    const ctx = makeContext({ dryRun: true });
    const createIndexSpy = ctx.db.collection("devicetokens").createIndex;

    await migration.up(ctx);

    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "would_create_index", collection: "devicetokens" })
    );
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "would_create_index", collection: "notifications" })
    );
    expect(createIndexSpy).not.toHaveBeenCalled();
    expect((await ctx.db.collection("devicetokens").indexes()).length).toBe(0);
  });
});
