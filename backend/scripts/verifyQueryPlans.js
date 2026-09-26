#!/usr/bin/env node
"use strict";

// DAT-002-T07 -- "verify query plans on representative data".
//
// GENUINE BLOCKER, DOCUMENTED RATHER THAN FAKED: this task fundamentally
// requires a live MongoDB with representative data volumes -- there is no
// way to prove an index is actually chosen by the query planner, or that
// a scan is efficient (low docsExamined/nReturned ratio), without a real
// `.explain()` call against a real collection. This environment has no
// live or in-memory MongoDB reachable (confirmed: `mongosh`/`mongod` are
// both absent, `mongodb-memory-server` is not a dependency, and every
// other DAT-002/DAT-003 migration this session hit the identical wall --
// see workflow/features/P1/DAT-002-database-schema-quality-and-
// integrity.md's T01/T02/T03/T05/T06 update sections). CI's `mongo:7`
// service containers (.github/workflows/ci.yml) DO give this a place to
// actually run, once invoked from a CI/staging job -- this script is
// written and tested so that invocation is the only thing still needed.
//
// WHAT THIS SCRIPT DOES
//
// For each entry in QUERY_SPECS, runs `.find(filter).explain
// ("executionStats")` against the real collection and reports: which
// stage MongoDB's query planner chose (IXSCAN/COLLSCAN/etc, read from
// winningPlan's stage tree, not assumed from the top-level shape --
// different Mongo server versions nest the index name at different
// depths), which index name it used (if any), totalDocsExamined vs
// nReturned (a large ratio here means an index exists but isn't
// selective -- still worth flagging even when the stage is IXSCAN), and
// executionTimeMillis. A COLLSCAN on a query this list expects to be
// indexed is reported as a failure (non-zero exit code), matching how
// migrations/scripts/20260903-ensure-core-indexes.js (DAT-003-T06)
// already asserts index *creation* succeeded -- this is that same
// discipline applied to index *usage*.
//
// QUERY_SPECS below mirrors the real index inventory this session
// already built and verified: docs/data/DAT-002-T01-schema-and-index-
// inventory.md's index table, migrations/scripts/20260903-ensure-core-
// indexes.js and 20260921-ensure-devicetoken-notification-indexes.js
// (DAT-002-T03)'s INDEX_SPECS, and the real call sites the DAT-002-T03
// update section cites for the DeviceToken/Notification/RefreshSession
// queries. Collection names are the corrected ones (DAT-002-T06):
// "budgets"/"recurringexpenses", not "budget"/"recurringExpenses".
//
// Usage:
//   node backend/scripts/verifyQueryPlans.js
// Exit code: 0 if every query used a non-COLLSCAN plan; 1 otherwise (or
// if any query throws), so this can gate a CI/staging step the same way
// scripts/verifyMoneyMinorFields.js gates DAT-001-T06/T07.
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const QUERY_SPECS = [
  {
    label: "expenses: point lookup by client-generated id, scoped to owner",
    collection: "expenses",
    filter: { userId: "REPRESENTATIVE_USER_ID", id: "REPRESENTATIVE_CLIENT_ID" },
    expectedIndexName: "userId_1_id_1",
  },
  {
    label: "expenses: date-range listing, scoped to owner",
    collection: "expenses",
    filter: { userId: "REPRESENTATIVE_USER_ID", expenseDate: { $gte: new Date(0), $lte: new Date() } },
    expectedIndexName: "userId_1_expenseDate_1",
  },
  {
    label: "incomes: date-range listing, scoped to owner",
    collection: "incomes",
    filter: { userId: "REPRESENTATIVE_USER_ID", incomeDate: { $gte: new Date(0), $lte: new Date() } },
    expectedIndexName: "userId_1_incomeDate_1",
  },
  {
    label: "budgets: point lookup by owner + canonical month key",
    collection: "budgets",
    filter: { userId: "REPRESENTATIVE_USER_ID", month: "Jan 2026" },
    expectedIndexName: "userId_1_month_1",
  },
  {
    label: "recurringexpenses: point lookup by owner + source expense",
    collection: "recurringexpenses",
    filter: { userId: "REPRESENTATIVE_USER_ID", expenseId: "REPRESENTATIVE_EXPENSE_ID" },
    expectedIndexName: "userId_1_expenseId_1",
  },
  {
    label: "recurringexpenses: due-today cron scan (no userId filter -- global by design)",
    collection: "recurringexpenses",
    filter: { nextDueDate: { $lte: new Date() } },
    expectedIndexName: "nextDueDate_1",
  },
  {
    label: "devicetokens: all tokens for one owner (Services/push.service.js)",
    collection: "devicetokens",
    filter: { userId: "REPRESENTATIVE_USER_ID" },
    expectedIndexName: "userId_1",
  },
  {
    label: "notifications: all notifications for one owner (accountDeletionTierBSteps.js)",
    collection: "notifications",
    filter: { userId: "REPRESENTATIVE_USER_ID" },
    expectedIndexName: "userId_1",
  },
  {
    label: "users: point lookup by canonical (lowercased/trimmed) email",
    collection: "users",
    filter: { email: "representative@example.com" },
    expectedIndexName: null, // unique index has no fixed name asserted here; any non-COLLSCAN is acceptable
  },
  {
    // BUD-001 (merged after this list was first written): category budgets
    // are read per owner+month+category and per owner+month.
    label: "categorybudgets: point lookup by owner + month + category",
    collection: "categorybudgets",
    filter: { userId: "REPRESENTATIVE_USER_ID", month: "REPRESENTATIVE_MONTH", category: "Food" },
    expectedIndexName: "userId_month_category_unique",
  },
];

