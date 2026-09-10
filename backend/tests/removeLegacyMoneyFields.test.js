// DAT-001-T07 -- the removal operation.
//
// Tests focus on `removeOne`, the part that decides which documents lose
// their legacy value. The gate is tested separately
// (legacyMoneyRemovalGate.test.js); what matters here is that even AFTER the
// gate passes, this loop never strips a document it cannot verify -- because
// the gate's reconciliation was a point-in-time check and a write can land
// between it and this loop.
"use strict";

const { removeOne, FIELD_MAP, OPERATION_ID } = require("../scripts/removeLegacyMoneyFields");

// A minimal in-memory stand-in for a Mongo collection: enough to drive the
// cursor, the bulkWrite and the countDocuments this function uses.
function fakeDb(docsByCollection, { missingMinorCount = 0 } = {}) {
  const writes = [];

  return {
    writes,
    collection(name) {
      const docs = docsByCollection[name] || [];
      return {
        find(filter, _projection) {
          // Mirrors the real filter: the minor field must EXIST and be a
          // number for a document to be considered at all.
          const minorField = Object.keys(filter).find((k) => k.endsWith("Minor"));
          const legacyField = Object.keys(filter).find((k) => !k.endsWith("Minor"));
          const matched = docs.filter(
            (d) =>
              d[legacyField] !== undefined &&
              d[minorField] !== undefined &&
              typeof d[minorField] === "number"
          );
          return {
            [Symbol.asyncIterator]: async function* iterate() {
              for (const doc of matched) yield doc;
            },
          };
        },
        async bulkWrite(ops) {
          writes.push(...ops);
        },
        async countDocuments() {
          return missingMinorCount;
        },
      };
    },
  };
}

const spec = {
  collection: "expenses",
  legacyField: "expenseAmount",
  minorField: "expenseAmountMinor",
};

describe("removeOne -- which documents lose their legacy value", () => {
  test("removes the legacy field where the minor value agrees", async () => {
    const db = fakeDb({ expenses: [{ _id: "a", expenseAmount: 40.3, expenseAmountMinor: 4030 }] });

    const result = await removeOne({ db, ...spec, dryRun: false });

    expect(result.removed).toBe(1);
    expect(db.writes).toEqual([
      { updateOne: { filter: { _id: "a" }, update: { $unset: { expenseAmount: "" } } } },
    ]);
  });

  test("SKIPS a document whose minor value disagrees, and never writes for it", async () => {
    // The most important test here. The legacy value is the only thing that
    // could still resolve the disagreement, so removing it would destroy the
    // evidence needed to fix it.
    const db = fakeDb({ expenses: [{ _id: "a", expenseAmount: 40.3, expenseAmountMinor: 9999 }] });

    const result = await removeOne({ db, ...spec, dryRun: false });

    expect(result.removed).toBe(0);
    expect(result.skippedMismatch).toBe(1);
    expect(db.writes).toEqual([]);
  });

  test("skips a document whose legacy value is not a finite number", async () => {
    const db = fakeDb({
      expenses: [
        { _id: "a", expenseAmount: NaN, expenseAmountMinor: 0 },
        { _id: "b", expenseAmount: "40.30", expenseAmountMinor: 4030 },
      ],
    });

    const result = await removeOne({ db, ...spec, dryRun: false });

    expect(result.removed).toBe(0);
    expect(result.skippedMismatch).toBe(2);
    expect(db.writes).toEqual([]);
  });

  test("a document with NO minor field never enters the cursor", async () => {
    // Excluded by the query rather than by a later branch, so no code path
    // can strip it. This is the case that would destroy an amount outright.
    const db = fakeDb({ expenses: [{ _id: "a", expenseAmount: 40.3 }] });

    const result = await removeOne({ db, ...spec, dryRun: false });

    expect(result.removed).toBe(0);
    expect(db.writes).toEqual([]);
  });

  test("counts documents that have a legacy value but no minor value, loudly", async () => {
    // A non-zero count here means the backfill did not reach them and the
    // gate's clean reconciliation measured a different population than this
    // operation sees.
    const db = fakeDb({ expenses: [] }, { missingMinorCount: 12 });

    const result = await removeOne({ db, ...spec, dryRun: false });

    expect(result.missingMinor).toBe(12);
  });

  test("a dry run writes nothing but reports what it would remove", async () => {
    const db = fakeDb({
      expenses: [
        { _id: "a", expenseAmount: 40.3, expenseAmountMinor: 4030 },
        { _id: "b", expenseAmount: 10, expenseAmountMinor: 1000 },
      ],
    });

    const result = await removeOne({ db, ...spec, dryRun: true });

    expect(result.removed).toBe(2);
    expect(db.writes).toEqual([]);
  });

  test("mixed input: only the verifiable documents are written", async () => {
    const db = fakeDb({
      expenses: [
        { _id: "ok1", expenseAmount: 40.3, expenseAmountMinor: 4030 },
        { _id: "bad", expenseAmount: 40.3, expenseAmountMinor: 4031 },
        { _id: "ok2", expenseAmount: 0, expenseAmountMinor: 0 },
      ],
    });

    const result = await removeOne({ db, ...spec, dryRun: false });

    expect(result.removed).toBe(2);
    expect(result.skippedMismatch).toBe(1);
    expect(db.writes.map((w) => w.updateOne.filter._id)).toEqual(["ok1", "ok2"]);
  });

  test("zero is removable -- it is a real amount, not a missing one", async () => {
    const db = fakeDb({ expenses: [{ _id: "a", expenseAmount: 0, expenseAmountMinor: 0 }] });

    const result = await removeOne({ db, ...spec, dryRun: false });

    expect(result.removed).toBe(1);
  });

  test("rounding follows ADR-0003, so a half-paise value is not treated as a mismatch", async () => {
    // 49.995 rupees rounds half-away-from-zero to 5000 paise. If this used a
    // different rule than toMinorUnits, every such document would be
    // reported as a mismatch and its legacy field kept forever.
    const db = fakeDb({ expenses: [{ _id: "a", expenseAmount: 49.995, expenseAmountMinor: 5000 }] });

    const result = await removeOne({ db, ...spec, dryRun: false });

    expect(result.removed).toBe(1);
    expect(result.skippedMismatch).toBe(0);
  });
});

