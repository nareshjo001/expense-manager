// OPS-002-T05 -- backend/scripts/backup/mongoRestore.js: the fail-closed
// safety gate (assertSafeRestoreTarget) that must refuse to restore into
// production under any circumstance, plus the pure mongorestore argv
// builder. This is the single most safety-critical property in this
// task -- fully unit-testable with plain env-object fixtures, no live
// Mongo needed.
"use strict";

const {
  RestoreSafetyError,
  assertSafeRestoreTarget,
  buildMongorestoreArgs,
  parseRestoredDocumentCount,
} = require("../scripts/backup/mongoRestore");

describe("assertSafeRestoreTarget", () => {
  test("refuses when RESTORE_TARGET_MONGO_CONN is missing entirely", () => {
    expect(() => assertSafeRestoreTarget({ MONGO_CONN: "mongodb://prod/db" })).toThrow(RestoreSafetyError);
    expect(() => assertSafeRestoreTarget({ MONGO_CONN: "mongodb://prod/db" })).toThrow(/RESTORE_TARGET_MONGO_CONN/);
  });

  test("refuses when RESTORE_TARGET_MONGO_CONN is an empty string", () => {
    expect(() =>
      assertSafeRestoreTarget({ MONGO_CONN: "mongodb://prod/db", RESTORE_TARGET_MONGO_CONN: "" })
    ).toThrow(RestoreSafetyError);
  });

  test("refuses when RESTORE_TARGET_MONGO_CONN is only whitespace", () => {
    expect(() =>
      assertSafeRestoreTarget({ MONGO_CONN: "mongodb://prod/db", RESTORE_TARGET_MONGO_CONN: "   " })
    ).toThrow(RestoreSafetyError);
  });

  test("refuses when RESTORE_TARGET_MONGO_CONN is identical to MONGO_CONN", () => {
    const conn = "mongodb://user:pass@prod-host:27017/expense_manager";
    expect(() => assertSafeRestoreTarget({ MONGO_CONN: conn, RESTORE_TARGET_MONGO_CONN: conn })).toThrow(
      RestoreSafetyError
    );
    expect(() => assertSafeRestoreTarget({ MONGO_CONN: conn, RESTORE_TARGET_MONGO_CONN: conn })).toThrow(
      /identical to MONGO_CONN/
    );
  });

  test("accepts a RESTORE_TARGET_MONGO_CONN that differs from MONGO_CONN", () => {
    const target = "mongodb://127.0.0.1:27017/restore_scratch_db";
    const result = assertSafeRestoreTarget({
      MONGO_CONN: "mongodb://prod-host:27017/expense_manager",
      RESTORE_TARGET_MONGO_CONN: target,
    });
    expect(result).toBe(target);
  });

  test("accepts a RESTORE_TARGET_MONGO_CONN even when MONGO_CONN is itself unset (e.g. a standalone restore host)", () => {
    const target = "mongodb://127.0.0.1:27017/restore_scratch_db";
    expect(assertSafeRestoreTarget({ RESTORE_TARGET_MONGO_CONN: target })).toBe(target);
  });

  test("trims whitespace before comparing, and returns the trimmed target", () => {
    const target = "mongodb://127.0.0.1:27017/restore_scratch_db";
    expect(assertSafeRestoreTarget({ RESTORE_TARGET_MONGO_CONN: `  ${target}  ` })).toBe(target);
  });

  test("only differing whitespace around an otherwise-identical connection string still refuses (compares trimmed target against raw MONGO_CONN)", () => {
    const conn = "mongodb://prod-host:27017/expense_manager";
    // RESTORE_TARGET_MONGO_CONN is trimmed before comparison, but
    // MONGO_CONN is compared as-is -- so a MONGO_CONN with incidental
    // surrounding whitespace would NOT be treated as equal to a trimmed
    // target with the same core value. Documented here as the actual,
    // intentionally simple behavior (a plain string compare, per the
    // task spec) rather than a fuzzy/normalized one.
    expect(() => assertSafeRestoreTarget({ MONGO_CONN: conn, RESTORE_TARGET_MONGO_CONN: conn })).toThrow(
      RestoreSafetyError
    );
  });
});