// Placeholder values in QUERY_SPECS are swapped for real values sampled
// from the collection itself when it has any documents, so the plan and
// executionStats reflect a real owner's data rather than a filter that
// can match nothing. Only placeholders are replaced; literal values stay.
const PLACEHOLDER_PREFIX = "REPRESENTATIVE_";

async function representativeFilter(coll, filter) {
  const placeholderKeys = Object.keys(filter).filter(
    (k) => typeof filter[k] === "string" && filter[k].startsWith(PLACEHOLDER_PREFIX)
  );
  if (placeholderKeys.length === 0 || typeof coll.findOne !== "function") {
    return { filter, sampled: false };
  }
  const projection = Object.fromEntries(placeholderKeys.map((k) => [k, 1]));
  const sample = await coll.findOne({}, { projection });
  if (!sample) return { filter, sampled: false };
  const next = { ...filter };
  for (const k of placeholderKeys) {
    if (sample[k] !== undefined && sample[k] !== null) next[k] = sample[k];
  }
  return { filter: next, sampled: true };
}

// Walks winningPlan's nested `inputStage` chain (its shape/depth varies
// by server version and by whether a FETCH/PROJECTION stage wraps the
// scan) and returns the first IXSCAN/COLLSCAN/etc stage found, plus the
// index name when the stage is IXSCAN. Never assumes a fixed depth.
const INDEX_STAGES = new Set(["IXSCAN", "EXPRESS_IXSCAN", "COUNT_SCAN", "DISTINCT_SCAN"]);

function findScanStage(plan) {
  let stage = plan;
  while (stage) {
    // EXPRESS_IXSCAN is MongoDB 8's fast path for equality on a unique
    // index; EOF is what the planner reports for a collection that does
    // not exist (so there is no index to use either).
    if (INDEX_STAGES.has(stage.stage) || stage.stage === "COLLSCAN" || stage.stage === "EOF") {
      return { stage: stage.stage, indexName: stage.indexName || null };
    }
    stage = stage.inputStage;
  }
  return { stage: "UNKNOWN", indexName: null };
}

async function verifyOne({ db, label, collection, filter, expectedIndexName }) {
  const coll = db.collection(collection);
  const { filter: effectiveFilter, sampled } = await representativeFilter(coll, filter);
  const explanation = await coll.find(effectiveFilter).explain("executionStats");

  const winningPlan = explanation && explanation.queryPlanner && explanation.queryPlanner.winningPlan;
  // MongoDB 7+ (slot-based engine) nests the classic plan tree one level
  // down, under winningPlan.queryPlan; older servers put it directly on
  // winningPlan. Read whichever is present.
  const planTree = winningPlan && winningPlan.queryPlan ? winningPlan.queryPlan : winningPlan;
  const executionStats = explanation && explanation.executionStats;

  const { stage, indexName } = findScanStage(planTree);
  const totalDocsExamined = executionStats ? executionStats.totalDocsExamined : null;
  const nReturned = executionStats ? executionStats.nReturned : null;
  const executionTimeMillis = executionStats ? executionStats.executionTimeMillis : null;

  const usedIndex = INDEX_STAGES.has(stage);
  const matchedExpectedIndex = expectedIndexName ? indexName === expectedIndexName : usedIndex;

  return {
    label,
    collection,
    sampledRealValues: sampled,
    stage,
    indexName,
    expectedIndexName,
    totalDocsExamined,
    nReturned,
    executionTimeMillis,
    ok: usedIndex && matchedExpectedIndex,
  };
}

async function verifyAll(db) {
  const results = [];
  for (const spec of QUERY_SPECS) {
    results.push(await verifyOne({ db, ...spec }));
  }
  return results;
}

function summarize(results) {
  const failures = results.filter((r) => !r.ok);
  return { total: results.length, failed: failures.length, clean: failures.length === 0, failures };
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db;
  const results = await verifyAll(db);
  const summary = summarize(results);

  console.log(JSON.stringify({ summary, results }, null, 2));

  if (!summary.clean) {
    console.error(
      `verifyQueryPlans: NOT clean -- ${summary.failed}/${summary.total} quer(y/ies) did not use their expected index. ` +
        "A COLLSCAN or a mismatched index name here means either the index is missing/misnamed on this " +
        "environment, or the query shape has drifted from what the index was built for."
    );
  }

  await mongoose.disconnect();
  process.exitCode = summary.clean ? 0 : 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error("verifyQueryPlans crashed:", err);
    process.exit(1);
  });
}

module.exports = { QUERY_SPECS, findScanStage, verifyOne, verifyAll, summarize };
