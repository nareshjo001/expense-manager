// DAT-002-T07 -- backend/scripts/verifyQueryPlans.js: real, runnable
// query-plan verification, exercised here against a fake
// db.collection().find().explain() stub since no real/in-memory Mongo
// is available in this environment (same limitation and same approach
// as scripts/verifyMoneyMinorFields.js's test). This is the partial-
// credit deliverable for a task that fundamentally cannot be fully
// completed without a live database: it proves the parsing/reporting
// logic is correct, not that this codebase's real indexes are actually
// chosen by a real query planner -- only running this for real (CI's
// mongo:7 container, or a staging environment) can prove that, and this
// file's own header comment says so plainly.
"use strict";

const { QUERY_SPECS, findScanStage, verifyOne, verifyAll, summarize } = require("../scripts/verifyQueryPlans");

// Fixtures are keyed by collection name. A fixture may be a plain
// explain() result (used for every query against that collection), or a
// function `(filter) => explainResult` for a collection that
// QUERY_SPECS queries more than once with different filters/expected
// indexes (expenses, recurringexpenses) -- the real driver dispatches on
// the query shape the same way; this fake just needs to do the same to
// stay honest about which spec is being exercised.
function makeFakeDb(explainByCollection) {
  return {
    collection: (name) => ({
      find: (filter) => ({
        explain: async () => {
          const entry = explainByCollection[name];
          if (!entry) {
            throw new Error(`makeFakeDb: no explain() fixture registered for collection "${name}"`);
          }
          return typeof entry === "function" ? entry(filter) : entry;
        },
      }),
    }),
  };
}

function ixscanExplain({ indexName, totalDocsExamined = 1, nReturned = 1, executionTimeMillis = 1 }) {
  return {
    queryPlanner: {
      winningPlan: {
        stage: "FETCH",
        inputStage: { stage: "IXSCAN", indexName, inputStage: null },
      },
    },
    executionStats: { totalDocsExamined, nReturned, executionTimeMillis },
  };
}

function collscanExplain({ totalDocsExamined = 5000, nReturned = 3, executionTimeMillis = 40 }) {
  return {
    queryPlanner: {
      winningPlan: { stage: "COLLSCAN", inputStage: null },
    },
    executionStats: { totalDocsExamined, nReturned, executionTimeMillis },
  };
}

describe("QUERY_SPECS", () => {
  test("every spec names a real, corrected collection (never the pre-DAT-002-T06 'budget'/'recurringExpenses' bug)", () => {
    const collections = QUERY_SPECS.map((s) => s.collection);
    expect(collections).not.toContain("budget");
    expect(collections).not.toContain("recurringExpenses");
    expect(collections).toEqual(expect.arrayContaining(["budgets", "recurringexpenses"]));
  });

  test("every spec has a label, collection, and filter", () => {
    for (const spec of QUERY_SPECS) {
      expect(typeof spec.label).toBe("string");
      expect(spec.label.length).toBeGreaterThan(0);
      expect(typeof spec.collection).toBe("string");
      expect(typeof spec.filter).toBe("object");
    }
  });
});

describe("findScanStage", () => {
  test("finds an IXSCAN nested under a FETCH stage and reports its index name", () => {
    const plan = { stage: "FETCH", inputStage: { stage: "IXSCAN", indexName: "userId_1_month_1", inputStage: null } };
    expect(findScanStage(plan)).toEqual({ stage: "IXSCAN", indexName: "userId_1_month_1" });
  });

  test("finds a bare COLLSCAN with no nesting", () => {
    const plan = { stage: "COLLSCAN", inputStage: null };
    expect(findScanStage(plan)).toEqual({ stage: "COLLSCAN", indexName: null });
  });

  test("finds an IXSCAN nested two levels deep (FETCH -> PROJECTION -> IXSCAN shape)", () => {
    const plan = {
      stage: "PROJECTION_DEFAULT",
      inputStage: { stage: "FETCH", inputStage: { stage: "IXSCAN", indexName: "nextDueDate_1", inputStage: null } },
    };
    expect(findScanStage(plan)).toEqual({ stage: "IXSCAN", indexName: "nextDueDate_1" });
  });

  test("returns UNKNOWN rather than throwing when the plan shape is unrecognized", () => {
    expect(findScanStage({ stage: "SOME_FUTURE_STAGE", inputStage: null })).toEqual({
      stage: "UNKNOWN",
      indexName: null,
    });
  });
});

