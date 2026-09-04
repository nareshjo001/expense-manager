// DAT-003-T04 -- backend/migrations/driver.js: the migration execution
// driver (dry-run, batch size, resume-via-ledger, first-failure-stops).
// Mocks ledger.js and lock.js at the same module seam
// migrationLock.test.js/migrationLedger.test.js use, so these tests
// exercise the driver's own orchestration logic against real migration
// files on disk (via runner.js, unmocked) rather than a re-implementation
// of the ledger or lock.
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const LEDGER_PATH = "../migrations/ledger";
const LOCK_PATH = "../migrations/lock";
const DRIVER_PATH = "../migrations/driver";

function makeTempDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "driver-test-"));
  for (const [filename, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, filename), contents, "utf8");
  }
  return dir;
}

// A stateful fake ledger, mirroring the real one's contract
// (isApplied/getAppliedIds/recordApplied/planPending) closely enough that
// planPending's "only what's still unapplied" resume semantics are real,
// not asserted by fiat.
function makeFakeLedger() {
  const applied = new Set();
  // eslint-disable-next-line global-require
  const runner = require("../migrations/runner");
  return {
    __applied: applied,
    isApplied: async (id) => applied.has(id),
    getAppliedIds: async () => new Set(applied),
    recordApplied: async ({ id }) => {
      if (applied.has(id)) throw new Error(`duplicate: ${id}`);
      applied.add(id);
    },
    planPending: async (dir) =>
      runner
        .loadMigrations(dir)
        .filter((m) => !applied.has(m.id))
        .map(({ id, description, filename }) => ({ id, description, filename })),
  };
}

function makeFakeLock() {
  return {
    LOCK_NAME: "db-migrations",
    DEFAULT_TTL_MS: 1000,
    MigrationLockError: class MigrationLockError extends Error {},
    acquireMigrationLock: async () => "owner",
    releaseMigrationLock: async () => {},
    // No real serialization needed here -- the driver's own logic is
    // what's under test, not lock contention (that's lock.test.js's job).
    withMigrationLock: async (execFn) => execFn(),
  };
}

// Loads a fresh driver + fresh fake ledger, with real environmentGate
// wired in (only mocked away when a test needs to bypass it entirely).
function loadDriver() {
  jest.resetModules();
  const fakeLedger = makeFakeLedger();
  const fakeLock = makeFakeLock();
  jest.doMock(LEDGER_PATH, () => fakeLedger);
  jest.doMock(LOCK_PATH, () => fakeLock);
  // eslint-disable-next-line global-require
  const driver = require(DRIVER_PATH);
  return { driver, ledger: fakeLedger };
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
  delete process.env.MIGRATIONS_ENV_CONFIRMED;
});

const MIG_A = `module.exports = {
  id: "20260101-a",
  description: "A",
  async up(ctx) { ctx.logger.info({ event: "a_up" }); },
  async verify(ctx) { ctx.logger.info({ event: "a_verify" }); },
};`;

const MIG_B_FAILS = `module.exports = {
  id: "20260102-b",
  description: "B fails",
  async up() { throw new Error("boom in B"); },
};`;

const MIG_C = `module.exports = {
  id: "20260103-c",
  description: "C",
  async up(ctx) { ctx.logger.info({ event: "c_up" }); },
};`;

