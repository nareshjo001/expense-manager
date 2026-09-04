/* verifyMoneyMinorFields.js -- DAT-001-T05
 *
 * Dual-read verification for the rollout ADR-0003 (DAT-001) is midway
 * through: for every document that has BOTH a legacy money field and its
 * *Minor shadow field (backfilled by the
 * 20260903-backfill-money-minor-fields migration, DAT-001-T04), recomputes
 * the shadow value from the legacy value with the same toMinorUnits()
 * rule the application itself uses (DAT-001-T03), and reports any
 * disagreement.
 *
 * This is READ-ONLY -- it never writes to the database. It is the
 * evidence DAT-001-T06 needs before switching any API/frontend path over
 * to the *Minor fields, and the evidence DAT-001-T07 needs before the
 * legacy fields can ever be removed. A clean run (0 mismatches, 0
 * missing) is not itself sufficient to green-light T06/T07 on its own --
 * it should be run repeatedly across a real rollout window (new writes
 * keep landing the whole time), not just once.
 *
 * Usage: node backend/scripts/verifyMoneyMinorFields.js
 * Exit code: 0 if every checked document matched and none were missing
 * its shadow field; 1 otherwise (so this can gate a CI/deploy step).
 */
"use strict";

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const { toMinorUnits } = require("../utils/money");

const FIELD_MAP = [
  { collection: "expenses", legacyField: "expenseAmount", minorField: "expenseAmountMinor" },
  { collection: "incomes", legacyField: "incomeAmount", minorField: "incomeAmountMinor" },
  { collection: "budget", legacyField: "budget", minorField: "budgetMinor" },
  { collection: "budget", legacyField: "spent", minorField: "spentMinor" },
  { collection: "recurringExpenses", legacyField: "expenseAmount", minorField: "expenseAmountMinor" },
];

const MISMATCH_SAMPLE_LIMIT = 20;

// Compares every document that has both fields set, recomputing the
// expected minor value from the legacy value rather than trusting
// whatever the shadow field says. Also separately counts documents that
// have the legacy value but no shadow field yet (the backfill migration
// hasn't reached them, or a write path hasn't started dual-writing).
async function verifyCollectionField({ db, collection, legacyField, minorField }) {
  const coll = db.collection(collection);
  const cursor = coll.find(
    { [legacyField]: { $exists: true, $type: "number" }, [minorField]: { $exists: true, $type: "number" } },
    { projection: { [legacyField]: 1, [minorField]: 1 } }
  );

  let checked = 0;
  let mismatches = 0;
  const mismatchSamples = [];

  // eslint-disable-next-line no-restricted-syntax
  for await (const doc of cursor) {
    checked += 1;
    const expectedMinor = toMinorUnits(doc[legacyField]);
    if (expectedMinor !== doc[minorField]) {
      mismatches += 1;
      if (mismatchSamples.length < MISMATCH_SAMPLE_LIMIT) {
        mismatchSamples.push({
          docId: String(doc._id),
          legacyValue: doc[legacyField],
          storedMinor: doc[minorField],
          expectedMinor,
        });
      }
    }
  }

  const missingMinor = await coll.countDocuments({
    [legacyField]: { $exists: true, $type: "number" },
    [minorField]: { $exists: false },
  });

  return { collection, legacyField, minorField, checked, mismatches, missingMinor, mismatchSamples };
}

async function verifyAll(db) {
  const results = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const spec of FIELD_MAP) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await verifyCollectionField({ db, ...spec }));
  }
  return results;
}

function summarize(results) {
  const totalChecked = results.reduce((sum, r) => sum + r.checked, 0);
  const totalMismatches = results.reduce((sum, r) => sum + r.mismatches, 0);
  const totalMissing = results.reduce((sum, r) => sum + r.missingMinor, 0);
  return { totalChecked, totalMismatches, totalMissing, clean: totalMismatches === 0 && totalMissing === 0 };
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;
  const results = await verifyAll(db);
  const summary = summarize(results);

  console.log(JSON.stringify({ summary, results }, null, 2));

  if (!summary.clean) {
    console.error(
      `verifyMoneyMinorFields: NOT clean -- ${summary.totalMismatches} mismatch(es), ` +
        `${summary.totalMissing} document(s) still missing their shadow field. ` +
        "Do not proceed with DAT-001-T06 until this is clean across a real rollout window."
    );
  }

  await mongoose.disconnect();
  process.exitCode = summary.clean ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("verifyMoneyMinorFields crashed:", err);
    process.exit(1);
  });
}

module.exports = { FIELD_MAP, verifyCollectionField, verifyAll, summarize };
