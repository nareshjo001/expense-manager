#!/usr/bin/env node
"use strict";

// DAT-001-T07 -- the removal itself.
//
// This is the last engineering piece of T07. Running it is not: that needs a
// soak and a reconciliation this repository cannot produce (see the "what
// still has to happen" note at the bottom of this comment).
//
// WHY THIS IS NOT A MIGRATION, DESPITE ADR-0006
//
// Every other schema change in this project is a file under
// migrations/scripts/, applied automatically by migrations/run.js. This one
// deliberately is not, and the reason is mechanical rather than stylistic:
// run.js applies every pending migration, and a deploy pipeline calls it.
// A destructive, irreversible operation sitting in that sequence would be
// attempted on every deploy, and it would be attempted BY DEFAULT rather
// than by decision.
//
// It would also break the pipeline it sits in. The gate below refuses until
// its preconditions hold, refusal throws, and a throwing migration fails the
// whole run -- so adding this as a migration would block DAT-003-T07's
// staging apply, and every subsequent deploy's migration step, until the day
// the soak finished. The correct sequencing for "apply automatically" and
// "delete the only copy of every amount in the database" is not the same
// sequencing, and pretending otherwise is how the second one happens by
// accident.
//
// So: a separate, deliberately-invoked script. It still records itself in
// the migration ledger when it succeeds, so the audit trail is in the same
// place as everything else and a second run is a no-op rather than a
// re-attempt.
//
// WHAT IT DOES
//
// Removes the legacy float money fields -- expenseAmount, incomeAmount,
// budget, spent -- now that ADR-0003's integer `*Minor` fields are
// authoritative. Per document, and only where that document's own minor
// value exists and agrees with what the legacy value converts to. The gate
// already proved that globally; this checks it again per document, because
// the gate's reconciliation ran at a point in time and a write could have
// landed since. A document that fails the per-document check is SKIPPED and
// counted, never stripped.
//
// WHAT STILL HAS TO HAPPEN BEFORE THIS CAN RUN
//
// All of it is in migrations/legacyMoneyRemovalGate.js, which this calls
// first and which refuses unless every condition holds. In practice:
// backups running against the target environment, the backfill applied
// there, dual-write on, a recorded soak of at least 14 days (31 is the real
// bar -- recurringJob.js writes monthly), reconciliation clean across that
// window, and an explicit LEGACY_MONEY_REMOVAL_CONFIRMED=true.
//
// Usage:
//   node backend/scripts/removeLegacyMoneyFields.js --dry-run   # always do this first
//   node backend/scripts/removeLegacyMoneyFields.js
//
// Exit code: 0 on success (or a clean dry run), 1 on refusal or failure.
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

// Identical to the backfill's map (DAT-001-T04) and the reconciliation
// script's (DAT-001-T05). Kept as its own copy rather than imported from
// either, because this file must remove exactly the fields those two
// populated and verified -- if that set ever diverges, this file's copy is
// the one a reviewer should be forced to look at.
// Real MongoDB collection names, not the Mongoose model names: the
// 'budget' and 'recurringExpenses' models resolve to "budgets" and
// "recurringexpenses" (Mongoose pluralizes/lowercases; no schema sets an
// explicit `collection`). The literal model names previously used here
// matched a nonexistent collection and silently processed zero documents
// -- found by running the migrations against a restored copy of production
// (DAT-003-T07). Same correction as 20260903-backfill-money-minor-fields.js.
const FIELD_MAP = [
  { collection: "expenses", legacyField: "expenseAmount", minorField: "expenseAmountMinor" },
  { collection: "incomes", legacyField: "incomeAmount", minorField: "incomeAmountMinor" },
  { collection: "budgets", legacyField: "budget", minorField: "budgetMinor" },
  { collection: "budgets", legacyField: "spent", minorField: "spentMinor" },
  { collection: "recurringexpenses", legacyField: "expenseAmount", minorField: "expenseAmountMinor" },
];

const BATCH_SIZE = 500;

// Removes one legacy field from one collection.
//
// The filter deliberately requires the minor field to EXIST before a
// document is even considered. A document with a legacy value and no minor
// value is exactly the case that must not be touched, and excluding it in
// the query rather than in a later branch means no code path can strip it.
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

    // Re-verify per document. The gate's reconciliation was a point-in-time
    // check; a write could have landed between it and this loop. Skipping a
    // disagreement is always right here -- the legacy value is the one thing
    // that could still resolve the disagreement, so removing it would
    // destroy the evidence needed to fix it.
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

  // Documents with a legacy value and NO minor value never entered the
  // cursor. Counted separately so a non-zero value here is loud: it means
  // the backfill did not reach them and the gate's clean reconciliation was
  // measured against a different population than this operation sees.
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

  // Refuses unless every precondition provably holds, listing all failures
  // at once. A dry run is gated too: there is no reason to rehearse an
  // operation that is not allowed to happen, and letting a dry run through
  // would produce a reassuring report for a state that must not proceed.
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
    // Not recorded as applied, so a later run retries rather than believing
    // the job is finished. The removal that DID happen is not rolled back --
    // it cannot be -- but every document this could not verify still has its
    // legacy value.
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
