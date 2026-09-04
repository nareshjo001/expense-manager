"use strict";

// DAT-003-T05 -- environment safety gate. Deliberately self-contained:
// it refuses to run non-dry-run migrations against any environment that
// has not been explicitly, deliberately marked ready -- fail closed on
// the unknown, exactly like lock.js's Redis-unreachable case (T02).
//
// OPS-002-T03 has now landed real encrypted-backup infrastructure
// (backend/scripts/backup/), so `checkRecentBackupExists` below is no
// longer the permanent stub it used to be -- it delegates to
// backend/scripts/backup/checkRecentBackup.js, which reads the
// configured backup destination's manifests and checks freshness
// against ADR-0005's RPO. Signature and fail-closed default are
// unchanged from the stub era: any error in the real check (including
// "no manifests found yet") still resolves to false, and every caller
// still treats "false" as "block."
const { logEvent } = require("../utils/logger");
const { isRecentBackupAvailable } = require("../scripts/backup/checkRecentBackup");

class EnvironmentGateError extends Error {
  constructor(message) {
    super(message);
    this.name = "EnvironmentGateError";
  }
}

// Real, actionable checks today: an operator must explicitly set
// MIGRATIONS_ENV_CONFIRMED=true to run a non-dry-run migration at all.
// This is intentionally low-tech (an env var, not a UI confirmation
// flow) because the audience is CI/deploy scripts and operators running
// the CLI directly, not an interactive human every time.
function isEnvironmentConfirmed(env = process.env) {
  return env.MIGRATIONS_ENV_CONFIRMED === "true";
}

// OPS-002-T03's real seam. Signature and fail-closed default preserved
// exactly as the pre-T03 stub required: this must resolve to `false`,
// never throw, whenever the underlying check can't positively confirm a
// recent backup -- "I couldn't tell" must mean "no," same as every
// other check in this gate.
async function checkRecentBackupExists() {
  try {
    return await isRecentBackupAvailable();
  } catch (err) {
    logEvent({
      level: "warn",
      scope: "migrations",
      event: "backup_check_error",
      errorMessage: err && err.message,
    });
    return false;
  }
}

// Throws EnvironmentGateError unless BOTH the environment has been
// explicitly confirmed AND a recent backup can be verified. `allowNoBackupCheck`
// exists only for local/dev/CI ephemeral-database runs (an isolated
// throwaway Mongo has nothing worth backing up); it must never be set in
// a real deployment path.
async function assertSafeToRunMigrations({ allowNoBackupCheck = false } = {}) {
  if (!isEnvironmentConfirmed()) {
    logEvent({ level: "error", scope: "migrations", event: "gate_env_not_confirmed" });
    throw new EnvironmentGateError(
      "Refusing to run migrations: MIGRATIONS_ENV_CONFIRMED is not set to \"true\". " +
        "Set it explicitly after confirming this is the intended target environment."
    );
  }

  if (!allowNoBackupCheck) {
    const backupOk = await checkRecentBackupExists();
    if (!backupOk) {
      logEvent({ level: "error", scope: "migrations", event: "gate_no_verified_backup" });
      throw new EnvironmentGateError(
        "Refusing to run migrations: no recent backup could be verified at the configured backup " +
          "destination (see backend/scripts/backup/checkRecentBackup.js and " +
          "docs/runbooks/OPS-002-backup-restore-operations.md). Run a backup " +
          "(node backend/scripts/backup/mongoBackup.js) or pass { allowNoBackupCheck: true } only for " +
          "an isolated/ephemeral database with nothing to lose, never for a real deployment."
      );
    }
  }

  logEvent({ level: "info", scope: "migrations", event: "gate_passed", allowNoBackupCheck });
}

module.exports = {
  EnvironmentGateError,
  isEnvironmentConfirmed,
  checkRecentBackupExists,
  assertSafeToRunMigrations,
};
