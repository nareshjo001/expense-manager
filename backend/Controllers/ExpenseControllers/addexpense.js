const { UserModel, ExpenseModel, MlFeedbackModel } = require('../../config/Schemas');
const { clearUserExpenseCache } = require('../../utils/expenseCache');
const { synchronizeAfterMutation, reserve, abandon } = require('../../Services/syncRecoveryService');
const axios = require("axios");

// Lowercases + trims for comparison only; never throws on missing/non-string input.
const normalizeForComparison = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
};

// Phase C -- Expense Mutation Reliability: add-expense idempotency.
//
// `id` is the client-supplied identifier already protected by
// config/Schemas.js's existing `expenseSchema.index({ userId: 1, id: 1 },
// { unique: true })`. Before Phase C, a retried add with a REUSED id fell
// through to an uncaught Mongo E11000 duplicate-key error on
// `newExpense.save()`, which the outer catch turned into a generic 500 --
// indistinguishable from a genuine failure, and never a successful replay.
//
// The fingerprint below is the "materially the same request" check: the
// four fields that answer "is this economically the same expense" --
// name, category, amount, date. Deliberately excludes
// expenseDescription/mlPredictedCategory/mlConfidence/wasMlCorrected
// (incidental metadata, not the expense's identity) and never includes any
// server-generated timestamp.
const isSameExpensePayload = (stored, incoming) => {
  if (!stored) return false;

  const nameMatches =
    String(stored.expenseName ?? '').trim() === String(incoming.expenseName ?? '').trim();
  const categoryMatches =
    String(stored.expenseCategory ?? '').trim() === String(incoming.expenseCategory ?? '').trim();
  const amountMatches = Number(stored.expenseAmount) === Number(incoming.expenseAmount);

  const storedDate = new Date(stored.expenseDate);
  const incomingDate = new Date(incoming.expenseDate);
  const dateMatches =
    !Number.isNaN(storedDate.getTime()) &&
    !Number.isNaN(incomingDate.getTime()) &&
    storedDate.getTime() === incomingDate.getTime();

  return nameMatches && categoryMatches && amountMatches && dateMatches;
};

const IDEMPOTENCY_CONFLICT_RESPONSE = {
  success: false,
  message: 'A different expense was already submitted with this request identifier.',
  errorCode: 'IDEMPOTENCY_KEY_CONFLICT',
};

// Builds the replay success response: the identical 2xx contract a first
// attempt would have received, plus `replayed: true`. Re-runs
// synchronizeAfterMutation() (cheap and fully idempotent -- see
// Services/syncRecoveryService.js) so a replay gets a genuine chance to
// resolve any derived-data work the ORIGINAL attempt left pending, rather
// than only ever reporting stale sync status.
const buildReplayResponse = async (userId, existingExpense) => {
  const derivedData = await synchronizeAfterMutation({
    userId,
    budgetDates: [existingExpense.expenseDate],
  });

  return {
    message: 'Expense Created Successfully',
    success: true,
    data: existingExpense,
    derivedData,
    replayed: true,
  };
};

// Server-derived source of truth for whether a genuine ML correction occurred.
// The client-supplied `wasMlCorrected` flag is no longer trusted directly —
// it is recomputed here from the actual predicted vs. saved category.
// Returns { hasPrediction, corrected }:
//   hasPrediction=false  -> no valid ML prediction was involved at all
//   hasPrediction=true, corrected=false -> prediction accepted as-is
//   hasPrediction=true, corrected=true  -> user's saved category differs from the prediction
const deriveMlCorrection = (mlPredictedCategory, expenseCategory) => {
  const predicted = normalizeForComparison(mlPredictedCategory);

  if (!predicted) {
    return { hasPrediction: false, corrected: false };
  }

  const actual = normalizeForComparison(expenseCategory);
  return { hasPrediction: true, corrected: predicted !== actual };
};

