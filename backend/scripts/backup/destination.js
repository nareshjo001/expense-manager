"use strict";

// Js's NoopTransport/SentryTransport pair. js documents for not adding a vendor SDK dependency on its own initiative).
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

    // Best-effort delete of one or more destination-relative file names (manifest and/or archive files).
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

// Seam for a future remote destination.
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
