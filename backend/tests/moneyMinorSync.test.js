// DAT-001-T06 (dual-write half) -- backend/utils/moneyMinorSync.js:
// the pre-save/pre-update Mongoose hooks that keep each *Minor shadow
// field in sync on every write, gated behind
// MONEY_MINOR_DUAL_WRITE_ENABLED. Exercised against fake Mongoose
// document/query objects rather than a real schema, since no real Mongo
// is available in this environment.
"use strict";

const { attachMoneyMinorSync } = require("../utils/moneyMinorSync");

const FLAG = "MONEY_MINOR_DUAL_WRITE_ENABLED";

function makeFakeSchema() {
  const hooks = {};
  return {
    pre: (name, fn) => {
      hooks[name] = fn;
    },
    __hooks: hooks,
  };
}

function makeFakeDoc({ isNew = true, modifiedFields = [], fields = {} } = {}) {
  return {
    isNew,
    isModified: (field) => modifiedFields.includes(field),
    ...fields,
  };
}

// NOTE (fix, 2026-09-04): mongoose@9 / kareem@3 pre hooks no longer
// receive a `next` callback (kareem strips any trailing function
// argument before invoking the hook -- see moneyMinorSync.js's header
// comment). These fakes now call the hook the same way real kareem
// does: no callback argument, and the hook is either fully synchronous
// or returns a promise kareem would await. Kept as `async` helpers so
// existing `await runSaveHook(...)` / `await runUpdateHook(...)` call
// sites don't need to change.
async function runSaveHook(schema, doc) {
  return schema.__hooks.save.call(doc);
}

function makeFakeQuery(update) {
  let current = update;
  return {
    getUpdate: () => current,
    setUpdate: (next) => {
      current = next;
    },
    __getFinal: () => current,
  };
}

async function runUpdateHook(schema, hookName, query) {
  return schema.__hooks[hookName].call(query);
}

describe("attachMoneyMinorSync -- pre('save')", () => {
  const saved = process.env[FLAG];
  afterEach(() => {
    if (saved === undefined) delete process.env[FLAG];
    else process.env[FLAG] = saved;
  });

  test("does nothing when the flag is not enabled", async () => {
    delete process.env[FLAG];
    const schema = makeFakeSchema();
    attachMoneyMinorSync(schema, [{ legacyField: "expenseAmount", minorField: "expenseAmountMinor" }]);
    const doc = makeFakeDoc({ isNew: true, fields: { expenseAmount: 100 } });

    await runSaveHook(schema, doc);

    expect(doc.expenseAmountMinor).toBeUndefined();
  });

  test("sets the minor field on a new document when enabled", async () => {
    process.env[FLAG] = "true";
    const schema = makeFakeSchema();
    attachMoneyMinorSync(schema, [{ legacyField: "expenseAmount", minorField: "expenseAmountMinor" }]);
    const doc = makeFakeDoc({ isNew: true, fields: { expenseAmount: 49.995 } });

    await runSaveHook(schema, doc);

    expect(doc.expenseAmountMinor).toBe(5000);
  });

  test("updates the minor field when the legacy field was modified on an existing document", async () => {
    process.env[FLAG] = "true";
    const schema = makeFakeSchema();
    attachMoneyMinorSync(schema, [{ legacyField: "expenseAmount", minorField: "expenseAmountMinor" }]);
    const doc = makeFakeDoc({
      isNew: false,
      modifiedFields: ["expenseAmount"],
      fields: { expenseAmount: 200, expenseAmountMinor: 5000 },
    });

    await runSaveHook(schema, doc);

    expect(doc.expenseAmountMinor).toBe(20000);
  });

  test("leaves the minor field alone when the legacy field was not modified on an existing document", async () => {
    process.env[FLAG] = "true";
    const schema = makeFakeSchema();
    attachMoneyMinorSync(schema, [{ legacyField: "expenseAmount", minorField: "expenseAmountMinor" }]);
    const doc = makeFakeDoc({
      isNew: false,
      modifiedFields: ["expenseName"], // something else changed
      fields: { expenseAmount: 200, expenseAmountMinor: 12345 },
    });

    await runSaveHook(schema, doc);

    expect(doc.expenseAmountMinor).toBe(12345); // untouched
  });

  test("fails soft on a non-numeric legacy value instead of throwing", async () => {
    process.env[FLAG] = "true";
    const schema = makeFakeSchema();
    attachMoneyMinorSync(schema, [{ legacyField: "expenseAmount", minorField: "expenseAmountMinor" }]);
    const doc = makeFakeDoc({ isNew: true, fields: { expenseAmount: NaN } });

    await expect(runSaveHook(schema, doc)).resolves.toBeUndefined();
    expect(doc.expenseAmountMinor).toBeUndefined();
  });

  test("handles multiple field pairs on the same schema (budget/spent)", async () => {
    process.env[FLAG] = "true";
    const schema = makeFakeSchema();
    attachMoneyMinorSync(schema, [
      { legacyField: "budget", minorField: "budgetMinor" },
      { legacyField: "spent", minorField: "spentMinor" },
    ]);
    const doc = makeFakeDoc({ isNew: true, fields: { budget: 1000, spent: 250.5 } });

    await runSaveHook(schema, doc);

    expect(doc.budgetMinor).toBe(100000);
    expect(doc.spentMinor).toBe(25050);
  });
});

