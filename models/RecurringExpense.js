const mongoose = require('mongoose');
const { Schema } = mongoose;

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

const RecurringExpenseModel = mongoose.model(
    'recurringExpenses',
    RecurringExpenseSchema
);

module.exports = { RecurringExpenseModel };