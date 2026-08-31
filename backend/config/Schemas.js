const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema({
    fullName: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
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
    }
});

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
    }
});

// Prevent duplicate expense ids within a single account.
expenseSchema.index({ userId: 1, id: 1 }, { unique: true });

// Support per-user expense lookups and date range queries.
expenseSchema.index({ userId: 1, expenseDate: 1 });

const budgetSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'users',
        required: true
    },
    month: {
        type: String,
        required: true
    },
    budget: {
        type: Number,
        min: 0,
        required: true,
    },
    spent: {
        type: Number,
        min: 0,
        required: true
    },
    // Phase C.2 -- atomic write-fencing generation stamp, mirrors
    // models/Report.js's own syncRevision field. See
    // Services/BudgetServices/budget.service.js's recalculateBudget for
    // how the actual write is conditioned on this field so an older,
    // slower recomputation can never overwrite a newer one.
    syncRevision: {
        type: Number,
        default: 0
    }
});

// Prevent duplicate budget documents per user and month.
budgetSchema.index({ userId: 1, month: 1 }, { unique: true });

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

    // --- Feedback lifecycle (Phase A) ---
    // Explicit lifecycle state for the retraining pipeline. Deliberately has
    // no schema-level default of "pending" — a document only becomes
    // "pending" when the server has confirmed a genuine ML correction
    // occurred. Ordinary accepted-prediction records are left with
    // status: null so they are never mistaken for training-eligible feedback.
    status: {
        type: String,
        enum: {
            values: ['pending', 'reserved', 'trained', 'needs_review'],
            message: '{VALUE} is not a valid feedback status'
        },
        default: null
    },

    // Will reference an ML training-run record once training-run persistence
    // exists (Phase B). Stored as ObjectId, consistent with how every other
    // cross-document reference in this schema file (userId, ref: "users") is
    // represented, rather than as a free-form string.
    trainingRunId: {
        type: Schema.Types.ObjectId,
        default: null
    },

    // Number of times this document has been reserved by a training run
    // that did not end in "trained". Used by later phases to detect
    // chronically-failing feedback and route it to "needs_review".
    attempts: {
        type: Number,
        default: 0,
        min: [0, 'attempts cannot be negative']
    },

    // Short description of the most recent failure/rejection reason for
    // this document, if any (e.g. an unmapped category). Null when there
    // has been no failure.
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
    incomeDate: {
        type: Date,
        required: true
    },
    // Remediation Workstream B -- client-generated idempotency key for
    // income CREATION only (mirrors expenseSchema's own `id` field/unique
    // index, the established idempotency pattern in this codebase). Not
    // `required` and has no schema-level default: legacy income documents
    // created before this field existed simply never have it set, and must
    // remain valid/queryable exactly as before -- see the partial unique
    // index below for why that is safe.
    idempotencyKey: {
        type: String,
        default: undefined
    }
});



// Support per-user income lookups and date range queries.
IncomeSchema.index({ userId: 1, incomeDate: 1 });

// Remediation Workstream B -- durable database-level uniqueness for income
// creation, not just an application-level check. A PARTIAL index (not a
// plain unique index) is required here: a plain `unique: true` index on
// `{ userId, idempotencyKey }` would treat every document that lacks the
// field as `idempotencyKey: null` for indexing purposes, and MongoDB's
// unique index enforcement then rejects a SECOND missing-field document per
// userId as a duplicate of the first -- exactly the "every legacy missing
// value treated as the same key" trap. `partialFilterExpression` scopes this
// index to ONLY documents that actually have the field set, so existing
// income records created before this remediation (which have no
// idempotencyKey at all) are entirely excluded from the index and remain
// valid and unaffected, while every new income creation (which always sets
// this field, see Controllers/IncomeControllers/addincome.js) is protected.
//
// Exported as a single named spec (rather than inlined only here) so that
// backend/scripts/ensureIncomeIdempotencyIndex.js -- the deployment-time
// index-bootstrap script required because server startup does not await
// background index creation, see that script's header comment -- creates
// EXACTLY this index and nothing else, with zero risk of the two definitions
// drifting apart over time.
const INCOME_IDEMPOTENCY_INDEX = {
    key: { userId: 1, idempotencyKey: 1 },
    options: {
        unique: true,
        partialFilterExpression: { idempotencyKey: { $exists: true } },
        name: 'userId_1_idempotencyKey_1',
    },
};

IncomeSchema.index(INCOME_IDEMPOTENCY_INDEX.key, INCOME_IDEMPOTENCY_INDEX.options);

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
