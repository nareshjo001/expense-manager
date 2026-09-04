"use strict";

// DAT-003-T04 -- the actual migration execution driver: dry-run and
// batch/resume support, built on runner.js (T01, discovery), lock.js and
// ledger.js (T02), and the up()/verify()/forward-fix contract ADR-0006
// (T03) fixes. This is the first place anything actually calls a
// migration's up().
const mongoose = require("mongoose");
const runner = require("./runner");
const ledger = require("./ledger");
const { withMigrationLock } = require("./lock");
const { assertSafeToRunMigrations } = require("./environmentGate");
const { logEvent } = require("../utils/logger");

// Runs pending migrations (per the ledger) in order, honoring an
// optional dry-run mode and an optional batch size limit.
//
// "Resume" is implicit rather than a separate flag/state: a partial or
// failed run simply stops, and the ledger accurately reflects exactly
// what succeeded -- the next invocation's planPending() picks up right
// where it left off. There is nothing else to resume from.
//
// Stops at the first failing migration rather than skipping ahead to the
// next one. Per ADR-0006, a migration whose up() or verify() throws is
// not recorded as applied; running a later migration while an earlier
// one is in an unknown state would violate each migration's
// single-logical-change assumption and could compound the failure.
//
// Returns:
//   { dryRun, applied: [{id, durationMs}], remaining: [id, ...], failed: {id, error} | null }
// `remaining` always lists every pending id that was not successfully
// applied this run, in order -- whether because of the batch-size limit
// or because a failure stopped the run early (the failed id is first).
async function runMigrations({
  dir = runner.MIGRATIONS_DIR,
  dryRun = false,
  batchSize = Infinity,
  lockTtlMs,
  allowNoBackupCheck = false,
} = {}) {
  // DAT-003-T05 -- the environment safety gate runs before anything real
  // happens. Dry runs skip it too: a dry run makes no writes, so there is
  // nothing for the gate to protect against.
  if (!dryRun) {
    await assertSafeToRunMigrations({ allowNoBackupCheck });
  }

  const applied = [];
  let failed = null;

  const execute = async () => {
    const pending = await ledger.planPending(dir);
    const toRun = pending.slice(0, batchSize);
    const notInBatch = pending.slice(toRun.length).map((m) => m.id);

    for (let i = 0; i < toRun.length; i += 1) {
      const planned = toRun[i];
      const migrations = runner.loadMigrations(dir);
      const migration = migrations.find((m) => m.id === planned.id);

      const boundLogger = {
        info: (fields) =>
          logEvent({ level: "info", scope: "migrations", migrationId: migration.id, ...fields }),
        warn: (fields) =>
          logEvent({ level: "warn", scope: "migrations", migrationId: migration.id, ...fields }),
        error: (fields) =>
          logEvent({ level: "error", scope: "migrations", migrationId: migration.id, ...fields }),
      };
      const context = { mongoose, logger: boundLogger, dryRun };
      const startedAt = Date.now();

      boundLogger.info({ event: "migration_start", dryRun });

      try {
        // eslint-disable-next-line no-await-in-loop
        await migration.up(context);
        if (!dryRun && typeof migration.verify === "function") {
          // eslint-disable-next-line no-await-in-loop
          await migration.verify(context);
        }
      } catch (err) {
        boundLogger.error({ event: "migration_failed", errorMessage: err && err.message });
        failed = { id: migration.id, error: err };
        const notAttempted = toRun.slice(i).map((m) => m.id);
        return [...notAttempted, ...notInBatch];
      }

      const durationMs = Date.now() - startedAt;
      if (!dryRun) {
        // eslint-disable-next-line no-await-in-loop
        await ledger.recordApplied({ id: migration.id, description: migration.description, durationMs });
      }
      boundLogger.info({
        event: dryRun ? "migration_dry_run_ok" : "migration_applied",
        durationMs,
      });
      applied.push({ id: migration.id, durationMs });
    }

    return notInBatch;
  };

  // Dry runs never mutate the ledger or real data (assuming migrations
  // honor context.dryRun, per ADR-0006) -- there is nothing to
  // serialize against another instance, so they skip the exclusive lock
  // real execution requires. A migration that ignores dryRun and writes
  // anyway is an authoring bug ADR-0006 already calls out, not something
  // this driver can detect for it.
  const remaining = dryRun ? await execute() : await withMigrationLock(execute, lockTtlMs);

  return { dryRun, applied, remaining, failed };
}

module.exports = { runMigrations };