describe("the field set", () => {
  test("covers exactly the fields the backfill populated", async () => {
    // If this set ever diverges from the backfill's and the reconciliation
    // script's, this file's copy is the one a reviewer is forced to look at.
    expect(FIELD_MAP).toEqual([
      { collection: "expenses", legacyField: "expenseAmount", minorField: "expenseAmountMinor" },
      { collection: "incomes", legacyField: "incomeAmount", minorField: "incomeAmountMinor" },
      { collection: "budget", legacyField: "budget", minorField: "budgetMinor" },
      { collection: "budget", legacyField: "spent", minorField: "spentMinor" },
      { collection: "recurringExpenses", legacyField: "expenseAmount", minorField: "expenseAmountMinor" },
    ]);
  });

  test("matches the reconciliation script's map exactly", async () => {
    // These two must agree, or the gate verifies one population and this
    // operation modifies another.
    const { FIELD_MAP: verifyMap } = require("../scripts/verifyMoneyMinorFields");
    expect(FIELD_MAP).toEqual(verifyMap);
  });

  test("has a stable ledger id, so a second run is a no-op rather than a re-attempt", () => {
    expect(OPERATION_ID).toBe("20260910-remove-legacy-money-fields");
  });
});

describe("this is deliberately NOT an automatic migration", () => {
  test("no migration file performs the removal", () => {
    // A destructive irreversible operation must not sit in the sequence
    // migrations/run.js applies on every deploy. It would also break that
    // pipeline: the gate refuses until the soak finishes, refusal throws,
    // and a throwing migration fails the whole run -- blocking
    // DAT-003-T07's staging apply and every later deploy's migration step.
    const fs = require("fs");
    const path = require("path");
    const dir = path.join(__dirname, "..", "migrations", "scripts");

    for (const file of fs.readdirSync(dir)) {
      const source = fs.readFileSync(path.join(dir, file), "utf8");
      expect(source).not.toMatch(/\$unset[\s\S]{0,120}expenseAmount"?\s*:/);
      expect(source).not.toContain("removeLegacyMoneyFields");
    }
  });
});