describe("migrations/driver: runMigrations", () => {
  beforeEach(() => {
    process.env.MIGRATIONS_ENV_CONFIRMED = "true";
  });

  test("applies all pending migrations in order and records each", async () => {
    const { driver, ledger } = loadDriver();
    const dir = makeTempDir({ "20260101-a.js": MIG_A, "20260103-c.js": MIG_C });

    const result = await driver.runMigrations({ dir, allowNoBackupCheck: true });

    expect(result.applied.map((a) => a.id)).toEqual(["20260101-a", "20260103-c"]);
    expect(result.remaining).toEqual([]);
    expect(result.failed).toBeNull();
    expect(ledger.__applied.has("20260101-a")).toBe(true);
    expect(ledger.__applied.has("20260103-c")).toBe(true);
  });

  test("a failing migration stops the batch, leaves it and later ones pending, unrecorded", async () => {
    const { driver, ledger } = loadDriver();
    const dir = makeTempDir({
      "20260101-a.js": MIG_A,
      "20260102-b.js": MIG_B_FAILS,
      "20260103-c.js": MIG_C,
    });

    const result = await driver.runMigrations({ dir, allowNoBackupCheck: true });

    expect(result.applied.map((a) => a.id)).toEqual(["20260101-a"]);
    expect(result.remaining).toEqual(["20260102-b", "20260103-c"]);
    expect(result.failed.id).toBe("20260102-b");
    expect(ledger.__applied.has("20260102-b")).toBe(false);
    expect(ledger.__applied.has("20260103-c")).toBe(false);
  });

  test("resuming after a failure only re-attempts what's still pending", async () => {
    const { driver, ledger } = loadDriver();
    const dir = makeTempDir({ "20260101-a.js": MIG_A, "20260102-b.js": MIG_B_FAILS });

    const first = await driver.runMigrations({ dir, allowNoBackupCheck: true });
    expect(first.failed.id).toBe("20260102-b");
    expect(ledger.__applied.has("20260101-a")).toBe(true);

    // Fix the not-yet-applied migration in place and retry -- legitimate
    // per ADR-0006 (forward-fix-only applies to *applied* migrations; one
    // that threw never took effect).
    fs.writeFileSync(path.join(dir, "20260102-b.js"), MIG_C.replace("20260103-c", "20260102-b"));

    const second = await driver.runMigrations({ dir, allowNoBackupCheck: true });

    expect(second.applied.map((a) => a.id)).toEqual(["20260102-b"]);
    expect(second.remaining).toEqual([]);
    expect(second.failed).toBeNull();
  });

  test("batchSize limits how many migrations run in one invocation", async () => {
    const { driver } = loadDriver();
    const dir = makeTempDir({ "20260101-a.js": MIG_A, "20260103-c.js": MIG_C });

    const result = await driver.runMigrations({ dir, batchSize: 1, allowNoBackupCheck: true });

    expect(result.applied.map((a) => a.id)).toEqual(["20260101-a"]);
    expect(result.remaining).toEqual(["20260103-c"]);
  });

  test("dry run reports what would happen but records nothing in the ledger", async () => {
    const { driver, ledger } = loadDriver();
    const dir = makeTempDir({ "20260101-a.js": MIG_A });

    const result = await driver.runMigrations({ dir, dryRun: true });

    expect(result.applied.map((a) => a.id)).toEqual(["20260101-a"]);
    expect(ledger.__applied.size).toBe(0);
  });

  test("environment gate blocks a real run when the environment is not confirmed", async () => {
    const { driver } = loadDriver();
    const dir = makeTempDir({ "20260101-a.js": MIG_A });
    delete process.env.MIGRATIONS_ENV_CONFIRMED;

    await expect(driver.runMigrations({ dir, allowNoBackupCheck: true })).rejects.toThrow(
      /MIGRATIONS_ENV_CONFIRMED/
    );
  });

  test("environment gate blocks a real run when no backup can be verified", async () => {
    const { driver } = loadDriver();
    const dir = makeTempDir({ "20260101-a.js": MIG_A });

    await expect(driver.runMigrations({ dir })).rejects.toThrow(/backup/i);
  });

  test("dry run bypasses the environment gate entirely", async () => {
    const { driver } = loadDriver();
    const dir = makeTempDir({ "20260101-a.js": MIG_A });
    delete process.env.MIGRATIONS_ENV_CONFIRMED;

    const result = await driver.runMigrations({ dir, dryRun: true });

    expect(result.applied.map((a) => a.id)).toEqual(["20260101-a"]);
  });
});
