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
        // Kept temporarily for backward compatibility: the current backend cron
        // (feedbackCollector.js) and the ML-service export script
        // (training/export_feedback.py) still read/write this boolean directly.
        // Do not remove until those readers are migrated to `status` (Phase C).
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
    }
});
    


// Support per-user income lookups and date range queries.
IncomeSchema.index({ userId: 1, incomeDate: 1 });

const ExpenseModel = mongoose.model('expenses', expenseSchema);
const UserModel = mongoose.model('users', userSchema);
const IncomeModel = mongoose.model('incomes', IncomeSchema);
const BudgetModel = mongoose.model('budget', budgetSchema);
const MlFeedbackModel = mongoose.model('mlFeedback', MlFeedbackSchema);
module.exports = { UserModel, ExpenseModel, IncomeModel, BudgetModel, MlFeedbackModel };