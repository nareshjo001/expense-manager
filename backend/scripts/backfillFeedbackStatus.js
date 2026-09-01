/* backfillFeedbackStatus.js */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const { MlFeedbackModel } = require('../config/Schemas');

const VALID_STATUSES = ['pending', 'reserved', 'trained', 'needs_review'];

async function run({ dryRun = false } = {}) {
  await connectDB();

  console.log(`[backfillFeedbackStatus] starting${dryRun ? ' (dry run)' : ''}...`);

  // --- Visibility only, no writes ---
  const alreadyValidCount = await MlFeedbackModel.countDocuments({
    status: { $in: VALID_STATUSES }
  });
  console.log(
    `[backfillFeedbackStatus] documents already carrying a valid status (left untouched): ${alreadyValidCount}`
  );

  const acceptedPredictionCount = await MlFeedbackModel.countDocuments({
    corrected: false,
    status: { $nin: VALID_STATUSES }
  });
  console.log(
    `[backfillFeedbackStatus] corrected:false documents with no status (left as-is, never assigned "trained"): ${acceptedPredictionCount}`
  );

  // --- The actual migration: corrected:true docs with no valid status yet ---
  const filter = {
    corrected: true,
    status: { $nin: VALID_STATUSES }
  };

  const matchedCount = await MlFeedbackModel.countDocuments(filter);
  console.log(
    `[backfillFeedbackStatus] corrected:true documents eligible for backfill to "pending": ${matchedCount}`
  );

  if (matchedCount === 0) {
    console.log('[backfillFeedbackStatus] nothing to do — migration is a no-op on this run.');
    await mongoose.disconnect();
    return { matchedCount: 0, modifiedCount: 0 };
  }

  if (dryRun) {
    console.log('[backfillFeedbackStatus] dry run requested — no writes performed.');
    await mongoose.disconnect();
    return { matchedCount, modifiedCount: 0 };
  }

  const result = await MlFeedbackModel.updateMany(filter, {
    $set: {
      status: 'pending',
      attempts: 0,
      trainingRunId: null,
      lastError: null,
      reservedAt: null,
      trainedAt: null
    }
  });

  console.log(
    `[backfillFeedbackStatus] matched: ${result.matchedCount}, modified: ${result.modifiedCount}`
  );
  console.log('[backfillFeedbackStatus] done.');

  await mongoose.disconnect();
  return { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
}

// Manual entrypoint only — never executed as a side effect of require().
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  run({ dryRun })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[backfillFeedbackStatus] failed:', err);
      process.exit(1);
    });
}

module.exports = { run };
