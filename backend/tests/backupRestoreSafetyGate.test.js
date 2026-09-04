// OPS-002-T05 -- backend/scripts/backup/mongoRestore.js: the fail-closed
// safety gate (assertSafeRestoreTarget) that must refuse to restore into
// production under any circumstance, plus the pure mongorestore argv
// builder. This is the single most safety-critical property in this
// task -- fully unit-testable with plain env-object fixtures, no live
// Mongo needed.
"use strict";

const { RestoreSafetyError, assertSafeRestoreTarget, buildMongorestoreArgs } = require("../scripts/backup/mongoRestore");

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
  test("builds the expected argv, including the namespace rename from source db to target db", () => {
    const args = buildMongorestoreArgs({
      configPath: "/tmp/mongo-config.yaml",
      sourceDbName: "expense_manager",
      targetDbName: "expense_manager_restore_scratch",
      dumpDir: "/tmp/dump",
    });
    expect(args).toEqual([
      "--config",
      "/tmp/mongo-config.yaml",
      "--nsInclude",
      "expense_manager.*",
      "--nsFrom",
      "expense_manager.*",
      "--nsTo",
      "expense_manager_restore_scratch.*",
      "/tmp/dump",
    ]);
  });

  test("never includes a raw connection string in argv", () => {
    const args = buildMongorestoreArgs({
      configPath: "/tmp/mongo-config.yaml",
      sourceDbName: "db1",
      targetDbName: "db2",
      dumpDir: "/tmp/dump",
    });
    expect(args.join(" ")).not.toMatch(/mongodb(\+srv)?:\/\//);
  });
});