describe("attachMoneyMinorSync -- pre('findOneAndUpdate' / 'updateOne' / 'updateMany')", () => {
  const saved = process.env[FLAG];
  afterEach(() => {
    if (saved === undefined) delete process.env[FLAG];
    else process.env[FLAG] = saved;
  });

  test.each(["findOneAndUpdate", "updateOne", "updateMany"])(
    "injects the minor field into a $set update on %s when enabled",
    async (hookName) => {
      process.env[FLAG] = "true";
      const schema = makeFakeSchema();
      attachMoneyMinorSync(schema, [{ legacyField: "spent", minorField: "spentMinor" }]);
      const query = makeFakeQuery({ $set: { spent: 300, syncRevision: 5 } });

      await runUpdateHook(schema, hookName, query);

      const finalUpdate = query.__getFinal();
      expect(finalUpdate.$set.spentMinor).toBe(30000);
      expect(finalUpdate.$set.syncRevision).toBe(5); // untouched sibling field
    }
  );

  test("does nothing when the update does not touch the legacy field", async () => {
    process.env[FLAG] = "true";
    const schema = makeFakeSchema();
    attachMoneyMinorSync(schema, [{ legacyField: "spent", minorField: "spentMinor" }]);
    const query = makeFakeQuery({ $set: { syncRevision: 5 } });

    await runUpdateHook(schema, "findOneAndUpdate", query);

    expect(query.__getFinal().$set.spentMinor).toBeUndefined();
  });

  test("does nothing when the flag is not enabled", async () => {
    delete process.env[FLAG];
    const schema = makeFakeSchema();
    attachMoneyMinorSync(schema, [{ legacyField: "spent", minorField: "spentMinor" }]);
    const query = makeFakeQuery({ $set: { spent: 300 } });

    await runUpdateHook(schema, "findOneAndUpdate", query);

    expect(query.__getFinal().$set.spentMinor).toBeUndefined();
  });

  test("supports a bare (implicit $set) update object", async () => {
    process.env[FLAG] = "true";
    const schema = makeFakeSchema();
    attachMoneyMinorSync(schema, [{ legacyField: "budget", minorField: "budgetMinor" }]);
    const query = makeFakeQuery({ budget: 500 });

    await runUpdateHook(schema, "findOneAndUpdate", query);

    expect(query.__getFinal().budgetMinor).toBe(50000);
  });
});
