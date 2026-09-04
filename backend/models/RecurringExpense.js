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
    }
});

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