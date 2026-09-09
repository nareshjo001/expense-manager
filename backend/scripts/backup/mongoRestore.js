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

// Builds mongorestore's argv.
//
// THIS PREVIOUSLY RESTORED NOTHING, SILENTLY. The old argv was
//
//   --config <cfg> --nsInclude SRC.* --nsFrom SRC.* --nsTo TGT.* <dumpRoot>
//
// with <dumpRoot> the extracted dump root containing `SRC/<collection>.bson`.
// It looks right, it passed its unit test (which asserted this exact argv, so
// it agreed with the code by construction rather than with mongorestore), and
// it restored zero documents while exiting 0.
//
// The mechanism, from mongo-tools' own source rather than inference:
//
//   1. The config file passes the target connection string as `uri:`. That
//      URI carries a database, as essentially every real one does. In
//      common/options/options.go, setOptionsFromURI does
//        if opts.DB == "" && cs.Database != "" { opts.DB = cs.Database }
//      so ToolOptions.DB is populated from the URI even though no --db flag
//      was ever passed.
//   2. In mongorestore.go's Restore(), the target-directory handling is a
//      switch on exactly that field:
//        case restore.ToolOptions.DB != "" && restore.ToolOptions.Collection == "":
//            err = restore.CreateIntentsForDB(restore.ToolOptions.DB, target)
//        default:
//            err = restore.CreateAllIntents(target)
//      CreateAllIntents treats `target` as a dump ROOT whose subdirectories
//      are database names. CreateIntentsForDB treats it as a SINGLE-DATABASE
//      directory containing `<collection>.bson` files directly.
//   3. Because the URI set DB, mongorestore took the single-database branch
//      and looked for *.bson directly inside <dumpRoot>. There are none --
//      they are one level down, inside <dumpRoot>/SRC/. Zero intents, nothing
//      to do, exit 0.
//
// So the namespace flags never came into it: mongorestore had already found
// no files to apply them to. Nothing errored, and the only thing standing
// between this and a silent restore failure in a real incident was the
// document-count check in verifyRestoredCounts.
//
// The fix is to stop depending on the URI's shape at all. Point mongorestore
// at the per-database directory the dump actually contains, and pass --db
// explicitly so the single-database branch is chosen deliberately rather
// than as a side effect of what the connection string happens to look like.
// --db is set to the TARGET database, which is what performs the rename:
// CreateIntentsForDB assigns that database to every .bson it finds, so
// <dumpRoot>/SRC/users.bson is restored as TGT.users. That is the same
// mapping --nsFrom/--nsTo was meant to express, done by a mechanism that
// works.
//
// --db always equals the URI's own database here (targetDbName is extracted
// from that same connection string), so the two can never disagree, and
// passing it explicitly makes the behaviour identical whether or not a
// caller's URI includes a database.
//
// The namespace flags are dropped rather than kept alongside --db: the dump
// directory contains only the seven collections mongoBackup.js wrote, so
// --nsInclude was not scoping anything, and keeping non-functional flags
// around implies a filtering guarantee that is not there.
function buildMongorestoreArgs({ configPath, targetDbName, sourceDumpDir }) {
  return ["--config", configPath, "--db", targetDbName, sourceDumpDir];
}

// mongorestore reports its result on stderr and exits 0 whether it restored
// everything or nothing. Pulling the number out is what turns "the counts
// disagree" into "mongorestore itself says it restored 0 documents".
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

    // mongoBackup.js runs `mongodump --db <name> --out <dumpDir>`, which
    // writes <dumpDir>/<name>/<collection>.bson, and archives that with
    // `tar -C <dumpDir> .`. So after extraction the per-database directory
    // is <dumpRoot>/<manifest.mongoDbName>.
    const sourceDumpDir = path.join(dumpRoot, manifest.mongoDbName);

    // Checked rather than assumed. If the archive's layout is not what this
    // function expects, mongorestore's response is to restore nothing and
    // exit 0 -- so an unchecked assumption here surfaces later as an
    // unexplained count mismatch, which is exactly how the previous bug
    // presented.
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

    // mongorestore's own account of what it did, before we go and count.
    // When these two disagree, knowing which one is wrong is the difference
    // between "the restore silently did nothing" and "the restore worked and
    // the manifest is stale".
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
