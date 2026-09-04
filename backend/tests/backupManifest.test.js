// OPS-002-T03 -- backend/scripts/backup/manifest.js: atomic manifest
// read/write/list against a real temp directory on this filesystem
// (real fs operations, not mocked -- this is Tier 1 for the filesystem
// mechanics, though it never touches Mongo/openssl).
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  MANIFEST_SUFFIX,
  manifestFileName,
  writeManifestSync,
  readManifestSync,
  listManifestsSync,
  newManifestId,
} = require("../scripts/backup/manifest");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backup-manifest-test-"));
}

describe("manifestFileName", () => {
  test("appends the manifest suffix", () => {
    expect(manifestFileName("abc")).toBe(`abc${MANIFEST_SUFFIX}`);
  });
});

describe("newManifestId", () => {
  test("is filesystem-safe (no colons or dots from ISO timestamps)", () => {
    const id = newManifestId(new Date("2026-09-04T04:20:00.123Z"));
    expect(id).not.toMatch(/[:.]/);
    expect(id).toBe("2026-09-04T04-20-00-123Z");
  });
});

describe("writeManifestSync / readManifestSync", () => {
  test("round-trips a manifest object", () => {
    const dir = makeTempDir();
    const manifest = { backupId: "b1", createdAt: new Date().toISOString(), collections: [{ collection: "users", documentCount: 3 }] };
    const finalPath = writeManifestSync(dir, manifest);

    expect(fs.existsSync(finalPath)).toBe(true);
    const readBack = readManifestSync(finalPath);
    expect(readBack).toEqual(manifest);
  });

  test("creates the destination directory if it does not exist yet", () => {
    const dir = path.join(makeTempDir(), "nested", "deeper");
    expect(fs.existsSync(dir)).toBe(false);
    writeManifestSync(dir, { backupId: "b1", createdAt: new Date().toISOString() });
    expect(fs.existsSync(dir)).toBe(true);
  });

  test("leaves no stray temp file behind after a successful write", () => {
    const dir = makeTempDir();
    writeManifestSync(dir, { backupId: "b1", createdAt: new Date().toISOString() });
    const files = fs.readdirSync(dir);
    expect(files).toEqual(["b1.manifest.json"]);
  });

  test("throws when manifest.backupId is missing", () => {
    const dir = makeTempDir();
    expect(() => writeManifestSync(dir, { createdAt: new Date().toISOString() })).toThrow(/backupId/);
  });

  test("a second write for the same backupId replaces the first (idempotent overwrite)", () => {
    const dir = makeTempDir();
    writeManifestSync(dir, { backupId: "b1", createdAt: "2026-01-01T00:00:00.000Z", version: 1 });
    writeManifestSync(dir, { backupId: "b1", createdAt: "2026-01-01T00:00:00.000Z", version: 2 });
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".manifest.json"));
    expect(files).toHaveLength(1);
    expect(readManifestSync(path.join(dir, files[0])).version).toBe(2);
  });
});

describe("listManifestsSync", () => {
  test("returns an empty array when the directory does not exist", () => {
    expect(listManifestsSync(path.join(os.tmpdir(), "definitely-does-not-exist-" + Date.now()))).toEqual([]);
  });

  test("returns manifests sorted newest-first by createdAt", () => {
    const dir = makeTempDir();
    writeManifestSync(dir, { backupId: "old", createdAt: "2026-01-01T00:00:00.000Z" });
    writeManifestSync(dir, { backupId: "newest", createdAt: "2026-03-01T00:00:00.000Z" });
    writeManifestSync(dir, { backupId: "middle", createdAt: "2026-02-01T00:00:00.000Z" });

    const manifests = listManifestsSync(dir);
    expect(manifests.map((m) => m.backupId)).toEqual(["newest", "middle", "old"]);
  });

  test("skips a corrupt/unparseable manifest file rather than throwing", () => {
    const dir = makeTempDir();
    writeManifestSync(dir, { backupId: "good", createdAt: "2026-01-01T00:00:00.000Z" });
    fs.writeFileSync(path.join(dir, "corrupt.manifest.json"), "{ not: valid json");

    const manifests = listManifestsSync(dir);
    expect(manifests).toHaveLength(1);
    expect(manifests[0].backupId).toBe("good");
  });

  test("ignores leftover .tmp- files and non-manifest files in the directory", () => {
    const dir = makeTempDir();
    writeManifestSync(dir, { backupId: "good", createdAt: "2026-01-01T00:00:00.000Z" });
    fs.writeFileSync(path.join(dir, ".tmp-stray-123.manifest.json"), "{}");
    fs.writeFileSync(path.join(dir, "some-archive.tar.gz.enc"), "binary-ish content");

    const manifests = listManifestsSync(dir);
    expect(manifests).toHaveLength(1);
  });

  test("each returned manifest carries its own _manifestFile name", () => {
    const dir = makeTempDir();
    writeManifestSync(dir, { backupId: "b1", createdAt: "2026-01-01T00:00:00.000Z" });
    const manifests = listManifestsSync(dir);
    expect(manifests[0]._manifestFile).toBe("b1.manifest.json");
  });
});
