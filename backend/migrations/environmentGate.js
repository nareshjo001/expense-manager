"use strict";

// Environment safety gate. js's Redis-unreachable case (T02).
const { logEvent } = require("../utils/logger");
const { isRecentBackupAvailable } = require("../scripts/backup/checkRecentBackup");

class EnvironmentGateError extends Error {
  constructor(message) {
    super(message);
    this.name = "EnvironmentGateError";
  }
}

// Real, actionable checks today: an operator must explicitly set MIGRATIONS_ENV_CONFIRMED=true to run a non-dry-run migration at all.
function isEnvironmentConfirmed(env = process.env) {
  return env.MIGRATIONS_ENV_CONFIRMED === "true";
}

// T03's real seam. Signature and fail-closed default preserved exactly as the pre-T03 stub required: this must resolve to `false`, never throw.
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

// Throws EnvironmentGateError unless BOTH the environment has been explicitly confirmed AND a recent backup can be verified.
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
