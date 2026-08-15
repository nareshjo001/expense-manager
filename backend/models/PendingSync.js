// Durable, per-user marker recording that a committed expense mutation's derived-data sync (budget recalc/report refresh) did not finish -- the ONLY thing that survives a process restart, since recovery is a pure idempotent recomputation from `expenses` and only needs to know THAT something needs recomputing, not WHAT changed. One document per user; `revision` is a monotonic counter bumped only on new pending work, used as the compare-and-set guard so an older repair can never clear a newer mutation's pending work (see syncRecoveryService.js's clearIfRevisionMatches()).
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

    // Bumped every time a controller records NEW pending work. A repair reads this first and clears the marker only via compare-and-set on the SAME value -- if another mutation bumped it meanwhile, the clear is rejected and the marker stays pending.
    revision: {
      type: Number,
      required: true,
      default: 0,
    },

    // Distinct calendar months whose stored budget.spent may be stale -- recalculateBudget() is idempotent, so this only needs to name WHICH months, never a delta.
    pendingBudgetMonths: {
      type: [Date],
      default: [],
    },

    // Whether the persisted FinancialReport may be stale -- refreshReport() fully regenerates from scratch, so this only needs to be a flag, never a delta.
    reportPending: {
      type: Boolean,
      default: false,
    },

    // Sanitized (message-only, no stack trace/financial content) description of the most recent sync failure -- bounded length, only the single most recent attempt, never a history array.
    lastError: {
      type: String,
      default: null,
      maxlength: 500,
    },

    lastAttemptAt: {
      type: Date,
      default: null,
    },

    // Crash-gap closure: pendingBudgetMonths/reportPending are only written AFTER a sync failure or right after the primary write commits (confirm()) -- leaving a gap if the process dies between commit and confirm. These reservation fields close it by being written BEFORE the primary write (reserve()) as a separate tier, not immediately repair-eligible: only once `reservedAt` is older than RESERVATION_STALE_MS is it treated as an abandoned/crashed mutation, preventing a concurrent repair from clearing a reservation before its owner has actually written. Each reservation carries its own random `token` (not the shared `revision`) so a fresh reservation is never confused with a stale one.
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

    // System-wide reservation-ownership correction: the ORIGINAL reservedReport/reservedUserWide were single OBJECTS written via unconditional $set, so a second reserve() silently overwrote an earlier unconfirmed reservation's token, and abandon() cleared the field with no check the token still matched -- confirmed hazard (see tests/syncRecoveryService.reservationOwnership.test.js): R1 reserves and commits, crashes before confirm(); R2 reserves (overwriting R1's token), fails, abandons -- R1's committed mutation loses all durable sync evidence. Fixed by making reservedReports/reservedUserWideReservations arrays (like reservedBudgetMonths already was), with per-token $push/$pull ownership so concurrent reservations coexist independently. The legacy single-object field names are NOT reused for the new array fields (avoiding a live type change on documents outside this service's migration control) but ARE still declared and READ-AND-CLEAR only (never written a new value again) -- omitting them would permanently lose evidence from an old-version process that committed before this deploy and never ran confirm(); repairIfPending()'s "Legacy compatibility pass" atomically promotes a stale legacy reservation to modern Tier-1 evidence and clears it in the same CAS-guarded write. `default: undefined` means a new document never gets a placeholder for either field -- only a genuinely pre-existing legacy document has one.
    reservedReport: {
      type: new Schema(
        {
          _id: false,
          token: { type: String, default: null },
          reservedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: undefined,
    },

    reservedUserWide: {
      type: new Schema(
        {
          _id: false,
          token: { type: String, default: null },
          reservedAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: undefined,
    },

    reservedReports: {
      type: [
        {
          _id: false,
          token: { type: String, required: true },
          reservedAt: { type: Date, required: true },
        },
      ],
      default: [],
    },

    // Post-write corrective-reservation gap closure: the old edit/delete flow reserved the pre-read (possibly stale) month, then reserved the TRUE month again AFTER the write -- leaving a crash window between commit and that second reservation durably storing, with no valid evidence for the true month. reservedUserWideReservations is the ONLY reservation edit/delete now take, taken ONCE before the write, naming no specific month (the true effect isn't knowable yet); Tier-2 recovery therefore reconstructs EVERY BudgetModel month from authoritative expense data. confirm() atomically converts this into targeted Tier-1 work and releases only its own token -- no separate post-write round trip remains. Array-of-owned-tokens for the same reason as reservedReports; not a rename of the legacy single-object reservedUserWide field, which stays separately declared, read-and-clear only.
    reservedUserWideReservations: {
      type: [
        {
          _id: false,
          token: { type: String, required: true },
          reservedAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("PendingSync", pendingSyncSchema);
