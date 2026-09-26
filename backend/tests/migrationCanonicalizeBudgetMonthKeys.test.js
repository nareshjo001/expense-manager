// DAT-002 -- migrations/scripts/20260926-canonicalize-budget-month-keys.js
//
// The staging run against restored production data found the current
// month's budget stored as "Sept 2026". These tests pin the rewrite, the
// conflict/unparseable refusals, and idempotency.
"use strict";

const migration = require("../migrations/scripts/20260926-canonicalize-budget-month-keys");

function makeContext(docs, { dryRun = false } = {}) {
  const store = docs.map((d) => ({ ...d }));
  const coll = {
    find: () => ({
      async *[Symbol.asyncIterator]() {
        for (const d of store.map((x) => ({ ...x }))) yield d;
      },
    }),
    findOne: async (filter) => store.find((d) => d.userId === filter.userId && d.month === filter.month) || null,
    updateOne: jest.fn(async (filter, update) => {
      const d = store.find((x) => x._id === filter._id && x.month === filter.month);
      if (d) Object.assign(d, update.$set);
      return { modifiedCount: d ? 1 : 0 };
    }),
  };
  const db = { collection: jest.fn(() => coll) };
  const logger = { info: jest.fn(), warn: jest.fn() };
  return { ctx: { mongoose: { connection: { db } }, logger, dryRun }, store, coll, db };
}

describe("canonicalizeMonthKey", () => {
  const { canonicalizeMonthKey } = migration;
  test.each([
    ["Sept 2026", "Sep 2026"],
    ["sep 2026", "Sep 2026"],
    ["September 2026", "Sep 2026"],
    ["Sep. 2026", "Sep 2026"],
    ["  Jun 2025 ", "Jun 2025"],
    ["june 2025", "Jun 2025"],
  ])("%s -> %s", (input, expected) => {
    expect(canonicalizeMonthKey(input)).toBe(expected);
  });

  test.each(["2026-09", "Sep", "Septober 2026", "", null, 42])("refuses %p", (input) => {
    expect(canonicalizeMonthKey(input)).toBeNull();
  });
});

describe("20260926-canonicalize-budget-month-keys", () => {
  test("targets the real budgets collection", async () => {
    const { ctx, db } = makeContext([]);
    await migration.up(ctx);
    expect(db.collection).toHaveBeenCalledWith("budgets");
  });

  test("renames the staging case ('Sept 2026') and leaves canonical keys alone; verify passes", async () => {
    const { ctx, store, coll } = makeContext([
      { _id: "b1", userId: "u1", month: "Sept 2026" },
      { _id: "b2", userId: "u1", month: "Aug 2026" },
    ]);
    const result = await migration.up(ctx);
    expect(result.renamed).toBe(1);
    expect(store.find((d) => d._id === "b1").month).toBe("Sep 2026");
    expect(coll.updateOne).toHaveBeenCalledTimes(1);
    await expect(migration.verify(ctx)).resolves.toBeUndefined();
  });

  test("does not overwrite when the user already has the canonical month; verify fails", async () => {
    const { ctx, store, coll } = makeContext([
      { _id: "b1", userId: "u1", month: "Sept 2026" },
      { _id: "b2", userId: "u1", month: "Sep 2026" },
    ]);
    const result = await migration.up(ctx);
    expect(result.renamed).toBe(0);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ docId: "b1", conflictsWith: "b2", from: "Sept 2026", to: "Sep 2026" }),
    ]);
    expect(coll.updateOne).not.toHaveBeenCalled();
    expect(store.find((d) => d._id === "b1").month).toBe("Sept 2026");
    await expect(migration.verify(ctx)).rejects.toThrow(/1 conflicting/);
  });

  test("the same non-canonical month for a DIFFERENT user is not a conflict", async () => {
    const { ctx } = makeContext([
      { _id: "b1", userId: "u1", month: "Sept 2026" },
      { _id: "b2", userId: "u2", month: "Sep 2026" },
    ]);
    const result = await migration.up(ctx);
    expect(result.renamed).toBe(1);
    expect(result.conflicts).toEqual([]);
  });

  test("unparseable keys are reported, not changed", async () => {
    const { ctx, coll } = makeContext([{ _id: "b1", userId: "u1", month: "2026-09" }]);
    const result = await migration.up(ctx);
    expect(result.unparseable).toEqual([{ docId: "b1", month: "2026-09" }]);
    expect(coll.updateOne).not.toHaveBeenCalled();
    await expect(migration.verify(ctx)).rejects.toThrow(/1 unparseable/);
  });

  test("dry run reports but does not write", async () => {
    const { ctx, coll } = makeContext([{ _id: "b1", userId: "u1", month: "Sept 2026" }], { dryRun: true });
    await migration.up(ctx);
    expect(coll.updateOne).not.toHaveBeenCalled();
    expect(ctx.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "would_rename_month", from: "Sept 2026", to: "Sep 2026" })
    );
  });

  test("is idempotent: a second run changes nothing", async () => {
    const { ctx, coll } = makeContext([{ _id: "b1", userId: "u1", month: "Sept 2026" }]);
    await migration.up(ctx);
    coll.updateOne.mockClear();
    const second = await migration.up(ctx);
    expect(second.renamed).toBe(0);
    expect(coll.updateOne).not.toHaveBeenCalled();
  });
});
