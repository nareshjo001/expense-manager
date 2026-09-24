const mongoose = require('mongoose');
const { Schema } = mongoose;
// DAT-001-T06 -- see backend/utils/moneyMinorSync.js.
const { attachMoneyMinorSync } = require('../utils/moneyMinorSync');

const RecurringExpenseSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'users',
        required: true
    },
    expenseId: {
        type: Schema.Types.ObjectId,
        ref: 'expenses',
        required: true,
    },
    expenseName: {
        type: String,
        required: true
    },
    expenseCategory: {
        type: String,
        required: true
    },
    expenseAmount: {
        type: Number,
        required: true
    },
    // DAT-001-T04 -- shadow integer-paise field (ADR-0003), same
    // additive/optional treatment as the schemas in config/Schemas.js.
    expenseAmountMinor: {
        type: Number,
        required: false,
    },
    lastLoggedDate: {
        type: Date,
        required: true
    },
    nextDueDate: {
        type: Date,
        required: true
    },
    // REC-002-T01 -- lifecycle state model.
    //
    // 'active' is the only state that existed implicitly before this: every
    // stored definition was unconditionally processed by cron/recurringJob.js.
    // 'paused' and 'ended' are new -- see recurringJob.js and
    // Services/RecurringServices/upcomingProjection.js for how each is
    // honored. Defaulting to 'active' means a document written by code that
    // doesn't know about this field (there shouldn't be any after the
    // REC-002-T01 migration, but Mongoose `.create()`/`.save()` calls that
    // predate a migration run still need a safe default) behaves exactly as
    // every definition did before this field existed.
    status: {
        type: String,
        enum: ['active', 'paused', 'ended'],
        default: 'active',
        required: true
    },
    // REC-002-T01 -- the only recurrence rule cron/recurringJob.js actually
    // implements is "monthly, on the 1st, UTC" (see recurringJob.js's own
    // advancement logic and upcomingProjection.js's header comment on why
    // day-of-month is hard-coded rather than derived). This field makes that
    // an explicit, stored fact rather than an unstated assumption -- it is
    // deliberately NOT a richer rule (weekly/custom day/etc.) because the job
    // does not support one, and claiming a capability the backend doesn't
    // expose is exactly what this project's technical-design standard rules
    // out. 'monthly' is the only accepted value for now; widening this is a
    // job-level change, not a schema-level one.
    recurrenceFrequency: {
        type: String,
        enum: ['monthly'],
        default: 'monthly',
        required: true
    },
    // REC-002-T01 -- lifecycle timestamps. All nullable; only set once their
    // corresponding transition has actually happened, so their presence is
    // itself meaningful (e.g. `pausedAt !== null` without a matching
    // `resumedAt` after it means "currently paused", without needing to
    // trust `status` alone for an audit trail).
    pausedAt: {
        type: Date,
        default: null
    },
    resumedAt: {
        type: Date,
        default: null
    },
    endedAt: {
        type: Date,
        default: null
    },
    // REC-002-T01/T06 -- an optional user-chosen date after which this
    // recurrence should stop producing occurrences. Nullable: most
    // definitions have no planned end. When set, cron/recurringJob.js
    // auto-transitions the definition to 'ended' (and notifies the user, see
    // REC-002-T06) instead of creating an occurrence once nextDueDate would
    // pass it, and upcomingProjection.js stops projecting occurrences beyond
    // it -- both compared against the same field the same way, so the
    // projection and the job can never disagree about when a schedule ends.
    endDate: {
        type: Date,
        default: null
    },
    // REC-002-T04 -- compare-and-set concurrency token for definition-level
    // mutations (pause/resume/end/edit). Incremented by exactly those
    // mutations, NOT by cron/recurringJob.js's own routine advancement of
    // nextDueDate/lastLoggedDate -- a scheduled occurrence being logged is
    // not a conflict with a concurrent user edit, and treating it as one
    // would make every edit racy against the job by design. See
    // Services/RecurringServices/recurringLifecycleService.js for the CAS
    // check itself.
    scheduleVersion: {
        type: Number,
        default: 0,
        required: true
    }
}, { timestamps: true });

RecurringExpenseSchema.index(
   { userId: 1, expenseId: 1 },
   { unique: true }
);

RecurringExpenseSchema.index({ nextDueDate: 1 });

// DAT-001-T06 -- see backend/utils/moneyMinorSync.js.
attachMoneyMinorSync(RecurringExpenseSchema, [
    { legacyField: 'expenseAmount', minorField: 'expenseAmountMinor' },
]);

const RecurringExpenseModel = mongoose.model(
    'recurringExpenses',
    RecurringExpenseSchema
);

module.exports = { RecurringExpenseModel };