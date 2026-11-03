// Js's dispatchAlerts, built by OBS-001-T06) rather than inventing a new alerting path.
"use strict";

const { logEvent } = require("../../utils/logger");
const { dispatchAlerts, RUNBOOK_URL } = require("../../utils/alerts");
const { findManifest, restoreBackup } = require("./mongoRestore");

const ALERT_TYPE = "backup_restore_verification_failed";
// Js's own DEFAULT_OWNER value. js doesn't export it -- duplicated here deliberately rather than reaching into that module's internals.
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
