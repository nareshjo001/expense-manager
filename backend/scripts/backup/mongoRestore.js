// Js -- OPS-002-T05 Isolated restoration procedure.
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

// Builds mongorestore's argv. THIS PREVIOUSLY RESTORED NOTHING, SILENTLY.
function buildMongorestoreArgs({ configPath, targetDbName, sourceDumpDir }) {
  return ["--config", configPath, "--db", targetDbName, sourceDumpDir];
}

// Mongorestore reports its result on stderr and exits 0 whether it restored everything or nothing.
function parseRestoredDocumentCount(output) {
  const match = /(\d+)\s+document\(s\) restored successfully/.exec(output || "");
  return match ? Number(match[1]) : null;
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

// Restores `manifest`'s archive into the confirmed-safe restore target, then verifies restored document counts per collection against what the manifest recorded at backup time.
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

    // `. mongoDbName>. mongoDbName>.
    const sourceDumpDir = path.join(dumpRoot, manifest.mongoDbName);

    // Checked rather than assumed.
    if (!fs.existsSync(sourceDumpDir)) {
      const found = fs.readdirSync(dumpRoot).join(", ") || "(empty)";
      throw new Error(
        `Backup archive does not contain the expected dump directory "${manifest.mongoDbName}". ` +
          `Found at the archive root: ${found}. The manifest records mongoDbName="${manifest.mongoDbName}", ` +
          "so either the archive was produced by a different backup script version or it is corrupt."
      );
    }

    const restoreOutput = await withTempMongoConfig(targetConn, async (configPath) =>
      spawnProcess(
        "mongorestore",
        buildMongorestoreArgs({ configPath, targetDbName, sourceDumpDir })
      )
    );

    // Mongorestore's own account of what it did, before we go and count.
    const reportedRestored = parseRestoredDocumentCount(
      `${restoreOutput.stderr}\n${restoreOutput.stdout}`
    );
    const expectedTotal = manifest.collections.reduce((sum, c) => sum + (c.documentCount || 0), 0);

    logEvent({
      level: reportedRestored === 0 && expectedTotal > 0 ? "error" : "info",
      scope: "backup-restore",
      event: "restore_tool_reported",
      backupId: manifest.backupId,
      reportedRestored: reportedRestored === null ? -1 : reportedRestored,
      expectedTotal,
    });

    if (reportedRestored === 0 && expectedTotal > 0) {
      throw new Error(
        `mongorestore reported restoring 0 documents while the manifest expects ${expectedTotal}. ` +
          "It exited successfully, so it found no BSON files where it looked rather than failing to " +
          `apply them. Check that the dump directory passed to mongorestore ("${sourceDumpDir}") is the ` +
          "per-database directory containing <collection>.bson files."
      );
    }

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
  parseRestoredDocumentCount,
  verifyRestoredCounts,
  restoreBackup,
  findManifest,
};