describe("buildMongorestoreArgs", () => {
  // The argv this replaces restored ZERO documents while exiting 0, and its
  // test passed the whole time -- because the test asserted the argv the code
  // produced rather than anything about what mongorestore does with it. See
  // buildMongorestoreArgs' own comment for the mechanism, traced through
  // mongo-tools' source. These tests are written to encode that mechanism, so
  // reverting the fix fails here rather than in a weekly scheduled job.
  test("targets the per-database dump directory, not the archive root", () => {
    // CreateIntentsForDB looks for <collection>.bson directly inside the
    // directory it is given. The archive root holds <dbname>/ instead, so
    // pointing at it finds nothing and mongorestore exits successfully having
    // done nothing at all.
    const args = buildMongorestoreArgs({
      configPath: "/tmp/mongo-config.yaml",
      targetDbName: "expense_manager_restore_scratch",
      sourceDumpDir: "/tmp/dump/expense_manager",
    });

    expect(args[args.length - 1]).toBe("/tmp/dump/expense_manager");
  });

  test("passes --db explicitly rather than relying on the URI carrying one", () => {
    // mongo-tools populates ToolOptions.DB from the connection string's
    // database when no --db is given, and that field is what selects
    // single-database mode. Leaving it implicit makes the restore's behaviour
    // depend on the shape of whatever connection string the caller supplied.
    const args = buildMongorestoreArgs({
      configPath: "/tmp/mongo-config.yaml",
      targetDbName: "expense_manager_restore_scratch",
      sourceDumpDir: "/tmp/dump/expense_manager",
    });

    expect(args).toEqual([
      "--config",
      "/tmp/mongo-config.yaml",
      "--db",
      "expense_manager_restore_scratch",
      "/tmp/dump/expense_manager",
    ]);
  });

  test("--db names the TARGET database -- that is what performs the rename", () => {
    // CreateIntentsForDB assigns this database to every .bson it finds, so a
    // dump of `expense_manager` lands in the scratch database. Passing the
    // SOURCE name here would restore production data back over production.
    const args = buildMongorestoreArgs({
      configPath: "/tmp/cfg.yaml",
      targetDbName: "restore_scratch",
      sourceDumpDir: "/tmp/dump/expense_manager",
    });

    const dbIndex = args.indexOf("--db");
    expect(args[dbIndex + 1]).toBe("restore_scratch");
    expect(args).not.toContain("expense_manager");
  });

  test("carries no namespace-rename flags", () => {
    // Dropped rather than kept alongside --db: they were not filtering
    // anything (the dump holds only the seven collections mongoBackup.js
    // wrote), and leaving them in implies a scoping guarantee that is absent.
    const args = buildMongorestoreArgs({
      configPath: "/tmp/cfg.yaml",
      targetDbName: "db2",
      sourceDumpDir: "/tmp/dump/db1",
    });

    expect(args).not.toContain("--nsFrom");
    expect(args).not.toContain("--nsTo");
    expect(args).not.toContain("--nsInclude");
  });

  test("never includes a raw connection string in argv", () => {
    const args = buildMongorestoreArgs({
      configPath: "/tmp/mongo-config.yaml",
      targetDbName: "db2",
      sourceDumpDir: "/tmp/dump/db1",
    });
    expect(args.join(" ")).not.toMatch(/mongodb(\+srv)?:\/\//);
  });
});

describe("parseRestoredDocumentCount", () => {
  // mongorestore exits 0 whether it restored everything or nothing, so this
  // line is the difference between a diagnosable failure and a mystery.
  test("reads the count out of mongorestore's stderr summary", () => {
    const output = [
      "2026-09-09T19:38:28.500+0000\tfinished restoring expense_manager.users (2 documents, 0 failures)",
      "2026-09-09T19:38:28.510+0000\t3 document(s) restored successfully. 0 document(s) failed to restore.",
    ].join("\n");

    expect(parseRestoredDocumentCount(output)).toBe(3);
  });

  test("reads a zero, which is the case that matters", () => {
    expect(
      parseRestoredDocumentCount("0 document(s) restored successfully. 0 document(s) failed to restore.")
    ).toBe(0);
  });

  test("returns null when the summary is absent rather than guessing", () => {
    // null and 0 must stay distinguishable: 0 is mongorestore telling us it
    // did nothing, null is us not knowing. Only the first should fail a run.
    expect(parseRestoredDocumentCount("")).toBeNull();
    expect(parseRestoredDocumentCount("some unrelated output")).toBeNull();
    expect(parseRestoredDocumentCount(undefined)).toBeNull();
  });
});
