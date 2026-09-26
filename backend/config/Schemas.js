const mongoose = require('mongoose');
const { Schema } = mongoose;
// DAT-001-T06 -- keeps each *Minor shadow field in sync on every write,
// behind the MONEY_MINOR_DUAL_WRITE_ENABLED flag. See
// backend/utils/moneyMinorSync.js for why this is flag-gated.
const { attachMoneyMinorSync } = require('../utils/moneyMinorSync');
// DAT-002-T02 -- canonical "MMM YYYY" Budget.month definition, shared with
// Services/BudgetServices/budget.service.js/Controllers/BudgetControllers/
// setbudget.js/updatebudget.js/sia/financialQueryService.js. Used below only
// to validate budgetSchema.month against the same parser those call sites
// already rely on -- not to change the persisted format.
const { parseMonthKey } = require('../utils/monthKeyNormalization');

const userSchema = new Schema({
    fullName: {
        type: String,
        required: true
    },
    email: {
        // DAT-002-T02 -- canonical representation: lowercase + trimmed.
        // AUTH-002's security.service.js already defines this exact
        // transform (normalizeEmail) for audit-hash/rate-limit purposes;
        // this schema-level setter now applies the same transform to every
        // write path (signup, and any future email-bearing save()), so a
        // document's stored email is never in a different case than what
        // normalizeEmail would produce. The six AuthControllers that query
        // by email also now normalize req.body.email before querying (see
        // those files), so a case-varying login/signup input still resolves
        // to the same account instead of silently creating or missing one.
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    password: {
        type: String,
        required: true
    },

    otp: {
        type: String
    },
    otpExpiry: {
        type: Date
    }, 
    lastOtpSent: {
        type: Date
    },

    isVerified: {
       type: Boolean,
       default: false
    },
    isPasswordReset: {
        type: Boolean,
        default: false
    },
    passwordResetExpiry: {
        type: Date
    },

    verificationExpiresAt: {
        type: Date,
        index: { expireAfterSeconds: 0 }
    },

    // PRV-001-T03 (ADR-0007) -- set together when a re-authenticated
    // deletion request is accepted; both null means no deletion is
    // pending. deletionScheduledPurgeAt is the grace-period end (ADR-0007:
    // 14 days) T04's orchestration hard-deletes against; it is NOT itself
    // a TTL index field -- purge is an explicit orchestrated action, never
    // an implicit Mongo expiry, so a crashed/delayed orchestration run
    // can never silently lose the record of a pending request.
    deletionRequestedAt: {
        type: Date,
        default: null
    },
    deletionScheduledPurgeAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

const expenseSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'users',
        required: true
    },
    id: {
        type: String,
        required: true
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
    // DAT-001-T04 -- shadow integer-paise field (ADR-0003). Optional and
    // additive: populated by the 20260903-backfill-money-minor-fields
    // migration for existing docs, and left for T06 to start writing on
    // every new/edited expense. expenseAmount stays authoritative and
    // required until T07 removes it, after reconciliation AND a backup
    // (OPS-002) both exist.
    expenseAmountMinor: {
        type: Number,
        required: false,
    },
    expenseDate: {
        type: Date,
        required: true
    },
    expenseDescription: {
        type: String,
        default: ""
    },
    isRecurring: {
        type: Boolean,
        default: false
    },

    // Fields for ML predictions
    mlPredictedCategory: {
        type: String,
        default: ""
    },
    mlConfidence: {
        type: Number,
        default: 0
    },
    wasMlCorrected: {
        type: Boolean,
        default: false
    },

    // ML-003-T05 -- mirrors MlFeedbackSchema.abstained below: whether the
    // prediction shown for this expense was an abstained suggestion
    // (ML-003-T03/T04) rather than an auto-filled, committed prediction.
    wasMlAbstained: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

// Prevent duplicate expense ids within a single account.
expenseSchema.index({ userId: 1, id: 1 }, { unique: true });

// Support per-user expense lookups and date range queries.
expenseSchema.index({ userId: 1, expenseDate: 1 });

// DAT-001-T06 -- see backend/utils/moneyMinorSync.js.
attachMoneyMinorSync(expenseSchema, [
    { legacyField: 'expenseAmount', minorField: 'expenseAmountMinor' },
]);

const budgetSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'users',
        required: true
    },
    month: {
        // DAT-002-T02 -- canonical representation is "MMM YYYY" (e.g.
        // "Jan 2026"), the format every real construction/parse site in
        // this codebase already uses (verified directly, not assumed --
        // see docs/data/DAT-002-T01-schema-and-index-inventory.md). This
        // validator does not change that format; it rejects anything that
        // doesn't parse as one, using the exact same parser
        // (utils/monthKeyNormalization.js's parseMonthKey) the rest of the
        // codebase already relies on to read this field back, so validation
        // and parsing can never drift apart.
        type: String,
        required: true,
        validate: {
            validator: (value) => parseMonthKey(value) !== null,
            message: (props) => `${props.value} is not a valid "MMM YYYY" budget month key.`,
        },
    },
    budget: {
        type: Number,
        min: 0,
        required: true,
    },
    // DAT-001-T04 -- shadow integer-paise fields (ADR-0003), same
    // additive/optional treatment as expenseAmountMinor above.
    budgetMinor: {
        type: Number,
        required: false,
    },
    spent: {
        type: Number,
        min: 0,
        required: true
    },
    spentMinor: {
        type: Number,
        required: false,
    },
    // Phase C.2 -- atomic write-fencing generation stamp, mirrors
    syncRevision: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// Prevent duplicate budget documents per user and month.
budgetSchema.index({ userId: 1, month: 1 }, { unique: true });

// DAT-001-T06 -- see backend/utils/moneyMinorSync.js.
attachMoneyMinorSync(budgetSchema, [
    { legacyField: 'budget', minorField: 'budgetMinor' },
    { legacyField: 'spent', minorField: 'spentMinor' },
]);

const MlFeedbackSchema = new mongoose.Schema({

    expenseName: {
        type: String,
        required: true
    },

    predictedCategory: {
        type: String,
        required: true
    },

    actualCategory: {
        type: String,
        required: true
    },

    confidence: {
        type: Number,
        default: 0
    },

    corrected: {
        // Kept for backward compatibility with existing feedback documents and
        // the backend collector while lifecycle status is adopted.
        type: Boolean,
        default: false
    },

    // ML-003-T05 -- whether the prediction this feedback document is about
    // was an abstained suggestion (ML-003-T03/T04) rather than an
    // auto-filled, committed prediction. Defaults to false so every
    // pre-T05 document (written before this field existed) reads as a
    // committed prediction, which is what they always were.
    abstained: {
        type: Boolean,
        default: false
    },

    // ML-003-T05 -- records what happened to a shown prediction, derived
    // server-side (never trusted from the client) from `abstained` x
    // `corrected`:
    //   committed (abstained=false), kept       -> "accepted"
    //   committed (abstained=false), overridden  -> "corrected"
    //   abstained (abstained=true),  kept as-is  -> "viewed"    (the user
    //       viewed the suggestion and used it -- a near-miss signal that
    //       the abstain threshold may be higher than it needs to be)
    //   abstained (abstained=true),  overridden  -> "abstained" (the model
    //       correctly declined to guess; the user chose independently)
    // Left null (not backfilled) for every feedback document written
    // before this field existed -- there is no reliable way to reconstruct
    // whether an old document's prediction was abstained.
    outcome: {
        type: String,
        enum: {
            values: ['accepted', 'corrected', 'viewed', 'abstained'],
            message: '{VALUE} is not a valid feedback outcome'
        },
        default: null
    },

    // --- Feedback lifecycle (Phase A) ---
    status: {
        type: String,
        enum: {
            values: ['pending', 'reserved', 'trained', 'needs_review'],
            message: '{VALUE} is not a valid feedback status'
        },
        default: null
    },

    // Will reference an ML training-run record once training-run persistence
    trainingRunId: {
        type: Schema.Types.ObjectId,
        default: null
    },

    // Number of times this document has been reserved by a training run
    attempts: {
        type: Number,
        default: 0,
        min: [0, 'attempts cannot be negative']
    },

    // Short description of the most recent failure/rejection reason for
    lastError: {
        type: String,
        default: null
    },

    // When this document was last reserved by a training run's export step.
    reservedAt: {
        type: Date,
        default: null
    },

    // When this document was confirmed to be part of a successfully
    // activated training run.
    trainedAt: {
        type: Date,
        default: null
    },

    userId: {
        type: Schema.Types.ObjectId,
        ref: "users"
    }

}, {
    timestamps: true
});

const IncomeSchema = new mongoose.Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'users',
        required: true
    },
    incomeSource: {
        type: String,
        required: true
    },
    incomeAmount: {
        type: Number,
        required: true
    },
    // DAT-001-T04 -- shadow integer-paise field (ADR-0003), same
    // additive/optional treatment as expenseAmountMinor above.
    incomeAmountMinor: {
        type: Number,
        required: false,
    },
    incomeDate: {
        type: Date,
        required: true
    },
    // Remediation Workstream B -- client-generated idempotency key for
    idempotencyKey: {
        type: String,
        default: undefined
    }
}, { timestamps: true });