const addExpense = async (req, res) => {
  // Phase C.2 -- declared outside the try block so the catch below can
  // reach them: if reserve() succeeds but the primary write never
  // commits, this attempt's own reservation(s) are known-orphaned (no
  // write is coming from THIS request) and should be explicitly released
  // via abandon() rather than left to age out and be defensively (but
  // needlessly) recomputed later. See Services/syncRecoveryService.js's
  // abandon() doc comment.
  // Phase C.3 requirement #4 -- primaryWriteCommitted is set true the
  // instant newExpense.save() below actually succeeds. The outer catch's
  // comment previously ASSERTED (without enforcing) that it is "reached
  // only when the PRIMARY expense write itself did not commit" -- that was
  // not actually true: clearUserExpenseCache, synchronizeAfterMutation, or
  // response serialization can all still throw AFTER a successful save()
  // and land in the same outer catch. This flag makes the guarantee real:
  // once true, nothing may abandon this attempt's reservation(s), because a
  // failure past that point means derived-data sync is still pending for an
  // ALREADY-COMMITTED expense, and the reservation/Tier-1 marker is the
  // only durable evidence recovery has for it.
  //
  // Phase C.4 -- `primaryWriteCommitted === true` is not the only case that
  // must protect the reservation. `writeStatus` tracks the FULL lifecycle:
  //   "not-dispatched"       -- save() has not been called at all yet (or
  //                             failed before ever being called, e.g. the
  //                             ML feedback save above) -- abandoning is
  //                             safe, nothing was ever sent to Mongo.
  //   "dispatched-ambiguous" -- save() has been called and has not yet
  //                             resolved with a KNOWN outcome. If save()
  //                             REJECTS while in this state (for any reason
  //                             other than the E11000 duplicate-key replay
  //                             race below), that rejection does NOT prove
  //                             the insert never reached the server --
  //                             MongoDB can apply a write and then lose the
  //                             acknowledgement/connection before the
  //                             driver ever sees success (a documented
  //                             behavior, not a hypothetical). Abandoning
  //                             the reservation here would risk erasing the
  //                             only durable evidence for a write that may
  //                             have actually committed.
  //   "no-write"              -- a DEFINITE proof this exact attempt's
  //                             insert never landed (currently: the E11000
  //                             duplicate-key branch below, where the
  //                             unique index itself rejected the insert,
  //                             and the winning document belongs to a
  //                             DIFFERENT request).
  //   "committed"             -- save() resolved successfully.
  // Abandoning is only ever safe from "not-dispatched" or "no-write" --
  // NEVER from "dispatched-ambiguous" or "committed".
  let ownerUserId = null;
  let budgetReservations = [];
  let reportReservation = null;
  let primaryWriteCommitted = false;
  let writeStatus = "not-dispatched";

  try {
    // Destructure expense data from request body
    const { id, expenseName, expenseCategory, expenseAmount, expenseDate, expenseDescription, mlPredictedCategory, mlConfidence, wasMlCorrected } = req.body;

    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }
    ownerUserId = user._id;

    // Idempotency check -- BEFORE any write. Ownership-scoped: the lookup
    // is always { userId: req.userId, id }, so another user's request
    // identifier can never be replayed or inspected here.
    const existingById = await ExpenseModel.findOne({ userId: user._id, id }).lean();
    if (existingById) {
      if (isSameExpensePayload(existingById, { expenseName, expenseCategory, expenseAmount, expenseDate })) {
        const replayResponse = await buildReplayResponse(user._id, existingById);
        return res.status(201).json(replayResponse);
      }
      return res.status(409).json(IDEMPOTENCY_CONFLICT_RESPONSE);
    }

    let finalDescription = expenseDescription;
    
    // Generate a description via ML when none was provided.
    if (!expenseDescription || expenseDescription.trim() === '') {
        try {
            const response = await axios.post(
              `${process.env.ML_ROUTE}/generate-description`,
              {
                  expenseName,
                  expenseCategory,
                  expenseAmount
              },
              { timeout: 5000 }
            );

            finalDescription = response.data.description;
        } catch (mlErr) {
            console.error('ML description generation failed, falling back to "Others":', mlErr.message);
            finalDescription = "";
        }
    }

    // Create new expense document linked to the authenticated user
    const newExpense = new ExpenseModel({
        userId: user._id,
        id,
        expenseName,
        expenseCategory,
        expenseAmount,
        expenseDate,
        expenseDescription: finalDescription,
        mlPredictedCategory,
        mlConfidence,
        wasMlCorrected
    });

    // Create new ML feedback document if a genuine ML prediction is available.
    // `corrected` and `status` are derived server-side from the actual
    // predicted vs. saved category — the client-supplied `wasMlCorrected`
    // flag is not trusted for this decision (see deriveMlCorrection above).
    const { hasPrediction, corrected: mlCorrected } = deriveMlCorrection(
      mlPredictedCategory,
      expenseCategory
    );

    if (hasPrediction && mlConfidence !== undefined) {
        const mlFeedback = new MlFeedbackModel({
            expenseName,
            predictedCategory: mlPredictedCategory,
            actualCategory: expenseCategory,
            confidence: mlConfidence,
            // Backward compatibility: the current cron and export_feedback.py
            // still read this boolean directly (Phase A keeps it in sync with
            // `status` rather than migrating those readers yet).
            corrected: mlCorrected,
            // "pending" only for a genuine, server-confirmed correction.
            // Accepted predictions are left as status: null — never assigned
            // "trained" at creation time; that only happens once a real
            // training run has consumed this document (later phases).
            status: mlCorrected ? 'pending' : null,
            userId: user._id
        });
        await mlFeedback.save();
    }

    // Phase C.1 -- reserve BEFORE the primary write. This is the durable,
    // pre-write evidence that survives a process crash/client disconnect
    // between the write below committing and the post-write confirm() call
    // inside synchronizeAfterMutation() -- see
    // Services/syncRecoveryService.js's reserve() doc comment for why a
    // marker written only AFTER the write (Phase C's original design) is
    // not sufficient, and why this is not simply a plain marker moved
    // earlier.
    //
    // Phase C.4 fix -- this MUST pass `newExpense.expenseDate` (the
    // Mongoose-schema-cast Date instance), never the raw destructured
    // `expenseDate` from req.body. Middlewares/AuthValidation.js's Joi
    // schema validates the incoming body but never reassigns
    // `req.body = value`, so the raw `expenseDate` variable here remains
    // whatever the client sent over the wire -- a plain STRING for any
    // normal JSON request. syncRecoveryService.js's own
    // dedupeMonthAnchors() requires a strict `instanceof Date` and
    // silently DROPS anything else (see its own doc comment) -- so passing
    // the raw string here meant this reservation's `budgetReservations`
    // was ALWAYS empty in practice, regardless of `reserveReport`,
    // defeating the entire crash-gap closure for add's per-month evidence
    // without ever surfacing an error. `newExpense.expenseDate` is
    // guaranteed to be a real Date (config/Schemas.js's `expenseDate: Date`
    // field casts it at construction time, independent of the middleware
    // gap above), and is the exact same value already relied on later for
    // the real recompute (see synchronizeAfterMutation's own
    // `budgetDates: [newExpense.expenseDate]` call below).
    const reserved = await reserve({
      userId: user._id,
      budgetDates: [newExpense.expenseDate],
      reserveReport: true,
    });
    budgetReservations = reserved.budgetReservations;
    reportReservation = reserved.reportReservation;

    // Save expense to database. This is the point the expense mutation
    // becomes permanent -- every response from here on must reflect that,
    // even if the derived-data work below fails.
    //
    // Phase C.4 -- writeStatus flips to "dispatched-ambiguous" IMMEDIATELY
    // BEFORE this call, not after it resolves. If save() rejects, the
    // catch below only ever escalates writeStatus to "no-write" for the
    // ONE error shape (E11000) that conclusively proves this exact attempt
    // never inserted anything; every other rejection leaves writeStatus at
    // "dispatched-ambiguous" and is rethrown, so the outer catch's
    // abandon-gate correctly treats it the same as a committed write.
    writeStatus = "dispatched-ambiguous";
    try {
      await newExpense.save();
      writeStatus = "committed";
    } catch (saveErr) {
      // A concurrent duplicate request (same userId+id) won the race
      // between the lookup above and this save -- config/Schemas.js's own
      // unique index rejected it. This is NOT a genuine write failure; the
      // other request's document is the authoritative one. Resolve it the
      // same way a sequential replay would, rather than surfacing Mongo's
      // duplicate-key error as a generic 500.
      if (saveErr && saveErr.code === 11000) {
        // This attempt's OWN write definitively did not happen -- MongoDB's
        // unique index enforces this atomically at insert time, so an
        // E11000 here unambiguously means THIS insert never landed (the
        // conflicting document belongs to a different request). Release
        // this attempt's reservation(s) rather than leaving them to age
        // out. The winning request's own reserve()/confirm() cycle (or, if
        // it also failed, a defensive Tier-2 recompute) is what actually
        // covers this month/report; buildReplayResponse()'s own
        // synchronizeAfterMutation call below is independent of these
        // tokens entirely.
        writeStatus = "no-write";
        await abandon({
          userId: user._id,
          budgetTokens: budgetReservations.map((r) => r.token),
          reportToken: reportReservation && reportReservation.token,
        }).catch(() => {});

        const winner = await ExpenseModel.findOne({ userId: user._id, id }).lean();
        if (winner && isSameExpensePayload(winner, { expenseName, expenseCategory, expenseAmount, expenseDate })) {
          const replayResponse = await buildReplayResponse(user._id, winner);
          return res.status(201).json(replayResponse);
        }
        return res.status(409).json(IDEMPOTENCY_CONFLICT_RESPONSE);
      }
      // Phase C.4 -- every other rejection (network/timeout/write-concern/
      // connection errors, etc.) is AMBIGUOUS: it does not prove the
      // insert never reached the server, only that this request never saw
      // a successful acknowledgement. writeStatus stays
      // "dispatched-ambiguous" -- rethrown to the outer catch, whose
      // abandon-gate preserves the reservation for read-time repair rather
      // than risking the loss of durable evidence for a write that may
      // have actually committed.
      throw saveErr;
    }

    // The primary write is now KNOWN to have committed -- from this point
    // on, nothing may abandon budgetReservations/reportReservation; see the
    // primaryWriteCommitted doc comment above.
    primaryWriteCommitted = true;

    // Cache clearing is a pure optimization (utils/expenseCache.js's own
    // functions already self-catch every Redis error), so it is never part
    // of the derived-data synchronization status below.
    await clearUserExpenseCache(user._id);

    // Recalculate the budget and refresh the report. A failure in EITHER
    // step no longer produces a 500 for an expense that already committed
    // -- see Services/syncRecoveryService.js for the durable recovery
    // marker and read-time repair this falls back to. Passes the
    // reservation token(s) obtained above so confirm() (the first step
    // inside synchronizeAfterMutation) can release them atomically with
    // recording the immediately-repair-eligible Tier-1 marker.
    const derivedData = await synchronizeAfterMutation({
      userId: user._id,
      budgetDates: [newExpense.expenseDate],
      budgetTokens: budgetReservations.map((r) => r.token),
      reportToken: reportReservation && reportReservation.token,
    });

    // Send success response. The expense is authoritative and committed
    // regardless of derivedData.status -- only derivedData distinguishes
    // "fully synchronized" from "saved, still synchronizing".
    res.status(201).json({
      message: 'Expense Created Successfully',
      success: true,
      data: newExpense,
      derivedData,
      replayed: false,
    });

  } catch (err) {
    // Phase C.3/C.4 requirement #4 -- abandon() may ONLY run when this
    // attempt's primary write is definitively known to have never
    // committed. That is now `writeStatus === "not-dispatched"` (save()
    // was never even called) or `writeStatus === "no-write"` (the E11000
    // branch above, a conclusive proof) -- NEVER "dispatched-ambiguous"
    // (save() rejected for a reason that does not rule out the write
    // having actually landed) and NEVER "committed".
    const canSafelyAbandon = writeStatus === "not-dispatched" || writeStatus === "no-write";
    if (
      ownerUserId &&
      canSafelyAbandon &&
      (budgetReservations.length > 0 || (reportReservation && reportReservation.token))
    ) {
      await abandon({
        userId: ownerUserId,
        budgetTokens: budgetReservations.map((r) => r.token),
        reportToken: reportReservation && reportReservation.token,
      }).catch(() => {});
    }

    // Send generic server error response.
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { addExpense };