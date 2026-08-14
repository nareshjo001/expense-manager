// Remediation Workstream B (follow-up) -- proves the declared income
// idempotency index specification and the deployment-time index-bootstrap
// script (backend/scripts/ensureIncomeIdempotencyIndex.js) required because
// server startup (config/db.js -> server.js) never awaits background index
// creation before accepting requests. Never opens a real Mongo connection:
// the script's own config/db.js and config/Schemas.js dependencies are
// mocked throughout, mirroring tests/income.idempotency.route.test.js's own
// jest.doMock + jest.resetModules convention.
"use strict";

const SCRIPT_PATH = "../scripts/ensureIncomeIdempotencyIndex";
const DB_PATH = "../config/db";
const SCHEMAS_PATH = "../config/Schemas";

const TEST_INDEX_SPEC = {
  key: { userId: 1, idempotencyKey: 1 },
  options: {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $exists: true } },
    name: "userId_1_idempotencyKey_1",
  },
};

afterEach(() => {
  jest.resetModules();
  jest.restoreAllMocks();
});

describe("Remediation Workstream B (follow-up): declared income idempotency index specification", () => {
  it("config/Schemas.js exports INCOME_IDEMPOTENCY_INDEX matching the exact key and options", () => {
    jest.resetModules();
    const { INCOME_IDEMPOTENCY_INDEX } = require(SCHEMAS_PATH);

    expect(INCOME_IDEMPOTENCY_INDEX).toEqual(TEST_INDEX_SPEC);
  });

  it("is the very spec Mongoose registered on IncomeSchema, not merely a same-shaped duplicate", () => {
    jest.resetModules();
    const { IncomeModel, INCOME_IDEMPOTENCY_INDEX } = require(SCHEMAS_PATH);

    const registered = IncomeModel.schema.indexes();
    const match = registered.find(
      ([key]) => key.userId === 1 && key.idempotencyKey === 1
    );
    expect(match).toBeDefined();

    const [key, options] = match;
    expect(key).toEqual(INCOME_IDEMPOTENCY_INDEX.key);
    expect(options.unique).toBe(true);
    expect(options.partialFilterExpression).toEqual({ idempotencyKey: { $exists: true } });
  });

  it("the { userId, incomeDate } lookup index remains separate and unaffected", () => {
    jest.resetModules();
    const { IncomeModel } = require(SCHEMAS_PATH);

    const registered = IncomeModel.schema.indexes();
    const lookupIndex = registered.find(
      ([key]) => key.userId === 1 && key.incomeDate === 1
    );
    expect(lookupIndex).toBeDefined();
    // Confirms the two indexes were declared independently -- the
    // idempotency index carries `unique`/`partialFilterExpression`, the
    // lookup index carries neither.
    expect(lookupIndex[1] && lookupIndex[1].unique).not.toBe(true);
  });
});

