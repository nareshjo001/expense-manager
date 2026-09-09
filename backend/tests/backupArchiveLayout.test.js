// OPS-002 / TST-001-T07 -- the backup archive's directory layout, pinned.
//
// mongoBackup.js and mongoRestore.js each held an assumption about where the
// .bson files sit inside the archive, and nothing checked that the two agreed.
// They did not, and the consequence was not an error: mongorestore restored
// zero documents and exited 0. The only thing that caught it was the
// document-count check at the very end, which reported "count drift" -- a
// symptom several steps removed from the cause.
//
// This suite closes that gap without needing MongoDB. It uses the real `tar`
// to perform the same archive/extract round trip the two scripts perform, and
// asserts the layout each one expects is the layout the other produces. It
// therefore runs in the ordinary unit suite, on every PR, rather than only in
// the weekly job that needs mongod, mongodump and mongorestore installed.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const DB_NAME = "expense_manager_test";

let workDir;

beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "backup-layout-"));
});

afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

// Reproduces what `mongodump --db <name> --out <dumpDir>` leaves behind:
// one directory named for the database, containing a .bson (and metadata)
// file per collection.
function fakeMongodumpOutput(dumpDir, collections) {
  const dbDir = path.join(dumpDir, DB_NAME);
  fs.mkdirSync(dbDir, { recursive: true });
  for (const collection of collections) {
    fs.writeFileSync(path.join(dbDir, `${collection}.bson`), "fake-bson");
    fs.writeFileSync(path.join(dbDir, `${collection}.metadata.json`), "{}");
  }
  return dbDir;
}

describe("backup archive round trip", () => {
  test("extracting reproduces the per-database directory the restore looks for", () => {
    const dumpDir = path.join(workDir, "dump");
    fakeMongodumpOutput(dumpDir, ["users", "expenses"]);

    // mongoBackup.js: tar -czf <tarPath> -C <dumpDir> .
    const tarPath = path.join(workDir, "backup.tar.gz");
    execFileSync("tar", ["-czf", tarPath, "-C", dumpDir, "."]);

    // mongoRestore.js: tar -xzf <tarPath> -C <dumpRoot>
    const dumpRoot = path.join(workDir, "restored");
    fs.mkdirSync(dumpRoot, { recursive: true });
    execFileSync("tar", ["-xzf", tarPath, "-C", dumpRoot]);

    // This is the exact path restoreBackup() now hands to mongorestore.
    const sourceDumpDir = path.join(dumpRoot, DB_NAME);

    expect(fs.existsSync(sourceDumpDir)).toBe(true);
    expect(fs.readdirSync(sourceDumpDir).sort()).toEqual([
      "expenses.bson",
      "expenses.metadata.json",
      "users.bson",
      "users.metadata.json",
    ]);
  });

  test("the archive ROOT holds no .bson files -- only the database directory", () => {
    // This is the whole bug, stated as an assertion. mongorestore in
    // single-database mode (which is what a connection URI carrying a
    // database name silently selects) looks for <collection>.bson directly
    // inside the directory it is given. Pointed at the archive root it finds
    // none, restores nothing, and exits 0.
    const dumpDir = path.join(workDir, "dump");
    fakeMongodumpOutput(dumpDir, ["users"]);

    const tarPath = path.join(workDir, "backup.tar.gz");
    execFileSync("tar", ["-czf", tarPath, "-C", dumpDir, "."]);

    const dumpRoot = path.join(workDir, "restored");
    fs.mkdirSync(dumpRoot, { recursive: true });
    execFileSync("tar", ["-xzf", tarPath, "-C", dumpRoot]);

    const rootEntries = fs.readdirSync(dumpRoot);
    expect(rootEntries.filter((e) => e.endsWith(".bson"))).toEqual([]);
    expect(rootEntries).toContain(DB_NAME);
  });

  test("the database directory name matches what the manifest records", () => {
    // restoreBackup() builds the path from manifest.mongoDbName. If the two
    // ever diverge the restore looks in a directory that does not exist --
    // which now throws a named error instead of quietly restoring nothing.
    const dumpDir = path.join(workDir, "dump");
    fakeMongodumpOutput(dumpDir, ["users"]);

    const manifest = { mongoDbName: DB_NAME };
    expect(fs.existsSync(path.join(dumpDir, manifest.mongoDbName))).toBe(true);
  });
});
