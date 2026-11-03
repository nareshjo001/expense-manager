"use strict";

// The interlock that must pass before the legacy float money fields can be removed.
const { isRecentBackupAvailable } = require("../scripts/backup/checkRecentBackup");
const { verifyAll, summarize } = require("../scripts/verifyMoneyMinorFields");
const ledger = require("./ledger");

// T04's backfill. Without it, documents written before the *Minor fields existed have no integer value at all -- so removing the legacy field.
const BACKFILL_MIGRATION_ID = "20260903-backfill-money-minor-fields";

// How long dual-write must have been running before removal is allowed.
const MIN_SOAK_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseSoakStart(env) {
  const raw = env.MONEY_MINOR_SOAK_STARTED_AT;
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const parsed = new Date(raw.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Evaluates every precondition. Returns { safe, blockers, warnings, evidence }.
async function checkLegacyMoneyRemovalPreconditions({
  db,
  env = process.env,
  now = () => Date.now(),
} = {}) {
  const blockers = [];
  const warnings = [];
  const evidence = {};

  // 1. Dual-write must be ON, or new writes are landing with no integer value even while the backfill has covered every old document.
  const dualWriteEnabled = env.MONEY_MINOR_DUAL_WRITE_ENABLED === "true";
  evidence.dualWriteEnabled = dualWriteEnabled;
  if (!dualWriteEnabled) {
    blockers.push(
      "MONEY_MINOR_DUAL_WRITE_ENABLED is not \"true\". New writes are not populating the " +
        "*Minor fields, so removing the legacy fields would lose every amount written from " +
        "now on. Enable dual-write and let it soak before removal."
    );
  }

  // 2. The backfill must be recorded as applied, in THIS environment's ledger.
  let backfillApplied = false;
  let ledgerUnreadable = false;
  try {
    backfillApplied = await ledger.isApplied(BACKFILL_MIGRATION_ID);
  } catch (err) {
    // Fail closed: an unreadable ledger means "I cannot tell", and for a
    // one-way door that must mean no.
    ledgerUnreadable = true;
    blockers.push(
      `Could not read the migration ledger to confirm ${BACKFILL_MIGRATION_ID} was applied ` +
        `(${err && err.message}). Refusing rather than assuming.`
    );
  }
  evidence.backfillApplied = backfillApplied;
  // Guarded by an explicit flag rather than by inspecting the blocker strings: matching on message text to decide control flow breaks the moment someone rewords a message, and the failure would be a DUPLICATE blocker on a path that is already refusing -- harmless here, but the same pattern silently drops a blocker if the polarity flips.
  if (!backfillApplied && !ledgerUnreadable) {
    blockers.push(
      `The backfill migration ${BACKFILL_MIGRATION_ID} is not recorded as applied in this ` +
        "environment. Documents predating the *Minor fields have no integer value, so removal " +
        "would erase their amounts rather than change how they are stored."
    );
  }

  // 3. Reconciliation must be clean: zero mismatches AND zero documents
  //    missing their shadow value.
  let summary = null;
  try {
    summary = summarize(await verifyAll(db));
  } catch (err) {
    blockers.push(`Reconciliation could not be run (${err && err.message}). Refusing rather than assuming.`);
  }
  evidence.reconciliation = summary;
  if (summary && !summary.clean) {
    blockers.push(
      `Reconciliation is not clean: ${summary.totalMismatches} mismatch(es) and ` +
        `${summary.totalMissing} document(s) missing their *Minor field, across ` +
        `${summary.totalChecked} checked. Every one of those is an amount that would be lost ` +
        "or silently changed by removal."
    );
  }
  if (summary && summary.clean && summary.totalChecked === 0) {
    // A clean run over zero documents is not evidence of anything, and is
    // the most misleading possible pass: it reads as green.
    blockers.push(
      "Reconciliation checked 0 documents. A clean result over an empty set proves nothing -- " +
        "either this environment has no data (so it is not the one to validate against) or the " +
        "*Minor fields are absent everywhere."
    );
  }

  // 4. A recent verified backup must exist.
  let recentBackup = false;
  try {
    recentBackup = await isRecentBackupAvailable({ env, now });
  } catch {
    recentBackup = false;
  }
  evidence.recentBackup = recentBackup;
  if (!recentBackup) {
    blockers.push(
      "No recent verified backup found at the configured destination. Removing the legacy " +
        "fields without one means a mistake is unrecoverable. See " +
        "docs/runbooks/OPS-002-backup-restore-operations.md."
    );
  }

  // 5. A declared soak window, long enough to have observed real traffic.
  const soakStart = parseSoakStart(env);
  evidence.soakStartedAt = soakStart ? soakStart.toISOString() : null;
  if (!soakStart) {
    blockers.push(
      "MONEY_MINOR_SOAK_STARTED_AT is unset or unparseable. Set it to the ISO date dual-write " +
        "was enabled in this environment, so the soak length is a recorded fact rather than a " +
        "recollection."
    );
  } else {
    const soakDays = (now() - soakStart.getTime()) / MS_PER_DAY;
    evidence.soakDays = Math.floor(soakDays);
    if (soakDays < MIN_SOAK_DAYS) {
      blockers.push(
        `Dual-write has soaked ${Math.floor(soakDays)} day(s); ${MIN_SOAK_DAYS} are required. ` +
          "A single clean reconciliation proves the documents that exist agree, not that every " +
          "write path populates the shadow field."
      );
    } else if (soakDays < 31) {
      // Not a blocker, because the floor was met -- but the honest caveat.
      warnings.push(
        `The soak is ${Math.floor(soakDays)} days. cron/recurringJob.js writes monthly, so a ` +
          "window under ~31 days has probably never observed that path populating a *Minor " +
          "field. Confirm at least one recurring occurrence was created during the soak."
      );
    }
  }

  // 6. An explicit affirmative signal.
  const confirmed = env.LEGACY_MONEY_REMOVAL_CONFIRMED === "true";
  evidence.confirmed = confirmed;
  if (!confirmed) {
    blockers.push(
      "LEGACY_MONEY_REMOVAL_CONFIRMED is not \"true\". This operation is irreversible, so it " +
        "requires an explicit signal that someone meant to run it, not merely an environment " +
        "where the other checks happen to pass."
    );
  }

  return { safe: blockers.length === 0, blockers, warnings, evidence };
}

class LegacyMoneyRemovalBlocked extends Error {
  constructor(blockers) {
    super(
      "Refusing to remove the legacy money fields -- this is irreversible and the " +
        `preconditions are not met:\n${blockers.map((b) => `  - ${b}`).join("\n")}`
    );
    this.name = "LegacyMoneyRemovalBlocked";
    this.blockers = blockers;
  }
}

// Throws unless every precondition passes. This is what a removal migration
// calls first.
async function assertLegacyMoneyRemovalSafe(options = {}) {
  const result = await checkLegacyMoneyRemovalPreconditions(options);
  if (!result.safe) throw new LegacyMoneyRemovalBlocked(result.blockers);
  return result;
}

// CLI: report where this environment stands, without changing anything.
if (require.main === module) {
  require("dotenv").config();
  const mongoose = require("mongoose");
  const connectDB = require("../config/db");

  (async () => {
    await connectDB();
    const result = await checkLegacyMoneyRemovalPreconditions({ db: mongoose.connection.db });

    console.log(JSON.stringify(result, null, 2));

    if (result.safe) {
      console.log(
        "\nEvery precondition passes. This does NOT mean DAT-001-T07 is done -- the removal " +
          "migration still has to be written and run. It means running it would not be reckless."
      );
    } else {
      console.error(`\n${result.blockers.length} blocker(s) -- see above. Removal refused.`);
    }
    for (const warning of result.warnings) console.error(`WARNING: ${warning}`);

    await mongoose.disconnect();
    process.exitCode = result.safe ? 0 : 1;
  })().catch((err) => {
    console.error("legacyMoneyRemovalGate crashed:", err && err.message);
    process.exit(1);
  });
}

module.exports = {
  BACKFILL_MIGRATION_ID,
  MIN_SOAK_DAYS,
  checkLegacyMoneyRemovalPreconditions,
  assertLegacyMoneyRemovalSafe,
  LegacyMoneyRemovalBlocked,
};
