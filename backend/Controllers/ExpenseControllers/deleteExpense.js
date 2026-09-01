const mongoose = require('mongoose');
const { UserModel, ExpenseModel } = require('../../config/Schemas');
const { clearUserExpenseCache } = require('../../utils/expenseCache');
const { synchronizeAfterMutation, reserve, abandon } = require('../../Services/syncRecoveryService');

const deleteExpense = async (req, res) => {
    // Phase C.2 -- declared outside the try block so the catch below can
    let ownerUserId = null;
    let userWideReservation = null;
    let reportReservation = null;
    let primaryWriteCommitted = false;
    let writeStatus = "not-dispatched"; // not-dispatched | dispatched-ambiguous | no-write | committed

    try {
            // Verify user from JWT (set by auth middleware)
            const user = await UserModel.findById(req.userId);
            if(!user) {
                return res.status(401).json({ message: 'User does not exist', success: false});
            }
            ownerUserId = user._id;

            const expenseId = req.body.id;

            // Reject malformed expense IDs.
            if (!mongoose.Types.ObjectId.isValid(expenseId)) {
                return res.status(400).json({ message: 'Invalid expense ID', success: false });
            }

            // Phase C.1 -- a delete's affected month is NOT known until the
            const expenseToDelete = await ExpenseModel.findOne({
                _id: expenseId,
                userId: req.userId
            }).lean();

            if (!expenseToDelete) {
                return res.status(404).json({
                    message: "Expense not found",
                    success: false
                });
            }

            // Phase C.3 -- a single BROAD, month-agnostic reservation taken
            const preWriteReservation = await reserve({
                userId: user._id,
                reserveUserWide: true,
                reserveReport: true,
            });
            userWideReservation = preWriteReservation.userWideReservation;
            reportReservation = preWriteReservation.reportReservation;

            // Find and delete expense that belongs to this user.
            writeStatus = "dispatched-ambiguous";
            let deletedExpense;
            try {
                deletedExpense = await ExpenseModel.findOneAndDelete({
                    _id: expenseId,
                    userId: req.userId
                });
            } catch (writeErr) {
                // Ambiguous outcome -- rethrow untouched. The outer catch's
                throw writeErr;
            }

            // If expense was found and deleted
            if (deletedExpense) {

                // The primary write is now KNOWN to have committed --
                writeStatus = "committed";
                primaryWriteCommitted = true;

                // Cache clearing is a pure optimization (utils/expenseCache.js's
                await clearUserExpenseCache(user._id);

                // Phase C.3 -- the delete's TRUE affected month is
                const derivedData = await synchronizeAfterMutation({
                    userId: user._id,
                    budgetDates: [deletedExpense.expenseDate],
                    userWideToken: userWideReservation && userWideReservation.token,
                    reportToken: reportReservation && reportReservation.token,
                });

                // The delete is authoritative and committed regardless of
                return res.status(200).json({
                    message: "Expense deleted successfully",
                    success: true,
                    derivedData,
                    replayed: false,
                });

            } else {
                // A RESOLVED null is a conclusive, definite proof: the
                writeStatus = "no-write";
                await abandon({
                    userId: user._id,
                    userWideToken: userWideReservation && userWideReservation.token,
                    reportToken: reportReservation && reportReservation.token,
                }).catch(() => {});

                return res.status(404).json({
                    message: "Expense not found",
                    success: false
                });
            }

        } catch(err) {
            // Phase C.3/C.4 requirement #4 -- abandon() may ONLY run when
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

            // Generic server error response
            console.error(err);
            res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { deleteExpense };