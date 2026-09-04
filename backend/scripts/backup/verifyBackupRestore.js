/* verifyBackupRestore.js -- OPS-002-T07
 *
 * Recurring restore verification: runs mongoRestore.js's isolated
 * restore (OPS-002-T05) against the most recent backup, into the same
 * fail-closed non-production target, and checks the restored document
 * counts per authoritative collection against mongoBackup.js's manifest
 * (OPS-002-T03) for drift beyond "it restored without throwing."
 *
 * On any failure -- no backup found, the restore itself throwing, or a
 * document-count mismatch -- fires an alert through the EXISTING
 * alerting mechanism (backend/utils/alerts.js's dispatchAlerts, built by
 * OBS-001-T06) rather than inventing a new alerting path. See
 * docs/runbooks/OBS-001-alerts.md for the new
 * backup_restore_verification_failed alert type this file raises, and
 * docs/runbooks/OPS-002-backup-restore-operations.md for how this
 * script is scheduled.
 *
 * Required env: same as mongoRestore.js (RESTORE_TARGET_MONGO_CONN,
 * BACKUP_ENCRYPTION_KEY). Point RESTORE_TARGET_MONGO_CONN at a genuinely
 * disposable/scratch database for this job -- it is restored into and
 * left however the restore leaves it.
 *
 * Usage: node backend/scripts/backup/verifyBackupRestore.js
 * Exit code: 0 if verification passed; 1 otherwise (including "no
 * backup exists yet").
 */
"use strict";

const { logEvent } = require("../../utils/logger");
const { dispatchAlerts, RUNBOOK_URL } = require("../../utils/alerts");
const { findManifest, restoreBackup } = require("./mongoRestore");

const ALERT_TYPE = "backup_restore_verification_failed";
// Matches backend/utils/alerts.js's own DEFAULT_OWNER value. Not
// imported because alerts.js doesn't export it -- duplicated here
// deliberately rather than reaching into that module's internals.
const ALERT_OWNER = "on-call maintainer";

async function raiseVerificationAlert(metricValue) {
  await dispatchAlerts([
    {
      alertType: ALERT_TYPE,
      metricValue,
      threshold: 0,
      owner: ALERT_OWNER,
      runbookUrl: RUNBOOK_URL,
    },
  ]);
}

async function verifyLatestBackupRestore({ env = process.env } = {}) {
  let manifest;
  try {
    manifest = findManifest(env);
  } catch (err) {
    logEvent({
      level: "error",
      scope: "backup-verify",
      event: "verify_no_backup_found",
      errorMessage: err && err.message,
    });
    await raiseVerificationAlert(1);
    return { ok: false, reason: "no_backup_found" };
  }

  let result;
  try {
    result = await restoreBackup({ manifest, env });
  } catch (err) {
    logEvent({
      level: "error",
      scope: "backup-verify",
      event: "verify_restore_threw",
      backupId: manifest.backupId,
      errorMessage: err && err.message,
    });
    await raiseVerificationAlert(1);
    return { ok: false, reason: "restore_threw", backupId: manifest.backupId };
  }

  if (!result.ok) {
    const mismatches = result.counts.filter((c) => !c.matches);
    logEvent({
      level: "error",
      scope: "backup-verify",
      event: "verify_count_drift",
      backupId: manifest.backupId,
      mismatchCount: mismatches.length,
    });
    await raiseVerificationAlert(mismatches.length);
    return { ok: false, reason: "count_drift", backupId: manifest.backupId, mismatches };
  }

  logEvent({ level: "info", scope: "backup-verify", event: "verify_ok", backupId: manifest.backupId });
  return { ok: true, backupId: manifest.backupId };
}

if (require.main === module) {
  verifyLatestBackupRestore()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((err) => {
      console.error("verifyBackupRestore crashed:", err && err.message);
      process.exit(1);
    });
}

module.exports = { verifyLatestBackupRestore, ALERT_TYPE, ALERT_OWNER };
