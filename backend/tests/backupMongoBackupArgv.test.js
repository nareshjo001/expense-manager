// OPS-002-T03 -- backend/scripts/backup/mongoBackup.js: pure argv
// construction for mongodump, tested without spawning any process (no
// mongodump binary needed/used here -- see backupMongoBackupIntegration
// notes in the final report for why a live mongodump run isn't possible
// in this sandbox).
"use strict";

const { buildMongodumpArgs } = require("../scripts/backup/mongoBackup");
const { AUTHORITATIVE_COLLECTIONS } = require("../scripts/backup/collections");

describe("buildMongodumpArgs", () => {
  test("builds the expected argv for one collection", () => {
    const args = buildMongodumpArgs({
      configPath: "/tmp/mongo-config.yaml",
      dbName: "expense_manager",
      collection: "expenses",
      outDir: "/tmp/dump",
    });
    expect(args).toEqual([
      "--config",
      "/tmp/mongo-config.yaml",
      "--db",
      "expense_manager",
      "--collection",
      "expenses",
      "--out",
      "/tmp/dump",
    ]);
  });

  test("never includes a raw connection string or credentials in argv", () => {
    const args = buildMongodumpArgs({
      configPath: "/tmp/mongo-config.yaml",
      dbName: "expense_manager",
      collection: "budgets",
      outDir: "/tmp/dump",
    });
    expect(args.join(" ")).not.toMatch(/mongodb(\+srv)?:\/\//);
  });

  test("produces a distinct, correct invocation for every authoritative collection", () => {
    for (const { collection } of AUTHORITATIVE_COLLECTIONS) {
      const args = buildMongodumpArgs({
        configPath: "/cfg",
        dbName: "db",
        collection,
        outDir: "/out",
      });
      expect(args[args.indexOf("--collection") + 1]).toBe(collection);
    }
  });
});
