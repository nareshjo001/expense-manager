/* mongoRestore.js -- OPS-002-T05
 *
 * Isolated restoration procedure. Decrypts+verifies a backup archive
 * produced by mongoBackup.js (OPS-002-T03) and runs mongorestore --
 * but ONLY EVER into a target this script itself proves is not the
 * production database. Same fail-closed spirit as
 * backend/migrations/environmentGate.js and backend/migrations/
 * lock.js: refuse by default, require an explicit affirmative signal,
 * never assume.
 *
 * Required env: RESTORE_TARGET_MONGO_CONN (must differ from MONGO_CONN
 * -- see assertSafeRestoreTarget), BACKUP_ENCRYPTION_KEY.
 * Optional env: BACKUP_DESTINATION_DIR (must match what mongoBackup.js
 * used to produce the backup being restored).
 * See docs/runbooks/OPS-002-backup-restore-operations.md.
 *
 * Usage: node backend/scripts/backup/mongoRestore.js [--backup-id <id>]
 * (defaults to the most recent backup at the configured destination)
 * Exit code: 0 if the restore ran and every collection's restored count
 * matched the manifest; 1 otherwise.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { MongoClient } = require("mongodb");
const { logEvent } = require("../../utils/logger");
const { extractDbName, withTempMongoConfig } = require("./mongoUri");
const { decryptFile } = require("./encryption");
const { resolveDestination } = require("./destination");
const { spawnProcess } = require("./processRunner");

class RestoreSafetyError extends Error {
  constructor(message) {
    super(message);
    this.name = "RestoreSafetyError";
  }
}

// The fail-closed safety gate this whole script exists to have.
//
// `env.MONGO_CONN` is read HERE, and only here, purely to string-compare
// against the restore target -- this function never returns it, never
// passes it to a Mongo driver or a mongodump/mongorestore invocation,
// and no other function in this file reads it at all. That is what
// OPS-002-T05's "never touches MONGO_CONN (production)" requirement
// means in practice: production is never a restore/connection TARGET
// anywhere in this script, even though its value must be inspected once
// defensively, to prove the restore target is not accidentally equal to
// it. Grep this whole file for "MONGO_CONN" -- this function is the only
// match.
function assertSafeRestoreTarget(env = process.env) {
  const target = typeof env.RESTORE_TARGET_MONGO_CONN === "string" ? env.RESTORE_TARGET_MONGO_CONN.trim() : "";
  const production = typeof env.MONGO_CONN === "string" ? env.MONGO_CONN : "";

  if (target === "") {
    logEvent({ level: "error", scope: "backup-restore", event: "restore_refused_no_target" });
    throw new RestoreSafetyError(
      "Refusing to restore: RESTORE_TARGET_MONGO_CONN is unset or empty. Set it to an isolated, " +
        "non-production MongoDB connection string before running a restore."
    );
  }

  if (production !== "" && target === production) {
    logEvent({ level: "error", scope: "backup-restore", event: "restore_refused_target_equals_production" });
    throw new RestoreSafetyError(
      "Refusing to restore: RESTORE_TARGET_MONGO_CONN is identical to MONGO_CONN. A restore must " +
        "never target the production database."
    );
  }

  logEvent({ level: "info", scope: "backup-restore", event: "restore_target_confirmed_safe" });
  return target;
}

function buildMongorestoreArgs({ configPath, sourceDbName, targetDbName, dumpDir }) {
  return [
    "--config",
    configPath,
    "--nsInclude",
    `${sourceDbName}.*`,
    "--nsFrom",
    `${sourceDbName}.*`,
    "--nsTo",
    `${targetDbName}.*`,
    dumpDir,
  ];
}

async function verifyRestoredCounts(targetConn, targetDbName, manifest) {
  const client = new MongoClient(targetConn);
  const results = [];
  try {
    await client.connect();
    const db = client.db(targetDbName);
    for (const entry of manifest.collections) {
      // eslint-disable-next-line no-await-in-loop
      const actual = await db.collection(entry.collection).countDocuments();
      results.push({
        collection: entry.collection,
        expected: entry.documentCount,
        actual,
        matches: actual === entry.documentCount,
      });
    }
  } finally {
    await client.close();
  }
  return results;
}

// Restores `manifest`'s archive into the confirmed-safe restore target,
// then verifies restored document counts per collection against what
// the manifest recorded at backup time. Never reads process.env.MONGO_CONN except via assertSafeRestoreTarget above.
async function restoreBackup({ manifest, env = process.env } = {}) {
  if (!manifest || typeof manifest.archiveFileName !== "string") {
    throw new Error("restoreBackup requires a manifest with an archiveFileName.");
  }

  const targetConn = assertSafeRestoreTarget(env);
  const targetDbName = extractDbName(targetConn);
  if (!targetDbName) {
    throw new Error("Could not determine a database name from RESTORE_TARGET_MONGO_CONN.");
  }

  const encryptionKey = env.BACKUP_ENCRYPTION_KEY;
  const destination = resolveDestination(env);
  const archivePath = destination.archivePath(manifest.archiveFileName);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `mongo-restore-${manifest.backupId}-`));
  const tarPath = path.join(workDir, "archive.tar.gz");
  const dumpRoot = path.join(workDir, "dump");

  logEvent({ level: "info", scope: "backup-restore", event: "restore_start", backupId: manifest.backupId });

  try {
    const expectedHmacHex = manifest.integrity && manifest.integrity.hex;
    await decryptFile(archivePath, tarPath, encryptionKey, { expectedHmacHex });

    fs.mkdirSync(dumpRoot, { recursive: true });
    await spawnProcess("tar", ["-xzf", tarPath, "-C", dumpRoot]);

    await withTempMongoConfig(targetConn, async (configPath) => {
      await spawnProcess(
        "mongorestore",
        buildMongorestoreArgs({
          configPath,
          sourceDbName: manifest.mongoDbName,
          targetDbName,
          dumpDir: dumpRoot,
        })
      );
    });

    const counts = await verifyRestoredCounts(targetConn, targetDbName, manifest);
    const allMatch = counts.every((c) => c.matches);

    logEvent({
      level: allMatch ? "info" : "error",
      scope: "backup-restore",
      event: allMatch ? "restore_verified_ok" : "restore_count_mismatch",
      backupId: manifest.backupId,
      mismatchCount: counts.filter((c) => !c.matches).length,
    });

    return { backupId: manifest.backupId, targetDbName, counts, ok: allMatch };
  } catch (err) {
    logEvent({
      level: "error",
      scope: "backup-restore",
      event: "restore_failed",
      backupId: manifest.backupId,
      errorMessage: err && err.message,
    });
    throw err;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

function findManifest(env = process.env, { backupId } = {}) {
  const destination = resolveDestination(env);
  const manifests = destination.listManifests();
  if (backupId) {
    const found = manifests.find((m) => m.backupId === backupId);
    if (!found) throw new Error(`No manifest found for backupId "${backupId}".`);
    return found;
  }
  if (manifests.length === 0) throw new Error("No backups found at the configured destination.");
  return manifests[0]; // newest-first, per destination.listManifests()
}

if (require.main === module) {
  const backupIdArgIndex = process.argv.indexOf("--backup-id");
  const backupId = backupIdArgIndex !== -1 ? process.argv[backupIdArgIndex + 1] : undefined;

  (async () => {
    const manifest = findManifest(process.env, { backupId });
    const result = await restoreBackup({ manifest });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  })().catch((err) => {
    console.error("mongoRestore failed:", err && err.message);
    process.exit(1);
  });
}

module.exports = {
  RestoreSafetyError,
  assertSafeRestoreTarget,
  buildMongorestoreArgs,
  verifyRestoredCounts,
  restoreBackup,
  findManifest,
};
