"use strict";

// REC-002-T01 -- backfills the lifecycle-state fields added to
// models/RecurringExpense.js (status, recurrenceFrequency, scheduleVersion,
// pausedAt, resumedAt, endedAt, endDate) onto every existing recurring
// definition that predates them.
//
// Purely additive, and deliberately conservative about what "backfilled"
// means: every existing definition was, before this migration, treated as
// unconditionally active by cron/recurringJob.js and
// Services/RecurringServices/upcomingProjection.js (see both files' own
// REC-002 comments) -- so the only correct backfilled value for `status` is
// 'active'. Nothing before this migration ever recorded pause/resume/end
// activity, so those timestamp fields backfill to null (never happened) and
// `endDate` backfills to null (no end was ever configured).
//
// The real collection name is "recurringexpenses", NOT "recurringExpenses"
// -- see the DAT-002-T06 correction comment in
// 20260903-backfill-money-minor-fields.js for why (Mongoose's default
// pluralize/lowercase on mongoose.model('recurringExpenses', ...)). Copied
// directly from that already-corrected constant rather than re-typed, so
// this migration cannot reintroduce the same mistake.
const COLLECTION = "recurringexpenses";

const BATCH_SIZE = 500;

async function backfillLifecycleFields({ db, logger, dryRun }) {
  const coll = db.collection(COLLECTION);

  // Any document missing `status` predates this migration -- and predating
  // it means none of the other new fields exist on it either (they were all
  // added together), so one filter covers the whole backfill.
  const cursor = coll.find(
    { status: { $exists: false } },
    { projection: { _id: 1 } }
  );

  let batch = [];
  let updatedCount = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    if (!dryRun) {
      await coll.bulkWrite(batch, { ordered: false });
    }
    updatedCount += batch.length;
    batch = [];
  };

  for await (const doc of cursor) {
    if (dryRun) {
      batch.push({ docId: String(doc._id) }); // just for a count in dry-run logs
    } else {
      batch.push({
        updateOne: {
          filter: { _id: doc._id },
          update: {
            $set: {
              status: "active",
              recurrenceFrequency: "monthly",
              scheduleVersion: 0,
              pausedAt: null,
              resumedAt: null,
              endedAt: null,
              endDate: null,
            },
          },
        },
      });
    }

    if (batch.length >= BATCH_SIZE) {
      await flush();
    }
  }
  await flush();

  logger.info({
    event: dryRun ? "would_backfill" : "backfilled",
    collection: COLLECTION,
    count: updatedCount,
  });

  return updatedCount;
}

module.exports = {
  id: "20260921-backfill-recurring-lifecycle-fields",
  description:
    "Backfill REC-002-T01's lifecycle-state fields (status, recurrenceFrequency, scheduleVersion, pausedAt, resumedAt, endedAt, endDate) onto existing recurringexpenses documents, additive only -- every backfilled document becomes 'active', matching how it was already being treated.",

  async up({ mongoose, logger, dryRun }) {
    const db = mongoose.connection.db;
    await backfillLifecycleFields({ db, logger, dryRun });
  },

  async verify({ mongoose, logger }) {
    const db = mongoose.connection.db;
    const coll = db.collection(COLLECTION);
    const remaining = await coll.countDocuments({ status: { $exists: false } });
    if (remaining > 0) {
      throw new Error(
        `${remaining} document(s) in "${COLLECTION}" still missing "status" after up()`
      );
    }
    logger.info({ event: "verify_ok", collection: COLLECTION });
  },
};
