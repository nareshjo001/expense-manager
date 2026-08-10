// Phase C -- Expense Mutation Reliability.
//
// Durable, per-user marker recording that a committed expense mutation's
// derived-data synchronization (budget recalculation and/or report
// refresh) did not finish. This is the ONLY thing that survives a process
// restart or a client disconnect for this purpose -- everything else in
// the recovery design (budget.service.js's recalculateBudget,
// reportService.js's refreshReport) is already a pure, idempotent
// recomputation from the authoritative `expenses` collection, so recovery
// never needs to store WHAT changed, only THAT something still needs
// recomputing.
//
// One document per user (unique index on `user`, mirroring models/Report.js's
// own one-document-per-user convention). `revision` is a monotonically
// increasing counter bumped only when a controller discovers NEW pending
// work after a committed mutation -- never bumped by a repair attempt
// itself. This is the compare-and-set guard read-time repair uses so an
// older, slower repair can never clear a newer mutation's still-pending
// work (see Services/syncRecoveryService.js's clearIfRevisionMatches()).
"use strict";

const mongoose = require("mongoose");
const { Schema } = mongoose;

const pendingSyncSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "users",
      required: true,
      unique: true,
      index: true,
    },

    // Bumped every time a controller records NEW pending work for this
    // user. A repair attempt reads this value first and only clears the
    // marker via a compare-and-set on the SAME value it read -- if another
    // mutation bumped it in the meantime, the clear is rejected and the
    // marker correctly stays pending.
    revision: {
      type: Number,
      required: true,
      default: 0,
    },

    // Distinct calendar months (first-of-month anchors) whose stored
    // budget.spent may not reflect the latest committed expense state.
    // budget.service.js's recalculateBudget(userId, date) is idempotent --
    // repairing the same month twice is always safe -- so this array only
    // needs to name WHICH months, never a delta to apply.
    pendingBudgetMonths: {
      type: [Date],
      default: [],
    },

    // Whether the persisted FinancialReport may not reflect the latest
    // committed expense state. reportService.refreshReport() fully
    // regenerates the report from scratch every call, so, like budget
    // repair, this only needs to be a flag, never a delta.
    reportPending: {
      type: Boolean,
      default: false,
    },

    // Sanitized (message-only, no stack trace, no financial document
    // content) description of the most recent synchronization failure,
    // for operational visibility. Bounded length -- never an unbounded
    // history array, only the single most recent attempt.
    lastError: {
      type: String,
      default: null,
      maxlength: 500,
    },

    lastAttemptAt: {
      type: Date,
      default: null,
    },

    // -- Phase C.1 (crash-gap closure) --------------------------------
    //
    // The fields above (`pendingBudgetMonths`/`reportPending`) are ONLY
    // ever written AFTER a controller has already learned that a sync
    // step failed (or, as of C.1, unconditionally right after the
    // primary write commits -- see syncRecoveryService.confirm()). That
    // leaves a real gap: if the process exits between the primary
    // expense write committing and that confirm step running, NO durable
    // evidence survives, and repairIfPending() has nothing to find.
    //
    // These reservation fields close that gap by being written BEFORE
    // the primary write (see syncRecoveryService.reserve()). They are
    // deliberately a SEPARATE tier from pendingBudgetMonths/reportPending
    // and are NOT treated as immediately repair-eligible by
    // repairIfPending() -- only once a reservation's `reservedAt` is
    // older than RESERVATION_STALE_MS is it treated as evidence of an
    // abandoned/crashed mutation. That age-gate is what prevents the
    // exact race this phase's brief warns against: a concurrent repair
    // reading a reservation and clearing it BEFORE the reservation's own
    // owning request has actually performed its write. Each reservation
    // carries its own random `token` (not the shared `revision` counter)
    // so a fresh reservation for the same month/report is never confused
    // with, or accidentally cleared by, a stale one.
    reservedBudgetMonths: {
      type: [
        {
          _id: false,
          month: { type: Date, required: true },
          token: { type: String, required: true },
          reservedAt: { type: Date, required: true },
        },
      ],
      default: [],
    },

    reservedReport: {
      type: {
        _id: false,
        token: { type: String, default: null },
        reservedAt: { type: Date, default: null },
      },
      default: () => ({ token: null, reservedAt: null }),
    },

    // -- Phase C.3 (post-write corrective-reservation gap closure) -----
    //
    // C.2's edit/delete controllers reserved the PRE-READ (possibly stale)
    // month before the write, then reserved the TRUE month a SECOND time
    // AFTER the write committed. That second reserve() call is itself a
    // separate MongoDB round trip with its own failure/crash window
    // between "write committed" and "true-month reservation durably
    // stored" -- during which the true month has NO valid recovery
    // evidence at all if the process dies.
    //
    // reservedUserWide closes this by being the ONLY reservation edit/
    // delete take, and it is taken ONCE, BEFORE the primary write --
    // exactly like reservedReport already is. It does not name a specific
    // month because, at reservation time, the write has not happened yet
    // and its true effect cannot be known with certainty (a concurrent
    // mutation could still move the document). Recovery of a stale
    // reservedUserWide (see Services/syncRecoveryService.js's
    // repairIfPending Tier-2 pass) therefore reconstructs EVERY existing
    // BudgetModel month for this user from authoritative expense data,
    // not just one -- correct regardless of which month the write actually
    // affected, including a month whose expense total is now zero.
    // confirm() atomically converts this into targeted Tier-1 work (using
    // the mutation's now-known true result) and releases the token, in the
    // exact same call that already records Tier-1 pending state -- no
    // separate post-write reservation round trip remains at all.
    reservedUserWide: {
      type: {
        _id: false,
        token: { type: String, default: null },
        reservedAt: { type: Date, default: null },
      },
      default: () => ({ token: null, reservedAt: null }),
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("PendingSync", pendingSyncSchema);
