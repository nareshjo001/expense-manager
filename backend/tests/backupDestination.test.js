// OPS-002-T03 -- backend/scripts/backup/destination.js: the pluggable
// local-filesystem backup destination (real fs operations against a
// temp directory) and the unimplemented-remote-transport seam.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  LOCAL_FS_TRANSPORT,
  resolveDestinationDir,
  createLocalFsDestination,
  resolveDestination,
} = require("../scripts/backup/destination");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backup-dest-test-"));
}

describe("resolveDestinationDir", () => {
  test("uses BACKUP_DESTINATION_DIR when set", () => {
    expect(resolveDestinationDir({ BACKUP_DESTINATION_DIR: "/custom/path" })).toBe("/custom/path");
  });

  test("falls back to a default under this module's own directory when unset", () => {
    expect(resolveDestinationDir({})).toMatch(/\.backups$/);
  });
});

describe("resolveDestination", () => {
  test("defaults to the local-fs transport", () => {
    const dir = makeTempDir();
    const destination = resolveDestination({ BACKUP_DESTINATION_DIR: dir });
    expect(destination.name).toBe(LOCAL_FS_TRANSPORT);
  });

  test("throws clearly for an unimplemented remote transport rather than silently falling back", () => {
    expect(() => resolveDestination({ BACKUP_DESTINATION_TRANSPORT: "s3" })).toThrow(/s3/i);
    expect(() => resolveDestination({ BACKUP_DESTINATION_TRANSPORT: "s3" })).toThrow(/unimplemented/i);
  });
});

describe("createLocalFsDestination", () => {
  test("writeArchive copies the source file into the destination directory", () => {
    const srcDir = makeTempDir();
    const destDir = path.join(makeTempDir(), "dest");
    const srcFile = path.join(srcDir, "archive.enc");
    fs.writeFileSync(srcFile, "encrypted-bytes-here");

    const destination = createLocalFsDestination(destDir);
    const written = destination.writeArchive("archive.enc", srcFile);

    expect(fs.readFileSync(written, "utf8")).toBe("encrypted-bytes-here");
    expect(destination.archivePath("archive.enc")).toBe(written);
  });

  test("writeManifest / listManifests round-trip through the real manifest module", () => {
    const dir = makeTempDir();
    const destination = createLocalFsDestination(dir);
    destination.writeManifest({ backupId: "b1", createdAt: "2026-01-01T00:00:00.000Z" });
    destination.writeManifest({ backupId: "b2", createdAt: "2026-02-01T00:00:00.000Z" });

    const manifests = destination.listManifests();
    expect(manifests.map((m) => m.backupId)).toEqual(["b2", "b1"]);
  });

  test("removeFiles deletes the named files and tolerates already-missing ones", () => {
    const dir = makeTempDir();
    const destination = createLocalFsDestination(dir);
    fs.writeFileSync(path.join(dir, "a.txt"), "x");

    expect(() => destination.removeFiles(["a.txt", "does-not-exist.txt"])).not.toThrow();
    expect(fs.existsSync(path.join(dir, "a.txt"))).toBe(false);
  });
});
