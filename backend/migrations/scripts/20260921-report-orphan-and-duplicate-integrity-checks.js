"use strict";

// Read-only integrity report generalizing DAT-002-T05's pattern across the rest of the schema.
const { scanEmailGaps } = require("./20260921-report-email-and-month-normalization-gaps");

const PROGRESS_LOG_EVERY = 500;
const MAX_EXAMPLES = 20;

async function buildIdSet(db, collection) {
  const ids = new Set();
  const cursor = db.collection(collection).find({}, { projection: { _id: 1 } });
  for await (const doc of cursor) {
    ids.add(String(doc._id));
  }
  return ids;
}

async function scanOrphans({ db, logger, label, childCollection, childField, parentIds }) {
  const cursor = db.collection(childCollection).find({}, { projection: { [childField]: 1 } });

  let scanned = 0;
  let orphanCount = 0;
  const examples = [];

  for await (const doc of cursor) {
    scanned += 1;
    const refValue = doc[childField];
    const isOrphan =
      refValue !== undefined && refValue !== null && !parentIds.has(String(refValue));

    if (isOrphan) {
      orphanCount += 1;
      if (examples.length < MAX_EXAMPLES) {
        examples.push({ docId: String(doc._id), [childField]: String(refValue) });
      }
    }

    if (scanned % PROGRESS_LOG_EVERY === 0) {
      logger.info({ event: "orphan_scan_progress", label, scanned });
    }
  }

  logger.info({
    event: "orphan_report",
    label,
    collection: childCollection,
    field: childField,
    scanned,
    orphanCount,
    examples,
  });
  if (orphanCount > 0) {
    logger.warn({ event: "orphans_found", label, collection: childCollection, field: childField, orphanCount });
  }

  return { scanned, orphanCount, examples };
}

async function runAllChecks({ db, logger }) {
  const userIds = await buildIdSet(db, "users");
  const refreshSessionOrphans = await scanOrphans({
    db,
    logger,
    label: "refreshsessions.userId -> users",
    childCollection: "refreshsessions",
    childField: "userId",
    parentIds: userIds,
  });

  const expenseIds = await buildIdSet(db, "expenses");
  const recurringExpenseOrphans = await scanOrphans({
    db,
    logger,
    label: "recurringexpenses.expenseId -> expenses",
    childCollection: "recurringexpenses",
    childField: "expenseId",
    parentIds: expenseIds,
  });

  const emailDuplicates = await scanEmailGaps({ db, logger });

  return { refreshSessionOrphans, recurringExpenseOrphans, emailDuplicates };
}

module.exports = {
  id: "20260921-report-orphan-and-duplicate-integrity-checks",
  description:
    "Read-only report: refreshsessions.userId documents left dangling after account deletion (no cascade -- bounded only by their own TTL index), recurringexpenses.expenseId documents left dangling after their target expense is deleted, and the users.email collision scan reused from DAT-002-T05. Never writes -- resolving what it finds (deleting a dangling reference, merging a duplicate account) is a separate, manual follow-up, not this migration's job.",

  async up({ mongoose, logger }) {
    const db = mongoose.connection.db;
    return runAllChecks({ db, logger });
  },

  async verify({ mongoose, logger }) {
    // No prior mutation to check for completeness -- this migration never writes.
    const db = mongoose.connection.db;
    const result = await runAllChecks({ db, logger });
    logger.info({
      event: "verify_ok",
      refreshSessionScanned: result.refreshSessionOrphans.scanned,
      recurringExpenseScanned: result.recurringExpenseOrphans.scanned,
      emailScanned: result.emailDuplicates.scanned,
    });
  },
};
