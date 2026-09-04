// DAT-003-T01 -- backend/migrations/runner.js
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  validateMigrationModule,
  loadMigrationFilenames,
  loadMigrations,
  planPending,
} = require("../migrations/runner");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "migrations-test-"));
}

function writeMigrationFile(dir, filename, contents) {
  fs.writeFileSync(path.join(dir, filename), contents, "utf8");
}

describe("validateMigrationModule", () => {
  test("accepts a well-formed migration module", () => {
    expect(() =>
      validateMigrationModule(
        { id: "20260101-x", description: "does x", up: async () => {} },
        "20260101-x.js"
      )
    ).not.toThrow();
  });

  test("accepts a well-formed module that also has a verify function", () => {
    expect(() =>
      validateMigrationModule(
        { id: "20260101-x", description: "does x", up: async () => {}, verify: async () => {} },
        "20260101-x.js"
      )
    ).not.toThrow();
  });

  test.each(["id", "description", "up"])("throws naming the filename when \"%s\" is missing", (missingKey) => {
    const mod = { id: "20260101-x", description: "does x", up: async () => {} };
    delete mod[missingKey];
    expect(() => validateMigrationModule(mod, "bad-migration.js")).toThrow(/bad-migration\.js/);
    expect(() => validateMigrationModule(mod, "bad-migration.js")).toThrow(new RegExp(missingKey));
  });

  test("throws when id is an empty string", () => {
    expect(() =>
      validateMigrationModule({ id: "  ", description: "d", up: async () => {} }, "f.js")
    ).toThrow(/"id"/);
  });

  test("throws when description is an empty string", () => {
    expect(() =>
      validateMigrationModule({ id: "x", description: "", up: async () => {} }, "f.js")
    ).toThrow(/"description"/);
  });

  test("throws when up is not a function", () => {
    expect(() =>
      validateMigrationModule({ id: "x", description: "d", up: "not-a-function" }, "f.js")
    ).toThrow(/"up"/);
  });

  test("throws when verify is present but not a function", () => {
    expect(() =>
      validateMigrationModule(
        { id: "x", description: "d", up: async () => {}, verify: "nope" },
        "f.js"
      )
    ).toThrow(/"verify"/);
  });

  test("throws when the module itself is not an object", () => {
    expect(() => validateMigrationModule(null, "f.js")).toThrow(/must export an object/);
    expect(() => validateMigrationModule(undefined, "f.js")).toThrow(/must export an object/);
  });
});

describe("loadMigrationFilenames", () => {
  test("returns an empty array when the directory does not exist", () => {
    const missingDir = path.join(os.tmpdir(), "migrations-test-does-not-exist-" + Date.now());
    expect(loadMigrationFilenames(missingDir)).toEqual([]);
  });

  test("returns .js files in lexicographic (chronological-by-convention) order", () => {
    const dir = makeTempDir();
    writeMigrationFile(dir, "20260901-b.js", "module.exports = {};");
    writeMigrationFile(dir, "20260801-a.js", "module.exports = {};");
    writeMigrationFile(dir, "README.md", "not a migration");

    expect(loadMigrationFilenames(dir)).toEqual(["20260801-a.js", "20260901-b.js"]);
  });
});

describe("loadMigrations", () => {
  test("returns [] for an empty/missing directory", () => {
    const missingDir = path.join(os.tmpdir(), "migrations-test-does-not-exist-2-" + Date.now());
    expect(loadMigrations(missingDir)).toEqual([]);
  });

  test("loads and validates every migration file, preserving discovery order", () => {
    const dir = makeTempDir();
    writeMigrationFile(
      dir,
      "20260801-a.js",
      'module.exports = { id: "20260801-a", description: "first", up: async () => {} };'
    );
    writeMigrationFile(
      dir,
      "20260901-b.js",
      'module.exports = { id: "20260901-b", description: "second", up: async () => {}, verify: async () => {} };'
    );

    const migrations = loadMigrations(dir);

    expect(migrations).toHaveLength(2);
    expect(migrations[0]).toMatchObject({ filename: "20260801-a.js", id: "20260801-a", description: "first" });
    expect(typeof migrations[0].up).toBe("function");
    expect(migrations[0].verify).toBeUndefined();
    expect(migrations[1]).toMatchObject({ filename: "20260901-b.js", id: "20260901-b", description: "second" });
    expect(typeof migrations[1].verify).toBe("function");
  });

  test("throws, naming the filename, when one migration file is malformed", () => {
    const dir = makeTempDir();
    writeMigrationFile(
      dir,
      "20260801-good.js",
      'module.exports = { id: "20260801-good", description: "ok", up: async () => {} };'
    );
    writeMigrationFile(dir, "20260901-bad.js", "module.exports = { id: \"only-id\" };");

    expect(() => loadMigrations(dir)).toThrow(/20260901-bad\.js/);
  });
});

describe("planPending", () => {
  test("treats every discovered migration as pending (no ledger exists yet)", () => {
    const dir = makeTempDir();
    writeMigrationFile(
      dir,
      "20260801-a.js",
      'module.exports = { id: "20260801-a", description: "first", up: async () => {} };'
    );

    expect(planPending(dir)).toEqual([
      { id: "20260801-a", description: "first", filename: "20260801-a.js" },
    ]);
  });

  test("returns [] when no migrations have been authored yet", () => {
    const dir = makeTempDir();
    expect(planPending(dir)).toEqual([]);
  });
});
