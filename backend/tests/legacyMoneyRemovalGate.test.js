// DAT-001-T07 -- the interlock before the legacy money fields can be removed.
//
// This is a fail-closed gate on an irreversible operation, so the tests are
// written the way the restore-safety-gate tests are: every condition gets a
// test proving it BLOCKS, because a gate whose checks cannot fail is worse
// than no gate -- it reads as a guarantee.
"use strict";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-01T00:00:00.000Z").getTime();

let isAppliedMock;
let verifyAllMock;
let isRecentBackupMock;

function load() {
  jest.resetModules();

  isAppliedMock = jest.fn(async () => true);
  verifyAllMock = jest.fn(async () => [
    { collection: "expenses", checked: 100, mismatches: 0, missingMinor: 0 },
  ]);
  isRecentBackupMock = jest.fn(async () => true);

  jest.doMock("../migrations/ledger", () => ({ isApplied: isAppliedMock }));
  jest.doMock("../scripts/backup/checkRecentBackup", () => ({
    isRecentBackupAvailable: isRecentBackupMock,
  }));
  jest.doMock("../scripts/verifyMoneyMinorFields", () => {
    const actual = jest.requireActual("../scripts/verifyMoneyMinorFields");
    return { ...actual, verifyAll: verifyAllMock };
  });

  return require("../migrations/legacyMoneyRemovalGate");
}

// An environment where every precondition is satisfied, so each test can
// break exactly one thing and attribute the refusal to it.
function safeEnv(overrides = {}) {
  return {
    MONEY_MINOR_DUAL_WRITE_ENABLED: "true",
    LEGACY_MONEY_REMOVAL_CONFIRMED: "true",
    MONEY_MINOR_SOAK_STARTED_AT: new Date(NOW - 40 * MS_PER_DAY).toISOString(),
    ...overrides,
  };
}

const opts = (env) => ({ db: {}, env, now: () => NOW });

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("the happy path exists, so refusals are attributable", () => {
  test("passes when every precondition is met", async () => {
    const gate = load();
    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.blockers).toEqual([]);
    expect(result.safe).toBe(true);
  });

  test("passing still does not claim T07 is done -- it returns evidence, not a verdict on the task", async () => {
    const gate = load();
    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.evidence).toEqual(
      expect.objectContaining({
        dualWriteEnabled: true,
        backfillApplied: true,
        recentBackup: true,
        confirmed: true,
        soakDays: expect.any(Number),
      })
    );
  });
});

describe("every condition actually blocks", () => {
  test("dual-write off blocks -- new writes would be lost, not just old ones", async () => {
    // The nastiest case: a reconciliation run against yesterday's data comes
    // back clean while every write from now on lands with no integer value.
    const gate = load();
    const result = await gate.checkLegacyMoneyRemovalPreconditions(
      opts(safeEnv({ MONEY_MINOR_DUAL_WRITE_ENABLED: "false" }))
    );

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/MONEY_MINOR_DUAL_WRITE_ENABLED/);
  });

  test("an unapplied backfill blocks", async () => {
    const gate = load();
    isAppliedMock.mockResolvedValue(false);

    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/backfill migration/);
  });

  test("checks the ledger for THIS environment, not that the file exists in the repo", async () => {
    const gate = load();
    await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(isAppliedMock).toHaveBeenCalledWith("20260903-backfill-money-minor-fields");
  });

  test("an unreadable ledger blocks, and does not also emit a duplicate blocker", async () => {
    // Fail closed: "I cannot tell" must mean no for a one-way door.
    const gate = load();
    isAppliedMock.mockRejectedValue(new Error("ledger unreachable"));

    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.safe).toBe(false);
    const ledgerBlockers = result.blockers.filter((b) => /ledger/i.test(b));
    expect(ledgerBlockers).toHaveLength(1);
  });

  test("a mismatch blocks", async () => {
    const gate = load();
    verifyAllMock.mockResolvedValue([
      { collection: "expenses", checked: 100, mismatches: 3, missingMinor: 0 },
    ]);

    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/3 mismatch/);
  });

  test("documents missing their shadow field block", async () => {
    const gate = load();
    verifyAllMock.mockResolvedValue([
      { collection: "expenses", checked: 100, mismatches: 0, missingMinor: 7 },
    ]);

    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/7 document\(s\) missing/);
  });

  test("a clean run over ZERO documents blocks -- the most misleading possible pass", async () => {
    // 0 mismatches and 0 missing across 0 checked satisfies `clean`, and
    // reads as green while proving nothing at all.
    const gate = load();
    verifyAllMock.mockResolvedValue([
      { collection: "expenses", checked: 0, mismatches: 0, missingMinor: 0 },
    ]);

    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/0 documents/);
  });

  test("reconciliation throwing blocks rather than being treated as clean", async () => {
    const gate = load();
    verifyAllMock.mockRejectedValue(new Error("cursor died"));

    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/Reconciliation could not be run/);
  });

  test("no recent backup blocks -- it is what makes the one-way door survivable", async () => {
    const gate = load();
    isRecentBackupMock.mockResolvedValue(false);

    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/recent verified backup/);
  });

  test("a backup check that throws is treated as no backup", async () => {
    const gate = load();
    isRecentBackupMock.mockRejectedValue(new Error("destination unreadable"));

    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/recent verified backup/);
  });

  test("a missing confirmation blocks even when everything else passes", async () => {
    // Every other check can pass on a system where nobody intended to do
    // this today. Same reasoning as MIGRATIONS_ENV_CONFIRMED.
    const gate = load();
    const result = await gate.checkLegacyMoneyRemovalPreconditions(
      opts(safeEnv({ LEGACY_MONEY_REMOVAL_CONFIRMED: undefined }))
    );

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/LEGACY_MONEY_REMOVAL_CONFIRMED/);
  });
});

