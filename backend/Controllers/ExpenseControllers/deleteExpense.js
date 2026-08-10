const mongoose = require('mongoose');
const { UserModel, ExpenseModel } = require('../../config/Schemas');
const { clearUserExpenseCache } = require('../../utils/expenseCache');
const { synchronizeAfterMutation, reserve, abandon } = require('../../Services/syncRecoveryService');

const deleteExpense = async (req, res) => {
    // Phase C.2 -- declared outside the try block so the catch below can
    // release any reservation(s) already made if the primary delete itself
    // never commits. See addexpense.js's identical pattern.
    // Phase C.3 -- see editExpense.js's identical comment: budgetReservations
    // and the second corrective reserve() call are replaced by a single
    // broad userWideReservation taken before the delete, and
    // primaryWriteCommitted gates every abandon() call so a committed
    // delete's reservation can never be released after the fact.
    // Phase C.4 -- see editExpense.js's identical comment: `writeStatus`
    // tracks the full write lifecycle (not just a before/after commit
    // boolean), because a REJECTED findOneAndDelete does not prove the
    // delete never reached the server -- MongoDB can apply a write and
    // then lose the acknowledgement/connection before the driver ever
    // sees success.
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
            // document is read (unlike add/edit, where the request body
            // already carries the date). A pre-delete lookup is required so
            // reserve() can run BEFORE the actual delete, giving durable
            // crash evidence for the SAME reasons add/edit need it -- a hard
            // delete leaves no surviving expense document afterward, so a
            // timestamp/count-based recovery signal is not available; the
            // reservation is the only evidence. This lookup does not
            // authorize anything by itself -- the actual delete below still
            // independently re-verifies { _id, userId } atomically, so a
            // race where the document is removed between this read and the
            // delete below simply results in the existing 404 path, not a
            // false reservation used for an unauthorized deletion.
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
            // ONCE before the primary delete. See editExpense.js's and
            // Services/syncRecoveryService.js's identical reasoning: this
            // reservation is valid no matter which month the delete below
            // actually affects, so no second, post-write reservation call
            // is needed to protect the true result.
            const preWriteReservation = await reserve({
                userId: user._id,
                reserveUserWide: true,
                reserveReport: true,
            });
            userWideReservation = preWriteReservation.userWideReservation;
            reportReservation = preWriteReservation.reportReservation;

            // Find and delete expense that belongs to this user.
            //
            // Phase C.4 -- writeStatus flips to "dispatched-ambiguous"
            // IMMEDIATELY BEFORE this call. If it REJECTS, that is caught
            // explicitly below and rethrown WITHOUT ever advancing
            // writeStatus past "dispatched-ambiguous" -- a rejection here
            // proves nothing about whether the delete actually landed.
            // Only a RESOLVED outcome (truthy doc = committed, null =
            // conclusively no matching document) is treated as known.
            writeStatus = "dispatched-ambiguous";
            let deletedExpense;
            try {
                deletedExpense = await ExpenseModel.findOneAndDelete({
                    _id: expenseId,
                    userId: req.userId
                });
            } catch (writeErr) {
                // Ambiguous outcome -- rethrow untouched. The outer catch's
                // abandon-gate treats "dispatched-ambiguous" the same as
                // "committed": the reservation survives for a later read to
                // repair, whether or not this delete actually landed.
                throw writeErr;
            }

            // If expense was found and deleted
            if (deletedExpense) {

                // The primary write is now KNOWN to have committed --
                // nothing past this point may abandon userWideReservation/
                // reportReservation; a later failure only means derived-data
                // sync is still pending, which the reservation/Tier-1
                // marker already durably cover (Phase C.3 requirement #4).
                writeStatus = "committed";
                primaryWriteCommitted = true;

                // Cache clearing is a pure optimization (utils/expenseCache.js's
                // own functions already self-catch every Redis error), so it
                // is never part of the derived-data synchronization status
                // below.
                await clearUserExpenseCache(user._id);

                // Phase C.3 -- the delete's TRUE affected month is
                // deletedExpense.expenseDate (the delete's own result, not
                // the pre-read guess -- a concurrent edit could have moved
                // this exact expense to a different month between the
                // pre-read and this delete actually landing). Unlike C.2, NO
                // second reserve() call is made here -- the single broad
                // userWideReservation taken before the delete already
                // durably covers whatever this true month turns out to be;
                // synchronizeAfterMutation()'s confirm() call converts it
                // into targeted Tier-1 work for this exact month atomically,
                // closing the crash window a second reservation round trip
                // used to leave open.
                //
                // Recalculate the deleted expense's TRUE month and refresh
                // the report. A failure in either step no longer produces a
                // 500 for a delete that already committed -- see
                // Services/syncRecoveryService.js for the durable recovery
                // marker and read-time repair this falls back to. This also
                // correctly reconstructs state when the deletion removed the
                // newest expense, or the only expense in its month:
                // recalculateBudget's own aggregate naturally sums to 0 when
                // no expenses remain in that month, and the report is fully
                // regenerated from whatever expenses remain.
                const derivedData = await synchronizeAfterMutation({
                    userId: user._id,
                    budgetDates: [deletedExpense.expenseDate],
                    userWideToken: userWideReservation && userWideReservation.token,
                    reportToken: reportReservation && reportReservation.token,
                });

                // The delete is authoritative and committed regardless of
                // derivedData.status -- only derivedData distinguishes
                // "fully synchronized" from "saved, still synchronizing".
                return res.status(200).json({
                    message: "Expense deleted successfully",
                    success: true,
                    derivedData,
                    replayed: false,
                });

            } else {
                // A RESOLVED null is a conclusive, definite proof: the
                // document vanished between the pre-read and the actual
                // delete (e.g. a concurrent delete of the same expense won
                // the race) -- this attempt's own write never happened.
                // Release its reservation(s) explicitly.
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
            // this attempt's primary delete is definitively known to have
            // never committed. That is now `writeStatus === "not-dispatched"`
            // or `writeStatus === "no-write"` -- NEVER "dispatched-ambiguous"
            // (findOneAndDelete rejected without ruling out the delete
            // having actually landed) and NEVER "committed". A failure
            // reaching this catch from either of those last two states
            // means derived-data sync is still pending for a delete whose
            // outcome is unknown-but-possibly-committed, and the
            // reservation/Tier-1 marker is the only durable evidence
            // recovery has for it. Abandoning it here would risk silently
            // and permanently losing that evidence.
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