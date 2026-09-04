// DAT-003-T05 -- backend/migrations/environmentGate.js: the fail-closed
// safety gate that guards every non-dry-run migration invocation.
//
// OPS-002-T03 replaced checkRecentBackupExists()'s permanent stub with a
// real check delegating to backend/scripts/backup/checkRecentBackup.js.
// This file mocks that module rather than depending on a live backup
// destination: environmentGate.js's own contract (fail closed on any
// error, treat "false" as "block") is what this suite verifies, not
// checkRecentBackup.js's own freshness logic (which has its own test
// coverage against fixture manifests).
"use strict";

jest.mock("../scripts/backup/checkRecentBackup", () => ({
  isRecentBackupAvailable: jest.fn(),
}));

const { isRecentBackupAvailable } = require("../scripts/backup/checkRecentBackup");
const {
  isEnvironmentConfirmed,
  checkRecentBackupExists,
  assertSafeToRunMigrations,
  EnvironmentGateError,
} = require("../migrations/environmentGate");

const ENV_VAR = "MIGRATIONS_ENV_CONFIRMED";

// Default every test to "no recent backup" (matching the old stub's
// always-false behavior) unless a test explicitly overrides it -- this
// keeps assertSafeToRunMigrations' pre-existing tests below meaningful
// without each one having to know about the mock.
beforeEach(() => {
  isRecentBackupAvailable.mockReset();
  isRecentBackupAvailable.mockResolvedValue(false);
});

describe("isEnvironmentConfirmed", () => {
  test("true only when the var is the exact string \"true\"", () => {
    expect(isEnvironmentConfirmed({ [ENV_VAR]: "true" })).toBe(true);
    expect(isEnvironmentConfirmed({ [ENV_VAR]: "TRUE" })).toBe(false);
    expect(isEnvironmentConfirmed({ [ENV_VAR]: "1" })).toBe(false);
    expect(isEnvironmentConfirmed({})).toBe(false);
  });
});

describe("checkRecentBackupExists", () => {
  test("returns true when the real check reports a recent backup", async () => {
    isRecentBackupAvailable.mockResolvedValue(true);
    await expect(checkRecentBackupExists()).resolves.toBe(true);
  });

  test("returns false when the real check reports no recent backup", async () => {
    isRecentBackupAvailable.mockResolvedValue(false);
    await expect(checkRecentBackupExists()).resolves.toBe(false);
  });

  test("fails closed (false), never throws, when the underlying check throws", async () => {
    isRecentBackupAvailable.mockRejectedValue(new Error("backup destination unreachable"));
    await expect(checkRecentBackupExists()).resolves.toBe(false);
  });

  test("signature is unchanged -- still callable with no arguments", async () => {
    isRecentBackupAvailable.mockResolvedValue(true);
    await checkRecentBackupExists();
    expect(isRecentBackupAvailable).toHaveBeenCalledWith();
  });
});

describe("assertSafeToRunMigrations", () => {
  const saved = process.env[ENV_VAR];

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = saved;
  });

  test("throws EnvironmentGateError when the environment is not confirmed", async () => {
    delete process.env[ENV_VAR];
    await expect(assertSafeToRunMigrations({ allowNoBackupCheck: true })).rejects.toThrow(
      EnvironmentGateError
    );
    await expect(assertSafeToRunMigrations({ allowNoBackupCheck: true })).rejects.toThrow(
      /MIGRATIONS_ENV_CONFIRMED/
    );
  });

  test("throws EnvironmentGateError when no backup can be verified and allowNoBackupCheck is not set", async () => {
    process.env[ENV_VAR] = "true";
    await expect(assertSafeToRunMigrations()).rejects.toThrow(EnvironmentGateError);
    await expect(assertSafeToRunMigrations()).rejects.toThrow(/backup/i);
  });

  test("resolves when confirmed and allowNoBackupCheck is set", async () => {
    process.env[ENV_VAR] = "true";
    await expect(assertSafeToRunMigrations({ allowNoBackupCheck: true })).resolves.toBeUndefined();
  });

  test("resolves when confirmed and a recent backup is verified", async () => {
    process.env[ENV_VAR] = "true";
    isRecentBackupAvailable.mockResolvedValue(true);
    await expect(assertSafeToRunMigrations()).resolves.toBeUndefined();
  });

  test("allowNoBackupCheck never bypasses the environment-confirmed check", async () => {
    delete process.env[ENV_VAR];
    await expect(assertSafeToRunMigrations({ allowNoBackupCheck: true })).rejects.toThrow(
      /MIGRATIONS_ENV_CONFIRMED/
    );
  });
});
