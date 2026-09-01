const mongoose = require('mongoose');
const { UserModel, ExpenseModel } = require('../../config/Schemas');
const { clearUserExpenseCache } = require('../../utils/expenseCache');
const { synchronizeAfterMutation, reserve, abandon } = require('../../Services/syncRecoveryService');
const { normalizeCategory } = require('../../utils/categoryNormalization');
const { annotateRecurringState } = require('../../Services/RecurringServices/recurringStateService');

// Category Normalization -- controlled 400 for an explicitly-supplied but
const INVALID_CATEGORY_RESPONSE = {
    success: false,
    message: 'Expense category must be a valid, non-empty value.',
    errorCode: 'INVALID_CATEGORY',
};

// Remediation Workstream A -- edit-expense amount integrity. addexpense.js's
function normalizeExpenseAmount(rawValue) {
    if (typeof rawValue !== 'number' && typeof rawValue !== 'string') {
        return null;
    }
    if (typeof rawValue === 'string' && rawValue.trim() === '') {
        return null;
    }
    const normalized = Number(rawValue);
    if (!Number.isFinite(normalized) || normalized <= 0) {
        return null;
    }
    return normalized;
}

const INVALID_AMOUNT_RESPONSE = {
    success: false,
    message: 'Expense amount must be a valid, positive, finite number.',
    errorCode: 'INVALID_AMOUNT',
};

const editexpense = async (req, res) => {
  // Phase C.2 -- declared outside the try block so the catch below can
  let ownerUserId = null;
  let userWideReservation = null;
  let reportReservation = null;
  let primaryWriteCommitted = false;
  let writeStatus = "not-dispatched"; // not-dispatched | dispatched-ambiguous | no-write | committed

  try {
        // Check if user exists in database using authenticated userId
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }
        ownerUserId = user._id;

        // Get expense ID from query params
        const expenseId = req.query.editID;

        // Reject malformed expense IDs.
        if (!mongoose.Types.ObjectId.isValid(expenseId)) {
            return res.status(400).json({ message: 'Invalid expense ID', success: false });
        }

        // Find the original expense that belongs to this user
        const originalExpense = await ExpenseModel.findOne({
            _id: expenseId,
            userId: req.userId
        });

        // If expense is not found, return 404
        if (!originalExpense) {
            return res.status(404).json({ message: 'Expense not found', success: false });
        }

        // Accept only client-editable expense fields.
        const EDITABLE_FIELDS = [
            'expenseName',
            'expenseCategory',
            'expenseAmount',
            'expenseDate',
            'expenseDescription'
        ];

        const updates = {};
        for (const field of EDITABLE_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(req.body, field)) {
                updates[field] = req.body[field];
            }
        }

        // Category Normalization -- ONLY when the client actually supplied
        if (Object.prototype.hasOwnProperty.call(updates, 'expenseCategory')) {
            const normalizedCategory = normalizeCategory(updates.expenseCategory);
            if (normalizedCategory === null) {
                return res.status(400).json(INVALID_CATEGORY_RESPONSE);
            }
            updates.expenseCategory = normalizedCategory;
        }

        // Remediation Workstream A -- ONLY when the client actually supplied
        if (Object.prototype.hasOwnProperty.call(updates, 'expenseAmount')) {
            const normalizedAmount = normalizeExpenseAmount(updates.expenseAmount);
            if (normalizedAmount === null) {
                return res.status(400).json(INVALID_AMOUNT_RESPONSE);
            }
            updates.expenseAmount = normalizedAmount;
        }

        // Recalculate only when the amount or date changed.
        const amountOrDateChanged =
            Object.prototype.hasOwnProperty.call(updates, 'expenseAmount') ||
            Object.prototype.hasOwnProperty.call(updates, 'expenseDate');

        // Phase C.3 -- a single BROAD, month-agnostic reservation taken
        const preWriteReservation = await reserve({
            userId: user._id,
            reserveUserWide: true,
            reserveReport: true,
        });
        userWideReservation = preWriteReservation.userWideReservation;
        reportReservation = preWriteReservation.reportReservation;

        // Update expense in database. Phase C.2 -- requests the PRIOR
        writeStatus = "dispatched-ambiguous";
        let priorExpense;
        try {
            priorExpense = await ExpenseModel.findOneAndUpdate(
                { _id: expenseId, userId: req.userId },
                { $set: updates },
                { new: false }
            );
        } catch (writeErr) {
            // Ambiguous outcome -- rethrow untouched. The outer catch's
            throw writeErr;
        }

        if (!priorExpense) {
            // A RESOLVED null is a conclusive, definite proof: this exact
            writeStatus = "no-write";
            await abandon({
                userId: user._id,
                userWideToken: userWideReservation && userWideReservation.token,
                reportToken: reportReservation && reportReservation.token,
            }).catch(() => {});
            return res.status(404).json({ message: 'Expense not found', success: false });
        }

        // The primary write is now KNOWN to have committed -- from this
        writeStatus = "committed";
        primaryWriteCommitted = true;

        // Reconstruct the post-update document for the API response by
        const updatedExpense = { ...priorExpense.toObject(), ...updates };

        // Phase C.3 -- concurrent month-target discovery, unchanged in
        const trueBudgetDates = [];
        if (amountOrDateChanged) {
            trueBudgetDates.push(priorExpense.expenseDate);
            const trueOldDate = new Date(priorExpense.expenseDate);
            const trueNewDate = new Date(updatedExpense.expenseDate);
            if (
                trueOldDate.getMonth() !== trueNewDate.getMonth() ||
                trueOldDate.getFullYear() !== trueNewDate.getFullYear()
            ) {
                trueBudgetDates.push(trueNewDate);
            }
        }

        // Cache clearing is a pure optimization (utils/expenseCache.js's
        await clearUserExpenseCache(user._id);

        // Recalculate budget month(s) and refresh the report. A failure in
        const derivedData = await synchronizeAfterMutation({
            userId: user._id,
            budgetDates: trueBudgetDates,
            userWideToken: userWideReservation && userWideReservation.token,
            reportToken: reportReservation && reportReservation.token,
        });

        // isRecurring corrected against the authoritative
        const annotatedExpense = await annotateRecurringState(user._id, updatedExpense);

        // Send response. The edit is authoritative and committed
        res.status(200).json({
            message: 'Expense updated successfully!',
            data: annotatedExpense,
            success: true,
            derivedData,
            replayed: false,
        });

  } catch (err) {
        // Phase C.3/C.4 requirement #4 -- abandon() may ONLY run when this
        const canSafelyAbandon = writeStatus === "not-dispatched" || writeStatus === "no-write";
        if (
            ownerUserId &&
            canSafelyAbandon &&
            ((userWideReservation && userWideReservation.token) || (reportReservation && reportReservation.token))
        ) {
            await abandon({
                userId: ownerUserId,
                userWideToken: userWideReservation && userWideReservation.token,
                reportToken: reportReservation && reportReservation.token,
            }).catch(() => {});
        }

        // Catch unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { editexpense };