describe("the soak window", () => {
  test("an undeclared soak start blocks", async () => {
    const gate = load();
    const result = await gate.checkLegacyMoneyRemovalPreconditions(
      opts(safeEnv({ MONEY_MINOR_SOAK_STARTED_AT: undefined }))
    );

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/MONEY_MINOR_SOAK_STARTED_AT/);
  });

  test("an unparseable soak start blocks rather than being ignored", async () => {
    const gate = load();
    const result = await gate.checkLegacyMoneyRemovalPreconditions(
      opts(safeEnv({ MONEY_MINOR_SOAK_STARTED_AT: "last Tuesday" }))
    );

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/MONEY_MINOR_SOAK_STARTED_AT/);
  });

  test("a soak shorter than the minimum blocks", async () => {
    const gate = load();
    const result = await gate.checkLegacyMoneyRemovalPreconditions(
      opts(safeEnv({ MONEY_MINOR_SOAK_STARTED_AT: new Date(NOW - 3 * MS_PER_DAY).toISOString() }))
    );

    expect(result.safe).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/soaked 3 day\(s\)/);
  });

  test("a soak under ~31 days passes but WARNS about the monthly recurring path", async () => {
    // cron/recurringJob.js writes monthly. A two-week soak has almost
    // certainly never seen it populate a *Minor field, so the floor being
    // met is not the same as that path being covered -- and a gate that
    // passed silently here would imply otherwise.
    const gate = load();
    const result = await gate.checkLegacyMoneyRemovalPreconditions(
      opts(safeEnv({ MONEY_MINOR_SOAK_STARTED_AT: new Date(NOW - 20 * MS_PER_DAY).toISOString() }))
    );

    expect(result.safe).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/recurringJob/);
  });

  test("a soak past a full month does not warn", async () => {
    const gate = load();
    const result = await gate.checkLegacyMoneyRemovalPreconditions(opts(safeEnv()));

    expect(result.warnings).toEqual([]);
  });
});

describe("assertLegacyMoneyRemovalSafe", () => {
  test("throws a named error listing every blocker at once", async () => {
    // One refusal naming everything, rather than discovering the list one
    // failed attempt at a time.
    const gate = load();
    isRecentBackupMock.mockResolvedValue(false);

    let err;
    try {
      await gate.assertLegacyMoneyRemovalSafe(
        opts({ MONEY_MINOR_DUAL_WRITE_ENABLED: "false" })
      );
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(gate.LegacyMoneyRemovalBlocked);
    expect(err.blockers.length).toBeGreaterThanOrEqual(3);
    expect(err.message).toMatch(/irreversible/);
  });

  test("resolves when the preconditions pass", async () => {
    const gate = load();
    await expect(gate.assertLegacyMoneyRemovalSafe(opts(safeEnv()))).resolves.toEqual(
      expect.objectContaining({ safe: true })
    );
  });
});
