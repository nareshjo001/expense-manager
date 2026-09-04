"use strict";

// Pluggable backup destination, same "swap-the-transport" shape as
// backend/utils/errorReporter.js's NoopTransport/SentryTransport pair.
// Only a local-filesystem destination is implemented here -- a real
// remote destination (S3, GCS, Azure Blob, ...) is a deliberate seam,
// not implemented by OPS-002-T03: no cloud storage account or
// credentials exist for this task to configure against, and picking a
// vendor is an owner infrastructure decision this session does not own
// (same reasoning errorReporter.js documents for not adding a vendor
// SDK dependency on its own initiative).
//
// To add a real remote destination later: implement the same interface
// (writeArchive, writeManifest, listManifests, archivePath, removeFiles)
// against the vendor's SDK/API, add a branch to `resolveDestination()`
// keyed off BACKUP_DESTINATION_TRANSPORT, and update
// docs/runbooks/OPS-002-backup-restore-operations.md. Nothing in
// mongoBackup.js / mongoRestore.js / verifyBackupRestore.js / this
// task's environmentGate.js wiring needs to change -- they only ever
// call this interface.
const fs = require("fs");
const path = require("path");
const { logEvent } = require("../../utils/logger");
const manifest = require("./manifest");

const LOCAL_FS_TRANSPORT = "local-fs";
const DEFAULT_DESTINATION_DIR = path.join(__dirname, ".backups");

function resolveDestinationDir(env = process.env) {
  const configured =
    typeof env.BACKUP_DESTINATION_DIR === "string" ? env.BACKUP_DESTINATION_DIR.trim() : "";
  return configured !== "" ? configured : DEFAULT_DESTINATION_DIR;
}

function createLocalFsDestination(dir) {
  return {
    name: LOCAL_FS_TRANSPORT,
    dir,

    // Copies `sourcePath` into the destination as `fileName`.
    writeArchive(fileName, sourcePath) {
      fs.mkdirSync(dir, { recursive: true });
      const destPath = path.join(dir, fileName);
      fs.copyFileSync(sourcePath, destPath);
      return destPath;
    },

    writeManifest(manifestDoc) {
      return manifest.writeManifestSync(dir, manifestDoc);
    },

    listManifests() {
      return manifest.listManifestsSync(dir);
    },

    archivePath(fileName) {
      return path.join(dir, fileName);
    },

    // Best-effort delete of one or more destination-relative file names
    // (manifest and/or archive files). Never throws -- a retention
    // prune that fails to delete one old file must not take down the
    // backup run that triggered it.
    removeFiles(fileNames) {
      for (const fileName of fileNames) {
        const target = path.join(dir, fileName);
        try {
          if (fs.existsSync(target)) fs.unlinkSync(target);
        } catch (err) {
          logEvent({
            level: "warn",
            scope: "backup",
            event: "retention_delete_failed",
            fileName,
            errorMessage: err && err.message,
          });
        }
      }
    },
  };
}

// Seam for a future remote destination. Never implemented here -- throws
// clearly rather than silently falling back to local disk, so a
// misconfigured BACKUP_DESTINATION_TRANSPORT fails loudly instead of
// quietly writing backups nobody is looking at.
function resolveDestination(env = process.env) {
  const transport =
    typeof env.BACKUP_DESTINATION_TRANSPORT === "string" && env.BACKUP_DESTINATION_TRANSPORT.trim() !== ""
      ? env.BACKUP_DESTINATION_TRANSPORT.trim().toLowerCase()
      : LOCAL_FS_TRANSPORT;

  if (transport === LOCAL_FS_TRANSPORT) {
    return createLocalFsDestination(resolveDestinationDir(env));
  }

  throw new Error(
    `Unsupported BACKUP_DESTINATION_TRANSPORT "${transport}" -- only "${LOCAL_FS_TRANSPORT}" is ` +
      "implemented. A remote destination (S3/GCS/etc.) is a deliberate unimplemented seam -- see " +
      "backend/scripts/backup/destination.js and docs/runbooks/OPS-002-backup-restore-operations.md."
  );
}

module.exports = {
  LOCAL_FS_TRANSPORT,
  DEFAULT_DESTINATION_DIR,
  resolveDestinationDir,
  createLocalFsDestination,
  resolveDestination,
};