describe("Remediation Workstream B (follow-up): scripts/ensureIncomeIdempotencyIndex.js", () => {
  function mockDeps({ existingIndexNames = [], createIndexImpl } = {}) {
    const indexesFn = jest.fn(async () => existingIndexNames.map((name) => ({ name })));
    const createIndexFn = jest.fn(createIndexImpl || (async (key, options) => options.name));
    const connectDBMock = jest.fn(async () => {});
    const disconnectMock = jest.fn(async () => {});

    jest.doMock(DB_PATH, () => connectDBMock);
    jest.doMock(SCHEMAS_PATH, () => ({
      IncomeModel: {
        collection: {
          indexes: indexesFn,
          createIndex: createIndexFn,
        },
      },
      INCOME_IDEMPOTENCY_INDEX: TEST_INDEX_SPEC,
    }));
    jest.doMock("mongoose", () => ({
      disconnect: disconnectMock,
    }));

    return { indexesFn, createIndexFn, connectDBMock, disconnectMock };
  }

  it("is a no-op when the index already exists, and never calls createIndex", async () => {
    jest.resetModules();
    const { indexesFn, createIndexFn, connectDBMock } = mockDeps({
      existingIndexNames: ["_id_", "userId_1_idempotencyKey_1"],
    });
    const { run } = require(SCRIPT_PATH);

    const result = await run({ dryRun: false });

    expect(connectDBMock).toHaveBeenCalled();
    expect(indexesFn).toHaveBeenCalled();
    expect(createIndexFn).not.toHaveBeenCalled();
    expect(result).toEqual({ created: false, alreadyPresent: true });
  });

  it("dry-run reports intent without creating the index", async () => {
    jest.resetModules();
    const { createIndexFn } = mockDeps({ existingIndexNames: ["_id_"] });
    const { run } = require(SCRIPT_PATH);

    const result = await run({ dryRun: true });

    expect(createIndexFn).not.toHaveBeenCalled();
    expect(result).toEqual({ created: false, alreadyPresent: false });
  });

  it("creates exactly the declared index (key + options) when absent and not dry-run", async () => {
    jest.resetModules();
    const { createIndexFn } = mockDeps({ existingIndexNames: ["_id_"] });
    const { run } = require(SCRIPT_PATH);

    const result = await run({ dryRun: false });

    expect(createIndexFn).toHaveBeenCalledTimes(1);
    expect(createIndexFn).toHaveBeenCalledWith(TEST_INDEX_SPEC.key, TEST_INDEX_SPEC.options);
    expect(result).toEqual({ created: true, alreadyPresent: false });
  });

  it("only ever calls the additive/read collection APIs -- never syncIndexes or dropIndex", async () => {
    jest.resetModules();
    // Deliberately no `dropIndex`/`syncIndexes` mock provided at all -- if
    // the script ever called either, this test would throw
    // "... is not a function", proving it only uses the two documented
    // additive/read APIs.
    const { indexesFn, createIndexFn } = mockDeps({ existingIndexNames: [] });
    const { run } = require(SCRIPT_PATH);

    await run({ dryRun: false });

    expect(indexesFn).toHaveBeenCalled();
    expect(createIndexFn).toHaveBeenCalled();
  });

  it("propagates an IndexOptionsConflict-style error verbatim instead of swallowing it", async () => {
    jest.resetModules();
    const conflictError = Object.assign(
      new Error("Index already exists with a different name/options"),
      { code: 85 }
    );
    const { createIndexFn } = mockDeps({
      existingIndexNames: ["_id_"],
      createIndexImpl: async () => {
        throw conflictError;
      },
    });
    const { run } = require(SCRIPT_PATH);

    await expect(run({ dryRun: false })).rejects.toBe(conflictError);
    expect(createIndexFn).toHaveBeenCalledTimes(1);
  });

  it("propagates a duplicate-key error verbatim instead of swallowing it", async () => {
    jest.resetModules();
    const dupError = Object.assign(
      new Error(
        "E11000 duplicate key error collection: incomes index: userId_1_idempotencyKey_1"
      ),
      { code: 11000 }
    );
    mockDeps({
      existingIndexNames: ["_id_"],
      createIndexImpl: async () => {
        throw dupError;
      },
    });
    const { run } = require(SCRIPT_PATH);

    await expect(run({ dryRun: false })).rejects.toBe(dupError);
  });

  it("never touches any index other than the declared income idempotency index", async () => {
    jest.resetModules();
    const { createIndexFn } = mockDeps({
      existingIndexNames: ["_id_", "userId_1_incomeDate_1"],
    });
    const { run } = require(SCRIPT_PATH);

    await run({ dryRun: false });

    // Only ever called once, only ever with the one declared spec -- no
    // per-existing-index iteration/recreation of unrelated indexes.
    expect(createIndexFn).toHaveBeenCalledTimes(1);
    expect(createIndexFn.mock.calls[0][0]).toEqual(TEST_INDEX_SPEC.key);
  });

  it("is never invoked merely by requiring the module -- only an explicit run() call executes it", async () => {
    jest.resetModules();
    const { connectDBMock } = mockDeps({ existingIndexNames: [] });
    require(SCRIPT_PATH); // require only, never call run()

    expect(connectDBMock).not.toHaveBeenCalled();
  });
});
