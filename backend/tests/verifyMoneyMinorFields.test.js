// DAT-001-T05 -- backend/scripts/verifyMoneyMinorFields.js: read-only
// dual-read verification comparing each *Minor shadow field against a
// fresh toMinorUnits() recomputation of its legacy field.
"use strict";

const { verifyCollectionField, verifyAll, summarize } = require("../scripts/verifyMoneyMinorFields");

function matchesQuery(doc, query) {
  return Object.entries(query).every(([field, cond]) => {
    if (cond && typeof cond === "object" && ("$exists" in cond || "$type" in cond)) {
      const exists = Object.prototype.hasOwnProperty.call(doc, field) && doc[field] !== undefined;
      if ("$exists" in cond && exists !== cond.$exists) return false;
      if ("$type" in cond && cond.$type === "number" && typeof doc[field] !== "number") return false;
      return true;
    }
    return doc[field] === cond;
  });
}

function makeFakeCollection(docs) {
  return {
    find: (query) => ({
      [Symbol.asyncIterator]: async function* asyncIterator() {
        for (const doc of docs.filter((d) => matchesQuery(d, query))) yield doc;
      },
    }),
    countDocuments: async (query) => docs.filter((d) => matchesQuery(d, query)).length,
  };
}

function makeFakeDb(collectionsByName) {
  const collections = new Map(Object.entries(collectionsByName).map(([n, docs]) => [n, makeFakeCollection(docs)]));
  return { collection: (name) => collections.get(name) || makeFakeCollection([]) };
}

describe("verifyCollectionField", () => {
  test("reports 0 mismatches and 0 missing when every shadow field agrees", async () => {
    const db = makeFakeDb({
      expenses: [
        { _id: "e1", expenseAmount: 100, expenseAmountMinor: 10000 },
        { _id: "e2", expenseAmount: 49.995, expenseAmountMinor: 5000 },
      ],
    });

    const result = await verifyCollectionField({
      db,
      collection: "expenses",
      legacyField: "expenseAmount",
      minorField: "expenseAmountMinor",
    });

    expect(result.checked).toBe(2);
    expect(result.mismatches).toBe(0);
    expect(result.missingMinor).toBe(0);
  });

  test("flags a document whose shadow field disagrees with a fresh recomputation", async () => {
    const db = makeFakeDb({
      expenses: [
        { _id: "e1", expenseAmount: 100, expenseAmountMinor: 10000 },
        { _id: "e2", expenseAmount: 50, expenseAmountMinor: 4999 }, // wrong -- should be 5000
      ],
    });

    const result = await verifyCollectionField({
      db,
      collection: "expenses",
      legacyField: "expenseAmount",
      minorField: "expenseAmountMinor",
    });

    expect(result.checked).toBe(2);
    expect(result.mismatches).toBe(1);
    expect(result.mismatchSamples[0].docId).toBe("e2");
    expect(result.mismatchSamples[0].expectedMinor).toBe(5000);
  });

  test("counts documents with a legacy value but no shadow field yet as missing, not checked", async () => {
    const db = makeFakeDb({
      expenses: [
        { _id: "e1", expenseAmount: 100, expenseAmountMinor: 10000 },
        { _id: "e2", expenseAmount: 200 }, // no shadow field yet
      ],
    });

    const result = await verifyCollectionField({
      db,
      collection: "expenses",
      legacyField: "expenseAmount",
      minorField: "expenseAmountMinor",
    });

    expect(result.checked).toBe(1);
    expect(result.mismatches).toBe(0);
    expect(result.missingMinor).toBe(1);
  });

  test("caps the mismatch sample list without under-counting the real total", async () => {
    const docs = [];
    for (let i = 0; i < 30; i += 1) {
      docs.push({ _id: `e${i}`, expenseAmount: 10, expenseAmountMinor: 1 }); // all wrong
    }
    const db = makeFakeDb({ expenses: docs });

    const result = await verifyCollectionField({
      db,
      collection: "expenses",
      legacyField: "expenseAmount",
      minorField: "expenseAmountMinor",
    });

    expect(result.mismatches).toBe(30);
    expect(result.mismatchSamples.length).toBe(20);
  });
});

describe("verifyAll / summarize", () => {
  test("aggregates across all 5 field mappings into one clean/not-clean summary", async () => {
    const db = makeFakeDb({
      expenses: [{ _id: "e1", expenseAmount: 100, expenseAmountMinor: 10000 }],
      incomes: [{ _id: "i1", incomeAmount: 50, incomeAmountMinor: 5000 }],
      budget: [{ _id: "b1", budget: 1000, budgetMinor: 100000, spent: 200, spentMinor: 20000 }],
      recurringExpenses: [{ _id: "r1", expenseAmount: 75, expenseAmountMinor: 7500 }],
    });

    const results = await verifyAll(db);
    const summary = summarize(results);

    expect(summary.totalChecked).toBe(5); // 4 collections + budget counted twice (budget, spent)
    expect(summary.totalMismatches).toBe(0);
    expect(summary.totalMissing).toBe(0);
    expect(summary.clean).toBe(true);
  });

  test("is not clean when any field mapping has a mismatch or a missing shadow field", async () => {
    const db = makeFakeDb({
      expenses: [{ _id: "e1", expenseAmount: 100, expenseAmountMinor: 9999 }], // wrong
      incomes: [],
      budget: [],
      recurringExpenses: [],
    });

    const results = await verifyAll(db);
    const summary = summarize(results);

    expect(summary.clean).toBe(false);
    expect(summary.totalMismatches).toBe(1);
  });
});
