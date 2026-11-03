// Md). js. js.
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

// Mongodump's `--collection` flag accepts exactly one collection per invocation.
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

// Js can verify against -- trusting mongodump's own log output would mean the backup and its own verification share the same potential blind spot.
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
