"use strict";

// DAT-002-T06 -- read-only integrity report generalizing DAT-002-T05's
// pattern across the rest of the schema. Never writes -- up() and
// verify() both only scan and log, for the same reason T05 stayed
// read-only: resolving a real finding (deleting a dangling reference,
// merging a duplicate account) is a manual data decision, not something
// this migration should automate.
//
// Orphan risk #1 -- refreshsessions.userId -> users. Read
// Services/PrivacyServices/accountDeletionTierASteps.js and
// accountDeletionTierBSteps.js directly: TIER_A_STEPS covers session
// *revocation* (Services/AuthServices/session.service.js's
// revokeAllSessions only sets revokedAt via updateMany, it never
// deletes), and TIER_B_STEPS hard-deletes 12 other user-owned
// collections plus `users` itself -- RefreshSession appears in neither
// list. A purged user's RefreshSession documents are left referencing a
// `_id` that no longer exists in `users` until the schema's own
// `{ expiresAt: 1 }` TTL index (`expireAfterSeconds: 0`,
// models/RefreshSession.js) eventually reaps them: a real, bounded
// orphan window, not a hypothetical one.
//
// Orphan risk #2 -- recurringexpenses.expenseId -> expenses. This field
// is `required: true` with `ref: 'expenses'` (models/RecurringExpense.js)
// but nothing cascades when its target is deleted:
// Controllers/ExpenseControllers/deleteExpense.js calls
// ExpenseModel.findOneAndDelete and never touches RecurringExpenseModel,
// and no RecurringExpense controller/service/cron reconciles this on
// expense delete (checked every real call site).
//
// Every other userId/user-shaped reference in the schema (Expense,
// Income, Budget, MerchantCategoryRule, Notification, PendingSync,
// FinancialReport, SiaSession, SiaMessage, SiaRequest) is covered by
// accountDeletionTierBSteps.js's TIER_B_STEPS, so is not re-checked
// here. MlFeedback.userId is deliberately excluded too: ADR-0007 treats
// a null/missing userId there as intentionally unowned, not an orphan.
//
// Duplicate risk -- cross-referencing every `.index(...)`/`unique: true`
// declaration across config/Schemas.js and models/*.js against
// docs/data/DAT-002-T01-schema-and-index-inventory.md's index table
// shows every collection with an application-implied "one per X" rule
// already has a real backing unique index (expenses {userId,id}, budget
// {userId,month}, incomes' partial {userId,idempotencyKey}, etc.) --
// except `users.email`, which is `unique: true` on the raw stored
// string with no case-fold/collation. That is exactly the gap
// DAT-002-T05's scanEmailGaps() already detects; it is reused here
// rather than reimplemented, so there remains exactly one definition of
// what an email collision is.
//
// Collection-name note: this file's own two orphan scans, and the
// scanEmailGaps() it imports, all had their real collection names
// verified directly against the actual mongoose package while writing
// this migration (see the sibling correction comments in
// 20260903-backfill-money-minor-fields.js and
// 20260903-ensure-core-indexes.js) -- "users", "expenses", and
// "budgets" are correct as registered; RefreshSession's default
// (unregistered-override) collection name is "refreshsessions", and
// RecurringExpense's is "recurringexpenses", both confirmed the same
// way, not assumed from the model name's casing.
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
    // No prior mutation to check for completeness -- this migration
    // never writes. Re-running the same read-only scan and logging a
    // stable summary is what "verify" means for a report: it confirms
    // the report itself is safe and reproducible to run again.
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
