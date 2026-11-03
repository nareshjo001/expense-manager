"use strict";

// Json manifest pattern: atomic temp-file-then-rename write, one small JSON document per artifact, so a reader can never observe a partially-written manifest mid-write.
const fs = require("fs");
const path = require("path");

const MANIFEST_SUFFIX = ".manifest.json";

function manifestFileName(backupId) {
  return `${backupId}${MANIFEST_SUFFIX}`;
}

// Json`. renameSync is atomic on POSIX and Windows within one volume).
function writeManifestSync(dir, manifest) {
  if (!manifest || typeof manifest.backupId !== "string" || manifest.backupId === "") {
    throw new Error("writeManifestSync requires manifest.backupId to be a non-empty string.");
  }
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, manifestFileName(manifest.backupId));
  const tempPath = path.join(
    dir,
    `.tmp-${manifest.backupId}-${process.pid}-${Date.now()}${MANIFEST_SUFFIX}`
  );
  const fd = fs.openSync(tempPath, "w");
  try {
    fs.writeSync(fd, JSON.stringify(manifest, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tempPath, finalPath);
  return finalPath;
}

function readManifestSync(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// Lists every manifest in `dir`, parsed, sorted newest-first by `createdAt`.
function listManifestsSync(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(MANIFEST_SUFFIX) && !name.startsWith(".tmp-"));

  const manifests = [];
  for (const file of files) {
    try {
      const manifest = readManifestSync(path.join(dir, file));
      manifests.push({ ...manifest, _manifestFile: file });
    } catch {
      // corrupt/partial manifest file -- ignore it rather than crash
      // retention/freshness checks for every other backup.
    }
  }

  manifests.sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return (Number.isFinite(bTime) ? bTime : -Infinity) - (Number.isFinite(aTime) ? aTime : -Infinity);
  });
  return manifests;
}

// ` replaced (both are awkward or invalid in filenames on some filesystems, notably Windows).
function newManifestId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

module.exports = {
  MANIFEST_SUFFIX,
  manifestFileName,
  writeManifestSync,
  readManifestSync,
  listManifestsSync,
  newManifestId,
};
