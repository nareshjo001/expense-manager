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
        type: Boolean,
        default: false
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