// DAT-003-T07 regression guard -- every string-keyed db.collection(...)
// name used by a migration or by the money-field verify/remove scripts
// must be a REAL MongoDB collection name, i.e. the name a registered
// Mongoose model actually resolves to.
//
// Why this exists: those scripts bypass the Models and address collections
// by literal string. "budget" and "recurringExpenses" (the Mongoose MODEL
// names) were used where the real collections are "budgets" and
// "recurringexpenses", so every run silently matched zero documents -- and
// verify() passed, because an empty collection has nothing left to fix.
// Each script's own unit test used a fake db keyed by the same wrong
// strings, so none of them could catch it. Running the migrations against a
// restored copy of production did. This test closes that gap without a
// database: it records which collection names each script touches and
// checks them against the models.
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

// Register every model so mongoose.modelNames() covers all of them.
require("../config/Schemas");
const modelsDir = path.join(__dirname, "..", "models");
for (const file of fs.readdirSync(modelsDir)) {
  if (file.endsWith(".js")) require(path.join(modelsDir, file));
}

const REAL_COLLECTIONS = new Set(
  mongoose.modelNames().map((name) => mongoose.model(name).collection.name)
);

// A fake db that records every collection name asked for and behaves as an
// empty database, so each script's up() runs to completion.
function makeRecordingDb() {
  const names = new Set();
  const db = {
    collection(name) {
      names.add(name);
      return {
        find: () => ({ async *[Symbol.asyncIterator]() {} }),
        bulkWrite: async () => ({}),
        updateMany: async () => ({ modifiedCount: 0, matchedCount: 0 }),
        countDocuments: async () => 0,
        createIndex: async () => "ok",
        indexes: async () => [],
      };
    },
  };
  return { db, names };
}

const logger = { info() {}, warn() {}, error() {} };

describe("real collection names", () => {
  test("sanity: the models resolve to the pluralized, lowercased names", () => {
    expect(REAL_COLLECTIONS.has("budgets")).toBe(true);
    expect(REAL_COLLECTIONS.has("recurringexpenses")).toBe(true);
    expect(REAL_COLLECTIONS.has("budget")).toBe(false);
    expect(REAL_COLLECTIONS.has("recurringExpenses")).toBe(false);
  });

  const scriptsDir = path.join(__dirname, "..", "migrations", "scripts");
  const migrationFiles = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".js"));

  test.each(migrationFiles)("migration %s only touches real collections", async (file) => {
    const migration = require(path.join(scriptsDir, file));
    const { db, names } = makeRecordingDb();

    await migration.up({ mongoose: { connection: { db } }, logger, dryRun: false });

    expect(names.size).toBeGreaterThan(0);
    for (const name of names) {
      expect({ file, name, real: REAL_COLLECTIONS.has(name) }).toEqual({ file, name, real: true });
    }
  });

  test.each([
    ["verifyMoneyMinorFields", require("../scripts/verifyMoneyMinorFields").FIELD_MAP],
    ["removeLegacyMoneyFields", require("../scripts/removeLegacyMoneyFields").FIELD_MAP],
  ])("%s FIELD_MAP only names real collections", (script, fieldMap) => {
    for (const { collection } of fieldMap) {
      expect({ script, collection, real: REAL_COLLECTIONS.has(collection) }).toEqual({
        script,
        collection,
        real: true,
      });
    }
  });
});