describe("verifyOne", () => {
  test("reports ok:true when the winning plan uses exactly the expected index", async () => {
    const db = makeFakeDb({
      budgets: ixscanExplain({ indexName: "userId_1_month_1" }),
    });
    const spec = QUERY_SPECS.find((s) => s.collection === "budgets" && s.expectedIndexName === "userId_1_month_1");

    const result = await verifyOne({ db, ...spec });

    expect(result.ok).toBe(true);
    expect(result.stage).toBe("IXSCAN");
    expect(result.indexName).toBe("userId_1_month_1");
  });

  test("reports ok:false and stage COLLSCAN when the planner falls back to a full scan", async () => {
    const db = makeFakeDb({
      budgets: collscanExplain({}),
    });
    const spec = QUERY_SPECS.find((s) => s.collection === "budgets" && s.expectedIndexName === "userId_1_month_1");

    const result = await verifyOne({ db, ...spec });

    expect(result.ok).toBe(false);
    expect(result.stage).toBe("COLLSCAN");
  });

  test("reports ok:false when an index IS used but it's the wrong one for this query", async () => {
    const db = makeFakeDb({
      budgets: ixscanExplain({ indexName: "some_other_index_1" }),
    });
    const spec = QUERY_SPECS.find((s) => s.collection === "budgets" && s.expectedIndexName === "userId_1_month_1");

    const result = await verifyOne({ db, ...spec });

    expect(result.ok).toBe(false);
    expect(result.indexName).toBe("some_other_index_1");
  });

  test("accepts any non-COLLSCAN index when expectedIndexName is null (users.email)", async () => {
    const db = makeFakeDb({
      users: ixscanExplain({ indexName: "email_1" }),
    });
    const spec = QUERY_SPECS.find((s) => s.collection === "users");

    const result = await verifyOne({ db, ...spec });

    expect(result.ok).toBe(true);
  });

  test("surfaces totalDocsExamined/nReturned/executionTimeMillis from executionStats unchanged", async () => {
    const db = makeFakeDb({
      budgets: ixscanExplain({ indexName: "userId_1_month_1", totalDocsExamined: 42, nReturned: 1, executionTimeMillis: 7 }),
    });
    const spec = QUERY_SPECS.find((s) => s.collection === "budgets" && s.expectedIndexName === "userId_1_month_1");

    const result = await verifyOne({ db, ...spec });

    expect(result.totalDocsExamined).toBe(42);
    expect(result.nReturned).toBe(1);
    expect(result.executionTimeMillis).toBe(7);
  });
});

