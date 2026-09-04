// DAT-003-T02 -- backend/migrations/ledger.js: applied-migrations record
// (backend/models/MigrationLedger.js) and the ledger-aware planPending().
"use strict";

const MODEL_PATH = "../models/MigrationLedger";
const RUNNER_PATH = "../migrations/runner";
const LEDGER_PATH = "../migrations/ledger";

// A stateful, in-memory stand-in for the real Mongoose model, keyed by
// migrationId to mirror the real unique index's semantics.
function makeFakeModel() {
  const store = new Map(); // migrationId -> doc

  const chainable = (result) => ({ lean: async () => result });

  return {
    __store: store,
    findOne: jest.fn(({ migrationId }) => chainable(store.get(migrationId) || null)),
    find: jest.fn(() => chainable([...store.values()])),
    create: jest.fn(async ({ migrationId, description, durationMs }) => {
      if (store.has(migrationId)) {
        const err = new Error(`E11000 duplicate key error: migrationId "${migrationId}"`);
        err.code = 11000;
        throw err;
      }
      const doc = { migrationId, description, durationMs, appliedAt: new Date() };
      store.set(migrationId, doc);
      return doc;
    }),
  };
}

function loadLedger(fakeModel, fakeRunner) {
  jest.resetModules();
  jest.doMock(MODEL_PATH, () => fakeModel);
  if (fakeRunner) {
    jest.doMock(RUNNER_PATH, () => fakeRunner);
  }
  return require(LEDGER_PATH);
}

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("migrations/ledger: isApplied", () => {
  test("false for a migration that has never been recorded", async () => {
    const model = makeFakeModel();
    const { isApplied } = loadLedger(model);

    await expect(isApplied("20260101-never-run")).resolves.toBe(false);
  });

  test("true once recordApplied has recorded it", async () => {
    const model = makeFakeModel();
    const { isApplied, recordApplied } = loadLedger(model);

    await recordApplied({ id: "20260101-already-run", description: "x", durationMs: 5 });

    await expect(isApplied("20260101-already-run")).resolves.toBe(true);
  });
});

describe("migrations/ledger: getAppliedIds", () => {
  test("returns a Set of every recorded migrationId", async () => {
    const model = makeFakeModel();
    const { getAppliedIds, recordApplied } = loadLedger(model);

    await recordApplied({ id: "a", description: "x" });
    await recordApplied({ id: "b", description: "y" });

    const ids = await getAppliedIds();
    expect(ids).toBeInstanceOf(Set);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  test("returns an empty Set when nothing has been recorded", async () => {
    const model = makeFakeModel();
    const { getAppliedIds } = loadLedger(model);

    await expect(getAppliedIds()).resolves.toEqual(new Set());
  });
});

describe("migrations/ledger: recordApplied", () => {
  test("stores id, description, and durationMs", async () => {
    const model = makeFakeModel();
    const { recordApplied } = loadLedger(model);

    await recordApplied({ id: "20260101-x", description: "does a thing", durationMs: 42 });

    const stored = model.__store.get("20260101-x");
    expect(stored).toMatchObject({
      migrationId: "20260101-x",
      description: "does a thing",
      durationMs: 42,
    });
  });

  test("recording the same id twice rejects rather than silently overwriting", async () => {
    const model = makeFakeModel();
    const { recordApplied } = loadLedger(model);

    await recordApplied({ id: "20260101-dup", description: "first" });

    await expect(
      recordApplied({ id: "20260101-dup", description: "second" })
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("migrations/ledger: planPending", () => {
  test("excludes migrations already recorded in the ledger", async () => {
    const model = makeFakeModel();
    const fakeRunner = {
      MIGRATIONS_DIR: "/fake/dir",
      loadMigrations: jest.fn(() => [
        { id: "20260101-a", description: "first", filename: "20260101-a.js" },
        { id: "20260102-b", description: "second", filename: "20260102-b.js" },
      ]),
    };
    const { planPending, recordApplied } = loadLedger(model, fakeRunner);

    await recordApplied({ id: "20260101-a", description: "first" });

    const pending = await planPending();

    expect(pending).toEqual([{ id: "20260102-b", description: "second", filename: "20260102-b.js" }]);
  });

  test("all migrations are pending when the ledger is empty", async () => {
    const model = makeFakeModel();
    const fakeRunner = {
      MIGRATIONS_DIR: "/fake/dir",
      loadMigrations: jest.fn(() => [
        { id: "20260101-a", description: "first", filename: "20260101-a.js" },
      ]),
    };
    const { planPending } = loadLedger(model, fakeRunner);

    const pending = await planPending();

    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("20260101-a");
  });

  test("nothing is pending once every discovered migration is applied", async () => {
    const model = makeFakeModel();
    const fakeRunner = {
      MIGRATIONS_DIR: "/fake/dir",
      loadMigrations: jest.fn(() => [
        { id: "20260101-a", description: "first", filename: "20260101-a.js" },
      ]),
    };
    const { planPending, recordApplied } = loadLedger(model, fakeRunner);

    await recordApplied({ id: "20260101-a", description: "first" });

    await expect(planPending()).resolves.toEqual([]);
  });
});