// Support per-user income lookups and date range queries.
IncomeSchema.index({ userId: 1, incomeDate: 1 });

// Remediation Workstream B -- durable database-level uniqueness for income
const INCOME_IDEMPOTENCY_INDEX = {
    key: { userId: 1, idempotencyKey: 1 },
    options: {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $exists: true } },
        name: 'userId_1_idempotencyKey_1',
    },
};

IncomeSchema.index(INCOME_IDEMPOTENCY_INDEX.key, INCOME_IDEMPOTENCY_INDEX.options);

// DAT-001-T06 -- see backend/utils/moneyMinorSync.js.
attachMoneyMinorSync(IncomeSchema, [
    { legacyField: 'incomeAmount', minorField: 'incomeAmountMinor' },
]);

const ExpenseModel = mongoose.model('expenses', expenseSchema);
const UserModel = mongoose.model('users', userSchema);
const IncomeModel = mongoose.model('incomes', IncomeSchema);
const BudgetModel = mongoose.model('budget', budgetSchema);
const MlFeedbackModel = mongoose.model('mlFeedback', MlFeedbackSchema);
module.exports = {
    UserModel,
    ExpenseModel,
    IncomeModel,
    BudgetModel,
    MlFeedbackModel,
    INCOME_IDEMPOTENCY_INDEX,
};
