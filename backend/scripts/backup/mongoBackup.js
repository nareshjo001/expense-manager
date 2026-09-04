/* mongoBackup.js -- OPS-002-T03
 *
 * Encrypted, scope-limited MongoDB backup for the 7 collections
 * ADR-0002 classifies as authoritative (docs/decisions/ADR-0002-
 * authoritative-vs-disposable-stores.md), on the daily-cadence /
 * 35-rolling-backup working target ADR-0005 sets (docs/decisions/
 * ADR-0005-backup-rpo-rto.md).
 *
 * Flow: mongodump each authoritative collection (one invocation per
 * collection -- see buildMongodumpArgs below for why a loop was chosen
 * over --nsInclude) into a scratch dir, tar+gzip the dump, encrypt the
 * tarball (backend/scripts/backup/encryption.js), copy the encrypted
 * archive to the configured destination (backend/scripts/backup/
 * destination.js -- local filesystem only; see that file's header for
 * why no remote destination is wired up here), write a JSON manifest
 * sidecar recording per-collection document counts and the HMAC needed
 * to verify the archive before ever decrypting it, then prune old
 * backups per backend/scripts/backup/retention.js.
 *
 * Required env: MONGO_CONN, BACKUP_ENCRYPTION_KEY.
 * Optional env: BACKUP_DESTINATION_DIR, BACKUP_RETENTION_COUNT.
 * See docs/runbooks/OPS-002-backup-restore-operations.md for the full
 * list and how to run this manually.
 *
 * Usage: node backend/scripts/backup/mongoBackup.js
 * Exit code: 0 on success, 1 on any failure.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { MongoClient } = require("mongodb");
const { logEvent } = require("../../utils/logger");
const { AUTHORITATIVE_COLLECTIONS } = require("./collections");
const { extractDbName, withTempMongoConfig } = require("./mongoUri");
const { encryptFile, CIPHER, PBKDF2_ITERATIONS } = require("./encryption");
const { resolveDestination } = require("./destination");
const { newManifestId } = require("./manifest");
const { planRetention, retentionCountFromEnv } = require("./retention");
const { spawnProcess } = require("./processRunner");

// mongodump's `--collection` flag accepts exactly one collection per
// invocation. The alternative that avoids a loop, `--nsInclude` with a
// glob, requires listing every included namespace anyway to stay scoped
// to just the 7 authoritative collections (a bare `--nsInclude
// "<db>.*"` would defeat ADR-0002's whole point and dump every
// collection, including the explicitly-disposable ones) -- so the
// argument count ends up the same either way. A loop of single-
// collection invocations was chosen because it is simpler to reason
// about and unit-test one collection's argv at a time (see
// buildMongodumpArgs below), and because a single collection's dump
// failing (e.g. a transient error partway through) is easy to log and
// retry per-collection, and doesn't hide underneath a partially-applied
// whole-database dump.
function buildMongodumpArgs({ configPath, dbName, collection, outDir }) {
  return ["--config", configPath, "--db", dbName, "--collection", collection, "--out", outDir];
}

async function dumpAllCollections({ mongoConn, dbName, dumpDir }) {
  await withTempMongoConfig(mongoConn, async (configPath) => {
    for (const { collection } of AUTHORITATIVE_COLLECTIONS) {
      // eslint-disable-next-line no-await-in-loop
      await spawnProcess("mongodump", buildMongodumpArgs({ configPath, dbName, collection, outDir: dumpDir }));
    }
  });
}

// Counts documents directly via the MongoDB driver (not by parsing
// mongodump's own stdout/stderr) so the manifest's expected counts are
// an independent source of truth mongoRestore.js can verify against --
// trusting mongodump's own log output would mean the backup and its own
// verification share the same potential blind spot.
async function countAuthoritativeDocuments(mongoConn) {
  const client = new MongoClient(mongoConn);
  try {
    await client.connect();
    const db = client.db();
    const counts = [];
    for (const { label, collection } of AUTHORITATIVE_COLLECTIONS) {
      // eslint-disable-next-line no-await-in-loop
      const documentCount = await db.collection(collection).countDocuments();
      counts.push({ label, collection, documentCount });
    }
    return counts;
  } finally {
    await client.close();
  }
}

function pruneDestination(destination, env) {
  const manifests = destination.listManifests();
  const retentionCount = retentionCountFromEnv(env);
  const result = planRetention(manifests, retentionCount);

  if (result.prune.length > 0) {
    const fileNames = [];
    for (const manifest of result.prune) {
      if (manifest._manifestFile) fileNames.push(manifest._manifestFile);
      if (manifest.archiveFileName) fileNames.push(manifest.archiveFileName);
    }
    destination.removeFiles(fileNames);
  }

  return result;
}

async function performBackup({
  mongoConn = process.env.MONGO_CONN,
  encryptionKey = process.env.BACKUP_ENCRYPTION_KEY,
  env = process.env,
  now = new Date(),
} = {}) {
  if (typeof mongoConn !== "string" || mongoConn.trim() === "") {
    throw new Error("MONGO_CONN is not set -- refusing to run a backup with no source database.");
  }

  const dbName = extractDbName(mongoConn);
  if (!dbName) {
    throw new Error("Could not determine a database name from MONGO_CONN.");
  }

  const destination = resolveDestination(env);
  const backupId = newManifestId(now);
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), `mongo-backup-${backupId}-`));
  const dumpDir = path.join(workDir, "dump");

  logEvent({
    level: "info",
    scope: "backup",
    event: "backup_start",
    backupId,
    collectionCount: AUTHORITATIVE_COLLECTIONS.length,
  });

  try {
    await dumpAllCollections({ mongoConn, dbName, dumpDir });

    const collections = await countAuthoritativeDocuments(mongoConn);

    const tarPath = path.join(workDir, `${backupId}.tar.gz`);
    await spawnProcess("tar", ["-czf", tarPath, "-C", dumpDir, "."]);

    const encryptedPath = path.join(workDir, `${backupId}.tar.gz.enc`);
    const { hmacAlgorithm, hmacHex } = await encryptFile(tarPath, encryptedPath, encryptionKey);

    const archiveFileName = `${backupId}.tar.gz.enc`;
    destination.writeArchive(archiveFileName, encryptedPath);

    const manifest = {
      backupId,
      createdAt: now.toISOString(),
      mongoDbName: dbName,
      collections,
      archiveFileName,
      integrity: { algorithm: hmacAlgorithm, hex: hmacHex },
      encryption: { cipher: CIPHER, kdf: "pbkdf2", iterations: PBKDF2_ITERATIONS },
      tool: "mongodump-per-collection-loop",
      scriptVersion: 1,
    };
    destination.writeManifest(manifest);

    const pruneResult = pruneDestination(destination, env);

    logEvent({
      level: "info",
      scope: "backup",
      event: "backup_complete",
      backupId,
      collectionCount: collections.length,
      prunedCount: pruneResult.prune.length,
    });

    return { backupId, manifest, pruned: pruneResult.prune.map((m) => m.backupId) };
  } catch (err) {
    logEvent({
      level: "error",
      scope: "backup",
      event: "backup_failed",
      backupId,
      errorMessage: err && err.message,
    });
    throw err;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  performBackup()
    .then((result) => {
      console.log(JSON.stringify({ ok: true, backupId: result.backupId, pruned: result.pruned }, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("mongoBackup failed:", err && err.message);
      process.exit(1);
    });
}

module.exports = {
  buildMongodumpArgs,
  dumpAllCollections,
  countAuthoritativeDocuments,
  pruneDestination,
  performBackup,
};
