"use strict";

// Js (T02), and the up()/verify()/forward-fix contract ADR-0006 (T03) fixes.
const mongoose = require("mongoose");
const runner = require("./runner");
const ledger = require("./ledger");
const { withMigrationLock } = require("./lock");
const { assertSafeToRunMigrations } = require("./environmentGate");
const { logEvent } = require("../utils/logger");

// Runs pending migrations (per the ledger) in order, honoring an optional dry-run mode and an optional batch size limit.
async function runMigrations({
  dir = runner.MIGRATIONS_DIR,
  dryRun = false,
  batchSize = Infinity,
  lockTtlMs,
  allowNoBackupCheck = false,
} = {}) {
  // The environment safety gate runs before anything real happens.
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

  // DryRun, per ADR-0006) -- there is nothing to serialize against another instance, so they skip the exclusive lock real execution requires.
  const remaining = dryRun ? await execute() : await withMigrationLock(execute, lockTtlMs);

  return { dryRun, applied, remaining, failed };
}

module.exports = { runMigrations };