describe("verifyAll / summarize", () => {
  test("summarize reports clean:true when every spec resolves ok", async () => {
    // Every collection's fixture is a function of the filter, keyed on
    // each spec's own expectedIndexName -- so a collection queried by
    // more than one spec (expenses, recurringexpenses) still gets the
    // right explain() result per call, not just whichever spec happened
    // to be registered last.
    const specsByCollection = new Map();
    for (const spec of QUERY_SPECS) {
      if (!specsByCollection.has(spec.collection)) specsByCollection.set(spec.collection, []);
      specsByCollection.get(spec.collection).push(spec);
    }

    const explainByCollection = {};
    for (const [collection, specs] of specsByCollection) {
      explainByCollection[collection] = (filter) => {
        const matched = specs.find((s) => JSON.stringify(s.filter) === JSON.stringify(filter)) || specs[0];
        return ixscanExplain({ indexName: matched.expectedIndexName || "some_index_1" });
      };
    }
    const db = makeFakeDb(explainByCollection);

    const results = await verifyAll(db);
    const summary = summarize(results);

    expect(summary.total).toBe(QUERY_SPECS.length);
    expect(summary.clean).toBe(true);
    expect(summary.failed).toBe(0);
  });

  test("summarize reports clean:false and lists exactly the one failing query when its index is missing, leaving its collection's other query (still indexed) passing", async () => {
    const db = makeFakeDb({
      expenses: (filter) =>
        "id" in filter
          ? ixscanExplain({ indexName: "userId_1_id_1" })
          : ixscanExplain({ indexName: "userId_1_expenseDate_1" }),
      incomes: ixscanExplain({ indexName: "userId_1_incomeDate_1" }),
      budgets: ixscanExplain({ indexName: "userId_1_month_1" }),
      recurringexpenses: (filter) =>
        // Only the cron due-date scan (no userId in its filter) is
        // missing its index; the point lookup by expenseId is fine.
        "userId" in filter
          ? ixscanExplain({ indexName: "userId_1_expenseId_1" })
          : collscanExplain({}),
      devicetokens: ixscanExplain({ indexName: "userId_1" }),
      notifications: ixscanExplain({ indexName: "userId_1" }),
      users: ixscanExplain({ indexName: "email_1" }),
      categorybudgets: ixscanExplain({ indexName: "userId_month_category_unique" }),
    });

    const results = await verifyAll(db);
    const summary = summarize(results);

    expect(summary.clean).toBe(false);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].collection).toBe("recurringexpenses");
    expect(summary.failures[0].stage).toBe("COLLSCAN");

    // The OTHER recurringexpenses query (indexed) is not swept up as a
    // false positive just because it shares a collection with the
    // failing one.
    const recurringResults = results.filter((r) => r.collection === "recurringexpenses");
    expect(recurringResults).toHaveLength(2);
    expect(recurringResults.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("real-server plan shapes (DAT-002-T07 staging run)", () => {
  test("reads MongoDB 7+'s winningPlan.queryPlan nesting", async () => {
    const db = makeFakeDb({
      budgets: {
        queryPlanner: {
          winningPlan: {
            isCached: false,
            queryPlan: { stage: "FETCH", inputStage: { stage: "IXSCAN", indexName: "userId_1_month_1" } },
            slotBasedPlan: { stages: "..." },
          },
        },
        executionStats: { totalDocsExamined: 1, nReturned: 1, executionTimeMillis: 0 },
      },
    });
    const spec = QUERY_SPECS.find((s) => s.collection === "budgets");
    const result = await verifyOne({ db, ...spec });
    expect(result.stage).toBe("IXSCAN");
    expect(result.ok).toBe(true);
  });

  test("accepts MongoDB 8's EXPRESS_IXSCAN as an index scan", async () => {
    const db = makeFakeDb({
      expenses: { queryPlanner: { winningPlan: { stage: "EXPRESS_IXSCAN", indexName: "userId_1_id_1" } } },
    });
    const spec = QUERY_SPECS.find((s) => s.collection === "expenses" && "id" in s.filter);
    const result = await verifyOne({ db, ...spec });
    expect(result.ok).toBe(true);
  });

  test("a missing collection (EOF plan) fails -- it has no index to use", async () => {
    const db = makeFakeDb({ devicetokens: { queryPlanner: { winningPlan: { stage: "EOF" } } } });
    const spec = QUERY_SPECS.find((s) => s.collection === "devicetokens");
    const result = await verifyOne({ db, ...spec });
    expect(result.stage).toBe("EOF");
    expect(result.ok).toBe(false);
  });

  test("placeholders are replaced with values sampled from the collection, literals are kept", async () => {
    const seen = [];
    const db = {
      collection: () => ({
        findOne: async () => ({ userId: "real-user-1", month: "Sep 2026" }),
        find: (filter) => {
          seen.push(filter);
          return { explain: async () => ixscanExplain({ indexName: "userId_month_category_unique" }) };
        },
      }),
    };
    const spec = QUERY_SPECS.find((s) => s.collection === "categorybudgets");
    const result = await verifyOne({ db, ...spec });
    expect(seen[0]).toEqual({ userId: "real-user-1", month: "Sep 2026", category: "Food" });
    expect(result.sampledRealValues).toBe(true);
    expect(result.ok).toBe(true);
  });
});
