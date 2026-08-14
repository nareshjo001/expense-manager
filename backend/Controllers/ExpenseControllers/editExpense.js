const mongoose = require('mongoose');
const { UserModel, ExpenseModel } = require('../../config/Schemas');
const { clearUserExpenseCache } = require('../../utils/expenseCache');
const { synchronizeAfterMutation, reserve, abandon } = require('../../Services/syncRecoveryService');
const { normalizeCategory } = require('../../utils/categoryNormalization');

// Category Normalization -- controlled 400 for an explicitly-supplied but
// invalid category, matching addexpense.js's own convention. Returned
// before reserve() and before any write is attempted.
const INVALID_CATEGORY_RESPONSE = {
    success: false,
    message: 'Expense category must be a valid, non-empty value.',
    errorCode: 'INVALID_CATEGORY',
};

// Remediation Workstream A -- edit-expense amount integrity. addexpense.js's
// route-level Joi schema (`expenseAmount: Joi.number().positive().required()`,
// Middlewares/AuthValidation.js) is never wired onto `PUT /update-expense`
// (Routes/expense.routes.js only applies `expenseValidation` to the add
// route), and editExpense.js itself performed no equivalent check before
// this fix -- an edit could persist `expenseAmount: 0`, a negative number,
// `NaN`/`Infinity`, or any other raw `req.body` value directly into Mongo,
// silently corrupting every downstream budget/report total derived from it.
//
// This mirrors, rather than duplicates, the add path's own contract: Joi's
// `Joi.number()` (with its default `convert: true`) accepts a real number OR
// a fully-numeric string and coerces it via the same rules `Number(...)`
// applies -- it does NOT accept a partially-numeric string like "100abc"
// (Joi's numeric coercion parses the ENTIRE string or rejects it, never a
// permissive `parseFloat` partial parse). `.positive()` additionally rejects
// zero and negative values. Reproducing that exact contract here (rather
// than importing Joi into this controller) keeps this check a pure,
// synchronous, dependency-free predicate that runs before any reservation or
// write.
//
// Explicitly rejected, all as `null` (never partially parsed, never coerced
// via truthiness):
//   - 0, negative numbers, NaN, Infinity, -Infinity (Number.isFinite/`> 0`)
//   - null, undefined (typeof guard below)
//   - empty or whitespace-only strings ("" / "   ")
//   - partially numeric strings ("100abc", "12,000") -- `Number(...)`
//     returns NaN for these, unlike `parseFloat`
//   - booleans -- `typeof` guard rejects them before ever reaching
//     `Number(true) === 1`
//   - arrays/objects -- `typeof` guard rejects them before ever reaching
//     `Number([])`/`Number([5]) === 5`'s surprising array-coercion behavior
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
  // release any reservation(s) already made if the primary update itself
  // never commits. See addexpense.js's identical pattern.
  // Phase C.3 -- budgetReservations/trueMonth reservation replaced by a
  // single broad userWideReservation (see reserve()'s doc comment for why:
  // it is valid regardless of which month the write actually lands in, so
  // no second post-write reservation call is needed to protect the true
  // result). `primaryWriteCommitted` is the fix for requirement #4: once
  // the update below is known to have actually landed, NOTHING in this
  // request may abandon its reservation(s) again, no matter what fails
  // afterward (cache clear, synchronize, response serialization) -- doing
  // so would erase the only durable evidence for already-committed work.
  // Phase C.4 -- `writeStatus` tracks the full write lifecycle, not just a
  // before/after commit boolean. `primaryWriteCommitted === true` alone is
  // not enough: if the findOneAndUpdate call below REJECTS (instead of
  // resolving, even with null), that rejection does NOT prove the update
  // never reached the server -- MongoDB can apply a write and then lose
  // the acknowledgement/connection before the driver ever sees success.
  // See writeStatus's possible values inline where they're set below.
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
        // expenseCategory in this edit (category is never made mandatory
        // for an edit that doesn't touch it -- an edit changing only the
        // amount, for instance, leaves `updates` without this key at all
        // and this block is skipped entirely). An explicitly-supplied but
        // invalid category (non-string, empty, whitespace-only) is
        // rejected with a controlled 400 BEFORE reserve() or any write --
        // never a silent default, never a Mongoose validation error
        // surfacing as a 500. The canonical/cleaned value replaces the raw
        // one in `updates` so the write below persists it directly.
        if (Object.prototype.hasOwnProperty.call(updates, 'expenseCategory')) {
            const normalizedCategory = normalizeCategory(updates.expenseCategory);
            if (normalizedCategory === null) {
                return res.status(400).json(INVALID_CATEGORY_RESPONSE);
            }
            updates.expenseCategory = normalizedCategory;
        }

        // Remediation Workstream A -- ONLY when the client actually supplied
        // expenseAmount in this edit (an edit that doesn't touch amount
        // leaves `updates` without this key at all, exactly like the
        // category block above, and this is skipped entirely). Runs BEFORE
        // reserve() and BEFORE the primary write -- an invalid amount is
        // rejected with a controlled 400 and produces no ML call, no
        // database mutation, no reservation, no cache/revision/report side
        // effect. The normalized (never raw) value replaces the one in
        // `updates` so the write below persists a real, validated number.
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
        // ONCE before the primary write, instead of C.2's pre-read guess
        // (which could name the wrong month if a concurrent edit already
        // moved this expense) followed by a SECOND corrective reservation
        // after the write landed. That second reservation was itself a
        // separate MongoDB round trip with its own crash window between
        // "write committed" and "true-month evidence durably stored". This
        // reservation is valid no matter which month the write below
        // actually affects, so nothing further needs to be reserved once
        // the write's true result is known -- see
        // Services/syncRecoveryService.js's reserve()/models/PendingSync.js
        // reservedUserWideReservations doc comments.
        const preWriteReservation = await reserve({
            userId: user._id,
            reserveUserWide: true,
            reserveReport: true,
        });
        userWideReservation = preWriteReservation.userWideReservation;
        reportReservation = preWriteReservation.reportReservation;

        // Update expense in database. Phase C.2 -- requests the PRIOR
        // (pre-update) document back via `new: false` rather than the
        // updated one, because the pre-write lookup above (`originalExpense`)
        // can be stale: a concurrent edit can move this exact expense to a
        // DIFFERENT month between that lookup and this write actually
        // landing. `priorExpense` reflects the document's TRUE state AT THE
        // MOMENT of this write, which is what's actually needed to
        // determine every month this edit really affects.
        // Phase C.4 -- writeStatus flips to "dispatched-ambiguous"
        // IMMEDIATELY BEFORE this call, not after it resolves. If this call
        // REJECTS, that is caught explicitly below and rethrown WITHOUT
        // ever advancing writeStatus past "dispatched-ambiguous" -- a
        // rejection here proves nothing about whether the update actually
        // landed at the server (see the module-level comment above). Only
        // a RESOLVED `null` (definitively: no document matched) is treated
        // as conclusive proof of no write.
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
            // abandon-gate treats "dispatched-ambiguous" the same as
            // "committed": the reservation survives for a later read to
            // repair, whether or not this update actually landed.
            throw writeErr;
        }

        if (!priorExpense) {
            // A RESOLVED null is a conclusive, definite proof: this exact
            // request's update matched no document (already-deleted, or no
            // longer owned by this user) -- release its reservation(s)
            // explicitly. This is the ONLY branch (besides the outer catch,
            // gated the same way) that ever abandons this attempt's
            // reservation.
            writeStatus = "no-write";
            await abandon({
                userId: user._id,
                userWideToken: userWideReservation && userWideReservation.token,
                reportToken: reportReservation && reportReservation.token,
            }).catch(() => {});
            return res.status(404).json({ message: 'Expense not found', success: false });
        }

        // The primary write is now KNOWN to have committed -- from this
        // point on, nothing may abandon userWideReservation/
        // reportReservation; any later failure only means derived-data
        // synchronization is still pending, which the reservation/Tier-1
        // marker already durably cover.
        writeStatus = "committed";
        primaryWriteCommitted = true;

        // Reconstruct the post-update document for the API response by
        // merging the exact fields this update set onto the TRUE prior
        // document -- equivalent to what `{ new: true }` would have
        // returned, since `updates` is the complete, exact $set applied.
        const updatedExpense = { ...priorExpense.toObject(), ...updates };

        // Phase C.3 -- concurrent month-target discovery, unchanged in
        // spirit from C.2: using the TRUE prior state
        // (priorExpense.expenseDate) and the TRUE new state
        // (updatedExpense.expenseDate) determines every month this edit
        // actually affects, covering the case where a concurrent edit
        // already moved this expense to a different month before THIS
        // write landed. Unlike C.2, NO second reserve() call is made here --
        // the single broad userWideReservation taken before the write
        // already durably covers whatever these true months turn out to
        // be; synchronizeAfterMutation()'s confirm() call converts it into
        // targeted Tier-1 work for these exact months atomically.
        // Phase C.4 fix -- `trueBudgetDates` MUST only ever contain real
        // Date instances, never `updatedExpense.expenseDate` directly.
        // `updatedExpense` is `{ ...priorExpense.toObject(), ...updates }`,
        // and when the client's edit changed the date, `updates.expenseDate`
        // is whatever raw value the client sent over the wire -- a plain
        // STRING for any normal JSON request (see addexpense.js's identical
        // fix/comment: Middlewares/AuthValidation.js's Joi validation never
        // reassigns `req.body`, so nothing upstream ever casts it).
        // syncRecoveryService.js's dedupeMonthAnchors() requires a strict
        // `instanceof Date` and silently DROPS anything else -- pushing the
        // raw string here meant an edit that actually moved an expense to a
        // new month never recorded Tier-1 pending work for that new month
        // (confirm()'s own dedupeMonthAnchors call would drop it too, while
        // still releasing the broad reservedUserWideReservations token in the SAME
        // call), reopening exactly the crash-gap window Phase C.3 closed,
        // specifically for the new-month case. `trueNewDate` (already
        // computed as a real `new Date(...)` two lines below) is the
        // correct value to push instead.
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
        // own functions already self-catch every Redis error), so it is
        // never part of the derived-data synchronization status below.
        await clearUserExpenseCache(user._id);

        // Recalculate budget month(s) and refresh the report. A failure in
        // either step no longer produces a 500 for an edit that already
        // committed -- see Services/syncRecoveryService.js for the durable
        // recovery marker and read-time repair this falls back to.
        const derivedData = await synchronizeAfterMutation({
            userId: user._id,
            budgetDates: trueBudgetDates,
            userWideToken: userWideReservation && userWideReservation.token,
            reportToken: reportReservation && reportReservation.token,
        });

        // Send response. The edit is authoritative and committed
        // regardless of derivedData.status -- only derivedData
        // distinguishes "fully synchronized" from "saved, still
        // synchronizing".
        res.status(200).json({
            message: 'Expense updated successfully!',
            data: updatedExpense,
            success: true,
            derivedData,
            replayed: false,
        });

  } catch (err) {
        // Phase C.3/C.4 requirement #4 -- abandon() may ONLY run when this
        // attempt's primary write is definitively known to have never
        // committed. That is now `writeStatus === "not-dispatched"` (the
        // findOneAndUpdate call was never reached) or
        // `writeStatus === "no-write"` (it resolved with a conclusive
        // `null`) -- NEVER "dispatched-ambiguous" (it rejected without
        // ruling out the update having actually landed) and NEVER
        // "committed". A failure reaching this catch from either of those
        // last two states (cache clear, synchronize, response
        // serialization, OR an ambiguous findOneAndUpdate rejection) means
        // derived-data sync is still pending for a mutation whose write
        // outcome is unknown-but-possibly-committed, and the reservation/
        // Tier-1 marker is the only durable evidence recovery has for it.
        // Abandoning it here would risk silently and permanently losing
        // that evidence.
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