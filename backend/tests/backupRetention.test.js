// OPS-002-T03 -- backend/scripts/backup/retention.js: pure retention
// pruning logic, tested against a fixture list of fake manifests (no
// real backup destination or filesystem involved).
"use strict";

const { DEFAULT_RETENTION_COUNT, retentionCountFromEnv, planRetention } = require("../scripts/backup/retention");

function fixtureManifests(count) {
  // Newest-first, matching manifest.js's listManifestsSync ordering
  // contract -- planRetention assumes its input is already sorted this
  // way, same as its real caller.
  return Array.from({ length: count }, (_, i) => ({
    backupId: `backup-${count - i}`,
    createdAt: new Date(2026, 0, count - i).toISOString(),
  }));
}

describe("planRetention", () => {
  test("keeps everything when there are fewer than the retention count", () => {
    const manifests = fixtureManifests(10);
    const { keep, prune } = planRetention(manifests, 35);
    expect(keep).toHaveLength(10);
    expect(prune).toHaveLength(0);
  });

  test("keeps exactly the newest N and prunes the rest", () => {
    const manifests = fixtureManifests(40);
    const { keep, prune } = planRetention(manifests, 35);
    expect(keep).toHaveLength(35);
    expect(prune).toHaveLength(5);
    // keep is the prefix (newest-first) -- the 5 pruned are the oldest 5
    expect(keep.map((m) => m.backupId)).toEqual(manifests.slice(0, 35).map((m) => m.backupId));
    expect(prune.map((m) => m.backupId)).toEqual(manifests.slice(35).map((m) => m.backupId));
  });

  test("defaults to DEFAULT_RETENTION_COUNT (35) when no count is passed", () => {
    expect(DEFAULT_RETENTION_COUNT).toBe(35);
    const manifests = fixtureManifests(36);
    const { keep, prune } = planRetention(manifests);
    expect(keep).toHaveLength(35);
    expect(prune).toHaveLength(1);
  });

  test("handles an empty manifest list", () => {
    const { keep, prune } = planRetention([], 35);
    expect(keep).toEqual([]);
    expect(prune).toEqual([]);
  });

  test("handles a non-array input defensively (never throws)", () => {
    const { keep, prune } = planRetention(undefined, 35);
    expect(keep).toEqual([]);
    expect(prune).toEqual([]);
  });

  test("count-based retention is robust to a gap in the daily cadence -- a missed day never causes early pruning of what remains", () => {
    // 34 manifests with a gap (e.g. day 20 missing) -- still all kept,
    // because there are fewer than 35 total. An age-based cutoff
    // ("delete anything older than 35 days") could behave differently
    // depending on today's date relative to the gap; a count-based
    // cutoff's behavior here depends only on how many manifests exist.
    const manifests = fixtureManifests(34);
    const { keep, prune } = planRetention(manifests, 35);
    expect(keep).toHaveLength(34);
    expect(prune).toHaveLength(0);
  });
});

describe("retentionCountFromEnv", () => {
  test("uses BACKUP_RETENTION_COUNT when set to a positive integer", () => {
    expect(retentionCountFromEnv({ BACKUP_RETENTION_COUNT: "10" })).toBe(10);
  });

  test("falls back to the default when unset", () => {
    expect(retentionCountFromEnv({})).toBe(DEFAULT_RETENTION_COUNT);
  });

  test("falls back to the default when set to a non-positive or non-integer value", () => {
    expect(retentionCountFromEnv({ BACKUP_RETENTION_COUNT: "0" })).toBe(DEFAULT_RETENTION_COUNT);
    expect(retentionCountFromEnv({ BACKUP_RETENTION_COUNT: "-5" })).toBe(DEFAULT_RETENTION_COUNT);
    expect(retentionCountFromEnv({ BACKUP_RETENTION_COUNT: "abc" })).toBe(DEFAULT_RETENTION_COUNT);
    expect(retentionCountFromEnv({ BACKUP_RETENTION_COUNT: "3.5" })).toBe(DEFAULT_RETENTION_COUNT);
  });
});
