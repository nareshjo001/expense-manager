#!/usr/bin/env node
"use strict";

// The removal itself. This is the last engineering piece of T07.
require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { logEvent } = require("../utils/logger");
const { toMinorUnits } = require("../utils/money");
const {
  assertLegacyMoneyRemovalSafe,
  LegacyMoneyRemovalBlocked,
} = require("../migrations/legacyMoneyRemovalGate");
const ledger = require("../migrations/ledger");

// Recorded in the ledger on success, so this shows up alongside the
// migrations in the same audit trail and cannot be silently run twice.
const OPERATION_ID = "20260910-remove-legacy-money-fields";

// Identical to the backfill's map (DAT-001-T04) and the reconciliation script's (DAT-001-T05).
const FIELD_MAP = [
  { collection: "expenses", legacyField: "expenseAmount", minorField: "expenseAmountMinor" },
  { collection: "incomes", legacyField: "incomeAmount", minorField: "incomeAmountMinor" },
  { collection: "budgets", legacyField: "budget", minorField: "budgetMinor" },
  { collection: "budgets", legacyField: "spent", minorField: "spentMinor" },
  { collection: "recurringexpenses", legacyField: "expenseAmount", minorField: "expenseAmountMinor" },
];

const BATCH_SIZE = 500;

// Removes one legacy field from one collection.
async function removeOne({ db, collection, legacyField, minorField, dryRun }) {
  const coll = db.collection(collection);
  const cursor = coll.find(
    {
      [legacyField]: { $exists: true },
      [minorField]: { $exists: true, $type: "number" },
    },
    { projection: { [legacyField]: 1, [minorField]: 1 } }
  );

  let batch = [];
  let removed = 0;
  let skippedMismatch = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    if (!dryRun) await coll.bulkWrite(batch, { ordered: false });
    removed += batch.length;
    batch = [];
  };

  for await (const doc of cursor) {
    const legacyValue = doc[legacyField];
    const storedMinor = doc[minorField];

    // Re-verify per document. The gate's reconciliation was a point-in-time check; a write could have landed between it and this loop.
    const expected =
      typeof legacyValue === "number" && Number.isFinite(legacyValue) ? toMinorUnits(legacyValue) : null;

    if (expected === null || expected !== storedMinor) {
      skippedMismatch += 1;
      continue;
    }

    batch.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $unset: { [legacyField]: "" } },
      },
    });
    if (batch.length >= BATCH_SIZE) {
      await flush();
    }
  }
  await flush();

  // Documents with a legacy value and NO minor value never entered the cursor.
  const missingMinor = await coll.countDocuments({
    [legacyField]: { $exists: true },
    [minorField]: { $exists: false },
  });

  return { collection, legacyField, removed, skippedMismatch, missingMinor };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  await connectDB();
  const db = mongoose.connection.db;

  // Refuses unless every precondition provably holds, listing all failures at once.
  let gate;
  try {
    gate = await assertLegacyMoneyRemovalSafe({ db });
  } catch (err) {
    if (err instanceof LegacyMoneyRemovalBlocked) {
      console.error(err.message);
      await mongoose.disconnect();
      return 1;
    }
    throw err;
  }

  for (const warning of gate.warnings) console.error(`WARNING: ${warning}`);

  if (!dryRun && (await ledger.isApplied(OPERATION_ID))) {
    console.log(`${OPERATION_ID} is already recorded as applied. Nothing to do.`);
    await mongoose.disconnect();
    return 0;
  }

  const startedAt = Date.now();
  const results = [];
  for (const spec of FIELD_MAP) {
    results.push(await removeOne({ db, ...spec, dryRun }));
  }

  const totals = results.reduce(
    (acc, r) => ({
      removed: acc.removed + r.removed,
      skippedMismatch: acc.skippedMismatch + r.skippedMismatch,
      missingMinor: acc.missingMinor + r.missingMinor,
    }),
    { removed: 0, skippedMismatch: 0, missingMinor: 0 }
  );

  console.log(JSON.stringify({ dryRun, totals, results }, null, 2));

  const unsafe = totals.skippedMismatch > 0 || totals.missingMinor > 0;
  if (unsafe) {
    // Not recorded as applied, so a later run retries rather than believing the job is finished.
    logEvent({
      level: "error",
      scope: "dat-001-t07",
      event: "legacy_removal_incomplete",
      skippedMismatch: totals.skippedMismatch,
      missingMinor: totals.missingMinor,
    });
    console.error(
      `\nINCOMPLETE: ${totals.skippedMismatch} document(s) disagreed with their minor value and ` +
        `${totals.missingMinor} had no minor value at all. Those keep their legacy field. ` +
        "Investigate before re-running -- the gate reported a clean reconciliation, so this " +
        "disagreement means the population changed underneath it."
    );
    await mongoose.disconnect();
    return 1;
  }

  if (dryRun) {
    console.log(`\nDry run: would remove ${totals.removed} legacy field value(s). Nothing was written.`);
  } else {
    await ledger.recordApplied({
      id: OPERATION_ID,
      description: "DAT-001-T07: remove the legacy float money fields, ADR-0003 cutover complete.",
      durationMs: Date.now() - startedAt,
    });
    logEvent({
      level: "info",
      scope: "dat-001-t07",
      event: "legacy_removal_complete",
      removed: totals.removed,
      durationMs: Date.now() - startedAt,
    });
    console.log(`\nRemoved ${totals.removed} legacy field value(s). Recorded as ${OPERATION_ID}.`);
  }

  await mongoose.disconnect();
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error("removeLegacyMoneyFields failed:", err && err.message);
      process.exit(1);
    });
}

module.exports = { FIELD_MAP, OPERATION_ID, removeOne };
