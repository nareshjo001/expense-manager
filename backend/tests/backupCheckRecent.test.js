// OPS-002-T03 -- backend/scripts/backup/checkRecentBackup.js: the real
// freshness check backend/migrations/environmentGate.js now delegates
// to. Tested against a real local-fs destination (real fs, real
// manifest.js) with a controlled `now`/`env`, so this is real coverage
// of the freshness math without needing a live backup pipeline or a
// live Mongo.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { writeManifestSync } = require("../scripts/backup/manifest");
const { DEFAULT_MAX_AGE_HOURS, maxAgeHoursFromEnv, isRecentBackupAvailable } = require("../scripts/backup/checkRecentBackup");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "backup-check-recent-test-"));
}

describe("maxAgeHoursFromEnv", () => {
  test("defaults to DEFAULT_MAX_AGE_HOURS (30) when unset", () => {
    expect(DEFAULT_MAX_AGE_HOURS).toBe(30);
    expect(maxAgeHoursFromEnv({})).toBe(30);
  });

  test("uses BACKUP_FRESHNESS_MAX_AGE_HOURS when a positive number", () => {
    expect(maxAgeHoursFromEnv({ BACKUP_FRESHNESS_MAX_AGE_HOURS: "6" })).toBe(6);
  });

  test("falls back to the default for an invalid value", () => {
    expect(maxAgeHoursFromEnv({ BACKUP_FRESHNESS_MAX_AGE_HOURS: "not-a-number" })).toBe(30);
    expect(maxAgeHoursFromEnv({ BACKUP_FRESHNESS_MAX_AGE_HOURS: "-5" })).toBe(30);
  });
});

describe("isRecentBackupAvailable", () => {
  test("fails closed (false) when the destination has no manifests at all", async () => {
    const dir = makeTempDir();
    const env = { BACKUP_DESTINATION_DIR: dir };
    await expect(isRecentBackupAvailable({ env })).resolves.toBe(false);
  });

  test("fails closed (false) when the destination directory does not exist", async () => {
    const env = { BACKUP_DESTINATION_DIR: path.join(os.tmpdir(), "definitely-missing-" + Date.now()) };
    await expect(isRecentBackupAvailable({ env })).resolves.toBe(false);
  });

  test("true when the newest manifest is within the freshness window", async () => {
    const dir = makeTempDir();
    const now = new Date("2026-09-04T12:00:00.000Z");
    writeManifestSync(dir, { backupId: "recent", createdAt: "2026-09-04T00:00:00.000Z" }); // 12h old

    const env = { BACKUP_DESTINATION_DIR: dir };
    await expect(
      isRecentBackupAvailable({ env, maxAgeHours: 30, now: () => now.getTime() })
    ).resolves.toBe(true);
  });

  test("false when the newest manifest is older than the freshness window", async () => {
    const dir = makeTempDir();
    const now = new Date("2026-09-04T12:00:00.000Z");
    writeManifestSync(dir, { backupId: "stale", createdAt: "2026-09-01T00:00:00.000Z" }); // ~84h old

    const env = { BACKUP_DESTINATION_DIR: dir };
    await expect(
      isRecentBackupAvailable({ env, maxAgeHours: 30, now: () => now.getTime() })
    ).resolves.toBe(false);
  });

  test("picks the NEWEST manifest when several exist", async () => {
    const dir = makeTempDir();
    const now = new Date("2026-09-04T12:00:00.000Z");
    writeManifestSync(dir, { backupId: "stale", createdAt: "2026-08-01T00:00:00.000Z" });
    writeManifestSync(dir, { backupId: "fresh", createdAt: "2026-09-04T06:00:00.000Z" }); // 6h old

    const env = { BACKUP_DESTINATION_DIR: dir };
    await expect(
      isRecentBackupAvailable({ env, maxAgeHours: 30, now: () => now.getTime() })
    ).resolves.toBe(true);
  });

  test("false when the newest manifest has an unparseable createdAt", async () => {
    const dir = makeTempDir();
    writeManifestSync(dir, { backupId: "bad", createdAt: "not-a-real-date" });

    const env = { BACKUP_DESTINATION_DIR: dir };
    await expect(isRecentBackupAvailable({ env })).resolves.toBe(false);
  });

  test("fails closed (false), never throws, on an unsupported destination transport", async () => {
    const env = { BACKUP_DESTINATION_TRANSPORT: "s3" };
    await expect(isRecentBackupAvailable({ env })).resolves.toBe(false);
  });

  test("a backup exactly at the boundary of the freshness window still counts (inclusive)", async () => {
    const dir = makeTempDir();
    const now = new Date("2026-09-04T12:00:00.000Z");
    writeManifestSync(dir, { backupId: "boundary", createdAt: "2026-09-03T06:00:00.000Z" }); // exactly 30h old

    const env = { BACKUP_DESTINATION_DIR: dir };
    await expect(
      isRecentBackupAvailable({ env, maxAgeHours: 30, now: () => now.getTime() })
    ).resolves.toBe(true);
  });
});
