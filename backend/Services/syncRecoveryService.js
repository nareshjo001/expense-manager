// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
// Phase C.1 -- Mutation Recovery Correctness Gate (crash-gap closure +
// concurrency-safe derived-data writes). See the doc comments on reserve(),
// confirm(), and repairIfPending() below for what changed and why; the
// original Phase C rationale for the overall architecture (durable marker +
// read-time repair, not a queue/worker/transaction) is unchanged and kept
// below.
//
// Confirmed problem (Phase C audit): an expense add/edit/delete can commit
// permanently to MongoDB, then a LATER budget recalculation or report
// refresh can fail, and the controller used to return a blanket 500 --
// telling the client the whole mutation failed even though the expense
// write already succeeded.
//
// Confirmed problem (Phase C.1 audit): the Phase C marker
// (pendingBudgetMonths/reportPending) was ONLY ever written AFTER a sync
// step had already been attempted and failed -- never before, and never
// unconditionally right after the primary write. A process crash or client
// disconnect between the primary write committing and that marker write
// left NO durable evidence at all: repairIfPending() had nothing to find,
// so a committed expense could permanently never be reflected in
// Budget.spent or the FinancialReport. Naively moving a plain marker BEFORE
// the primary write would have reintroduced a different bug: a concurrent
// repair could read that marker and clear it before the owning mutation's
// own write had even happened. See reserve()/confirm() below for how both
// problems are closed together.
//
// Selected architecture: a durable, per-user "pending synchronization"
// marker (models/PendingSync.js) plus read-time repair, NOT a queue, NOT a
// background worker, and NOT a MongoDB transaction:
//   - budget.service.js's recalculateBudget(userId, date) and
//     reportService.js's refreshReport(userId) are BOTH already pure,
//     idempotent, full recomputations from the authoritative `expenses`
//     collection every time they run -- neither applies a delta. Recovery
//     therefore never needs to persist WHAT changed, only THAT a given
//     user's budget month(s)/report may not reflect the latest committed
//     expense state. That is a much smaller durable-state problem than a
//     general outbox/job queue would solve, and this codebase has no
//     queue/worker infrastructure to build one on (verified in the audit).
//   - A background worker was considered and rejected: there is no cron/
//     queue platform in this repository today (only date-scheduled cron
//     jobs for unrelated features), and introducing one would be a large,
//     disproportionate addition for what read-time repair already solves.
//   - A MongoDB transaction was considered and rejected: this repository
//     never establishes a real MongoDB connection in its test suite
//     (backend/tests/setup/testEnv.js) and config/db.js does not verify or
//     require a replica-set topology, so multi-document transaction
//     support is UNVERIFIED for the actual deployment. Recommending
//     transactions without that confirmation is exactly what the Phase C
//     brief prohibits. Transactions also could not make a Redis operation
//     atomic with a Mongo write regardless.
//
// Two-tier marker, as of Phase C.1 (refined in Phase C.2):
//   Tier 1 (pendingBudgetMonths / reportPending, on PendingSync itself) --
//   "confirmed, immediately repair-eligible" work. Governed by the
//   `revision` compare-and-set, unchanged in spirit from Phase C.
//   Tier 2 (reservedBudgetMonths / reservedReports / reservedUserWideReservations,
//   on PendingSync) -- pre-write "intent" evidence, written by reserve()
//   BEFORE the primary write. This is what closes the crash gap (evidence
//   exists before the write even happens) without reintroducing the
//   premature-clear race a plain pre-write marker would cause (see
//   reserve()'s doc comment for the exact interleaving this defeats). All
//   three Tier-2 fields are OWNED-TOKEN ARRAYS (system-wide reservation-
//   ownership correction) -- every reserve() call pushes its own entry, and
//   confirm()/abandon() only ever pull the specific token they own, so
//   multiple simultaneous reservations for the same user never clobber each
//   other's evidence. See models/PendingSync.js's reservedReports doc
//   comment for the exact hazard this closes.
//
//   Phase C.2 correction: a reservation older than RESERVATION_STALE_MS is
//   treated as "worth a defensive recompute" but is NEVER released/cleared
//   by age alone -- a fixed timeout can indicate a reservation is probably
//   abandoned, but it can never PROVE the owner will not still write later
//   (no real request has a hard upper bound on latency). Only the owner
//   itself retires a reservation: confirm() on success, or the new
//   abandon() on a definitive, known write failure. See repairIfPending()'s
//   Tier-2 pass and abandon()'s doc comment below for the full reasoning
//   and the exact interleaving this closes that the original age-based
//   release did not.
//
// Concurrency note (read before modifying this file): recalculateBudget and
// refreshReport both re-read CURRENT `expenses` data at THEIR OWN execution
// time, not a snapshot captured earlier. That means the LAST synchronization
// attempt to finish for a given user is always correct on its own terms --
// but "last to finish" is not the same as "last to start", so the ACTUAL
// PERSIST (not just the marker clear) must also be fenced. As of Phase C.1,
// both recalculateBudget and refreshReport accept an optional
// `fenceRevision` (see budget.service.js / reportService.js) that is
// re-checked against PendingSync.revision immediately before their write; a
// stale caller's write is skipped entirely rather than applied and later
// corrected. Combined with `revision` guarding the marker clear itself
// (clearIfRevisionMatches), an older/slower attempt can neither clobber
// fresher BudgetModel/FinancialReport/Redis data NOR falsely clear newer
// pending work out from under it.
"use strict";

const crypto = require("crypto");
const PendingSync = require("../models/PendingSync");
const { BudgetModel } = require("../config/Schemas");
const { recalculateBudget, getMonthAnchor, getMonthAnchorFromKey } = require("./BudgetServices/budget.service");
const { refreshReport } = require("./reportService");

const MAX_ERROR_LENGTH = 500;

// Phase C.1 -- reservations older than this are treated as PLAUSIBLY
// abandoned/crashed, worth a defensive recompute attempt (see
// repairIfPending()'s Tier-2 pass). Phase C.2 correction: this threshold
// gates ONLY the decision to attempt an extra, idempotent recompute -- it
// is explicitly NOT used as permission to release/clear the reservation
// (a fixed timeout cannot prove a still-alive, unusually slow owner will
// never write). repairIfPending() accepts an injectable `now` so tests can
// exercise the age-gate deterministically instead of with real sleeps.
const RESERVATION_STALE_MS = 15000;

function newToken() {
  return crypto.randomBytes(16).toString("hex");
}

// Phase C.4 requirement #4 -- allocates a fresh, unique fencing revision for
// exactly ONE repair attempt (a single Tier-1 pass, or a single Tier-2
// pass, within one repairIfPending() call).
//
// Confirmed problem: repairIfPending() previously fenced its own
// recompute+persist calls using a revision it only ever READ (`before.revision`
// for Tier-1, `current.revision` for Tier-2) -- never one it allocated
// itself. Two overlapping repair attempts for the SAME user (e.g. two
// concurrent GET /report or GET /budgets requests, both finding the same
// stale reservation/pending marker) with NO intervening confirm()/
// markPending() call in between (nothing else bumps the shared counter)
// therefore both compute their own recalculateBudget/refreshReport calls
// fenced to the IDENTICAL revision value. recalculateBudget/refreshReport's
// own CAS filter (`syncRevision <= fenceRevision`) allows an EQUAL
// fenceRevision to overwrite a document already stamped with that same
// value -- so whichever of the two attempts physically persists SECOND
// always wins, regardless of which one actually computed from FRESHER
// expense data. Concretely: attempt A's aggregate reads expense data at
// time T1, then (some real, uncontrolled delay -- GC pause, event-loop
// scheduling, network) doesn't persist until later; attempt B starts
// afterward, reads expense data at time T2 > T1 (now including a
// concurrently-committed expense A's snapshot never saw), and persists
// FIRST; A then resumes and persists SECOND, silently overwriting B's
// more current result with A's stale one -- the CAS never rejects it,
// because both used the same fenceRevision.
//
// Fix: every repair attempt that is about to perform a recompute+persist
// first calls this function to atomically claim its OWN, strictly
// increasing revision (a plain `$inc`, identical in spirit to confirm()'s
// own revision bump for a real mutation) and fences every write it makes
// with THAT value -- never a value merely observed by an earlier read.
// Two concurrent attempts can therefore never share a fenceRevision: the
// attempt that claims the HIGHER ticket can always overwrite one that
// claimed a lower ticket (whichever writes second among equally-numbered
// attempts is impossible -- the ticket itself is unique), and an attempt
// holding a LOWER ticket can never overwrite a document already stamped
// with a HIGHER one, regardless of which attempt actually finishes
// computing/persisting first. This is the same "last WRITER wins by
// revision, not by wall-clock arrival order" guarantee every other fenced
// writer in this codebase already relies on -- repair attempts simply did
// not previously participate in it correctly.
async function allocateRepairRevision(userId) {
  const record = await PendingSync.findOneAndUpdate(
    { user: userId },
    { $inc: { revision: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return record.revision;
}

// Never persists a raw stack trace or any financial document content --
// only a short, sanitized message, matching PendingSync's own maxlength.
function sanitizeError(err) {
  if (!err) return null;
  const message = typeof err.message === "string" && err.message ? err.message : String(err);
  return message.length > MAX_ERROR_LENGTH ? message.slice(0, MAX_ERROR_LENGTH) : message;
}

// Deduplicates a list of dates down to their distinct month anchors
// (first instant of each month), so the same month is never recorded twice
// regardless of which day-of-month the triggering expense(s) fell on.
function dedupeMonthAnchors(dates) {
  const seen = new Map();
  for (const date of dates || []) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
    const anchor = getMonthAnchor(date);
    seen.set(anchor.getTime(), anchor);
  }
  return [...seen.values()];
}

// Records NEW pending derived-data work for a user, independent of the
// confirm()/reserve() flow below. Kept for callers that need to record
// pending work without going through a full reserve/confirm cycle (e.g.
// repair-failure bookkeeping paths, and existing direct tests). Purely
// additive: an atomic $addToSet for budget months (never drops a month a
// still-earlier, still-unrepaired failure already recorded), a $set only
// when reportPending is actually true this call, and an atomic $inc on
// revision so concurrent callers never lose each other's updates.
async function markPending({ userId, budgetDates = [], reportPending = false, error } = {}) {
  const monthAnchors = dedupeMonthAnchors(budgetDates);

  if (monthAnchors.length === 0 && !reportPending) {
    // Nothing to record -- defensive no-op, never creates an empty marker.
    return null;
  }

  const update = {
    $inc: { revision: 1 },
    $set: {
      lastError: sanitizeError(error),
      lastAttemptAt: new Date(),
    },
  };

  if (monthAnchors.length > 0) {
    update.$addToSet = { pendingBudgetMonths: { $each: monthAnchors } };
  }

  if (reportPending) {
    update.$set.reportPending = true;
  }

  return PendingSync.findOneAndUpdate({ user: userId }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
}

// Phase C.1 -- pre-write durable intent marker. MUST be called and awaited
// BEFORE the primary expense write, using dates/flags already known from
// the incoming request (never derived from the write's own result, since
// the write has not happened yet). This is what survives a process crash
// between the primary write committing and the post-write confirm() call
// below: repairIfPending() will eventually find it (once it is older than
// RESERVATION_STALE_MS) even if confirm() never runs at all.
//
// Deliberately NOT immediately repair-eligible (unlike
// pendingBudgetMonths/reportPending) and NOT gated by the shared `revision`
// counter -- each reservation gets its own random token so a fresh
// reservation for the same month/report can never be confused with, or
// prematurely cleared by, a stale one. This is what defeats the exact race
// this phase's brief warns against:
//   1. Mutation B marks future work pending (pre-write).
//   2. Mutation A repairs and clears the shared marker.
//   3. Mutation B performs its expense write afterward.
//   4. No pending marker remains for B.
// A plain shared boolean/date marker is vulnerable to exactly this -- A has
// no way to know B's write has not happened yet. A token-based reservation
// that repair only ever acts on once it is provably stale (older than
// RESERVATION_STALE_MS, i.e. B's request has almost certainly already
// either completed its own confirm() or crashed) cannot be raced this way:
// at the moment A would need to act on it for the race to matter, B's
// request is still fresh, so A leaves it alone.
async function reserve({ userId, budgetDates = [], reserveReport = false, reserveUserWide = false } = {}) {
  const monthAnchors = dedupeMonthAnchors(budgetDates);

  if (monthAnchors.length === 0 && !reserveReport && !reserveUserWide) {
    return { budgetReservations: [], reportReservation: null, userWideReservation: null };
  }

  const now = new Date();
  const budgetReservations = monthAnchors.map((month) => ({
    month,
    token: newToken(),
    reservedAt: now,
  }));
  const reportReservation = reserveReport ? { token: newToken(), reservedAt: now } : null;
  // Phase C.3 -- the broad, month-agnostic reservation edit/delete take
  // BEFORE their primary write instead of a per-month guess. See
  // models/PendingSync.js's reservedUserWideReservations doc comment for
  // why this closes the post-write corrective-reservation gap: it is valid
  // regardless of which month the document occupies once the write
  // actually happens, so no SECOND reservation call is ever needed after
  // the write to cover the true result.
  const userWideReservation = reserveUserWide ? { token: newToken(), reservedAt: now } : null;

  // System-wide reservation-ownership correction -- every reservation,
  // including report/user-wide, is now PUSHED as its own array entry
  // (never $set, which would silently overwrite an earlier, still-
  // unconfirmed reservation's entry). Multiple concurrent/sequential
  // reservations for the same user therefore always coexist, exactly like
  // reservedBudgetMonths already did before this fix -- see
  // models/PendingSync.js's reservedReports doc comment for the exact
  // loss sequence this closes and tests/syncRecoveryService.
  // reservationOwnership.test.js for the reproduction-then-fix proof.
  const push = {};
  if (budgetReservations.length > 0) {
    push.reservedBudgetMonths = { $each: budgetReservations };
  }
  if (reportReservation) {
    push.reservedReports = reportReservation;
  }
  if (userWideReservation) {
    push.reservedUserWideReservations = userWideReservation;
  }

  await PendingSync.findOneAndUpdate(
    { user: userId },
    { $push: push },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return { budgetReservations, reportReservation, userWideReservation };
}

// Phase C.1 -- post-write confirm. Called immediately after the primary
// write commits, BEFORE attempting any recompute -- unconditionally, not
// only recorded on failure as Phase C originally did. This is the second
// half of the crash-gap closure: even if the process crashes immediately
// after this call returns (before the recompute below even starts), a
// durable, immediately repair-eligible Tier-1 marker already exists for
// this exact work, with no dependency on the reservation's age-gate for
// this ordinary (non-crash, non-pathological) case.
//
// A single atomic update: $inc revision (the fencing/CAS token this
// mutation's own recompute+persist and eventual clearIfRevisionMatches
// call will use), $addToSet/$set on the existing Tier-1 fields, and
// $pull/$set releasing the SPECIFIC reservation token(s) this call is
// confirming -- a different array/field path than the Tier-1 fields, so
// both apply in one atomic update with no Mongo operator conflict. Tier-1
// marking happens regardless of whether a matching reservation/token is
// passed in, so even a caller that never reserved (e.g. an idempotent
// replay of an already-committed expense) still gets correct, durable
// pending tracking for its own sync attempt. Returns the new revision.
async function confirm({
  userId,
  budgetDates = [],
  confirmReport = false,
  budgetTokens = [],
  reportToken = null,
  userWideToken = null,
} = {}) {
  const monthAnchors = dedupeMonthAnchors(budgetDates);

  const update = {
    $inc: { revision: 1 },
    $set: { lastAttemptAt: new Date() },
  };

  if (monthAnchors.length > 0) {
    update.$addToSet = { pendingBudgetMonths: { $each: monthAnchors } };
  }
  if (confirmReport) {
    update.$set.reportPending = true;
  }

  // System-wide reservation-ownership correction -- $pull releases ONLY
  // the specific token(s) THIS call owns, from the owned-token arrays
  // (reservedReports/reservedUserWideReservations), never a blind $set to
  // null. A DIFFERENT, still-in-flight reservation for the same user (a
  // different token, its own array entry) is therefore never touched by
  // this call -- see models/PendingSync.js's reservedReports doc comment.
  const pull = {};
  if (budgetTokens.length > 0) {
    pull.reservedBudgetMonths = { token: { $in: budgetTokens } };
  }
  if (reportToken) {
    pull.reservedReports = { token: reportToken };
  }
  // Phase C.3 -- this is the SAME atomic call that already records the
  // now-known TRUE affected month(s) as Tier-1 pending work: releasing
  // THIS call's own reservedUserWideReservations entry here means there is
  // never a window where the true months are covered by neither the
  // (now-released) reservation NOR a Tier-1 marker -- one atomic write
  // does both.
  if (userWideToken) {
    pull.reservedUserWideReservations = { token: userWideToken };
  }
  if (Object.keys(pull).length > 0) {
    update.$pull = pull;
  }

  const record = await PendingSync.findOneAndUpdate({ user: userId }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });

  return record.revision;
}

// Phase C.2 -- explicit reservation release for a mutation whose OWN
// primary write is KNOWN to have definitively failed (the controller's own
// error handling determined this exact request's write did not commit and
// will not be retried by it). This is the ONLY other legitimate way
// (besides confirm()) to retire a Tier-2 reservation -- never based on
// elapsed time (see repairIfPending()'s Tier-2 pass), only ever called by
// the exact request that owns the token(s), at the exact moment it knows
// no write is coming from this attempt. A client-initiated retry (e.g.
// after a transient network error) calls reserve() again independently and
// receives its OWN fresh token(s) -- reservations are per-attempt, never
// per-month singletons, so releasing THIS attempt's token can never disturb
// a different attempt's evidence. Best-effort: if this update itself fails,
// the reservation simply survives and is harmlessly, idempotently
// recomputed once it ages past RESERVATION_STALE_MS, same as any other
// abandoned reservation -- never a correctness problem, at worst a wasted
// recompute.
async function abandon({ userId, budgetTokens = [], reportToken = null, userWideToken = null } = {}) {
  if (budgetTokens.length === 0 && !reportToken && !userWideToken) return null;

  // System-wide reservation-ownership correction -- abandon() may release
  // ONLY evidence owned by the exact token(s) passed in, via $pull against
  // the owned-token arrays. It can never clear a DIFFERENT, still-valid
  // reservation for the same user/field -- there is no longer a single
  // overwritable slot to blindly null out. See models/PendingSync.js's
  // reservedReports doc comment for the exact hazard this closes.
  const pull = {};
  if (budgetTokens.length > 0) {
    pull.reservedBudgetMonths = { token: { $in: budgetTokens } };
  }
  if (reportToken) {
    pull.reservedReports = { token: reportToken };
  }
  if (userWideToken) {
    pull.reservedUserWideReservations = { token: userWideToken };
  }

  try {
    return await PendingSync.findOneAndUpdate({ user: userId }, { $pull: pull }, { new: true });
  } catch (err) {
    console.error("syncRecoveryService.abandon failed:", sanitizeError(err));
    return null;
  }
}

// Read-only lookup of the current marker, or null if the user has none
// (the common case -- no pending work at all).
async function getPendingSync(userId) {
  return PendingSync.findOne({ user: userId }).lean();
}

// Compare-and-set clear: only removes the SPECIFIC budget months just
// repaired (via $pull, safe regardless of revision -- pulling a value that
// is no longer relevant, or was already removed, is a harmless no-op) and
// only clears reportPending IF the marker's revision is still exactly the
// one the caller captured before starting repair/sync. If a newer mutation
// bumped the revision in the meantime, this update matches zero documents
// and is a no-op -- the newer pending work is left exactly as that mutation
// recorded it. NOTE: this guards the MARKER only; the derived-data write
// itself (BudgetModel.spent / FinancialReport) is separately guarded by
// `fenceRevision` on recalculateBudget/refreshReport (see the module doc
// comment above) -- a caller whose write was skipped as superseded must not
// pass that month/report into repairedBudgetMonths/reportCleared here.
async function clearIfRevisionMatches({ userId, revision, repairedBudgetMonths = [], reportCleared = false } = {}) {
  const monthAnchors = dedupeMonthAnchors(repairedBudgetMonths);

  const update = {};
  if (monthAnchors.length > 0) {
    update.$pull = { pendingBudgetMonths: { $in: monthAnchors } };
  }
  if (reportCleared) {
    update.$set = { reportPending: false };
  }

  if (!update.$pull && !update.$set) return { matched: false };

  const result = await PendingSync.findOneAndUpdate(
    { user: userId, revision },
    update,
    { new: true }
  );

  return { matched: Boolean(result), record: result };
}

// The shared read-time repair, used identically by reportService.getReport()
// callers and Controllers/BudgetControllers/getbudgets.js -- "repair on the
// next relevant budget/report read if pending" from the selected
// architecture.
//
// Three passes:
//   0. Legacy compatibility (rolling-deployment recovery) -- new in the
//      final correctness pass. Promotes any STALE legacy single-object
//      `reservedReport`/`reservedUserWide` reservation (see
//      models/PendingSync.js's doc comment on those two fields) into
//      modern Tier-1 evidence before pass 1 below runs, so this SAME call
//      can immediately reconcile it via the existing Tier-1 machinery.
//   1. Tier-1 (pendingBudgetMonths/reportPending) -- unchanged in spirit
//      from Phase C, EXCEPT the recompute+persist calls now also pass
//      `fenceRevision` so an old/slow repair cannot clobber fresher data
//      that landed mid-repair (previously only the marker CLEAR was
//      fenced, not the write itself).
//   2. Tier-2 (reservedBudgetMonths/reservedReports/reservedUserWideReservations) -- new in Phase C.1.
//      Only reservations older than RESERVATION_STALE_MS are touched (see
//      reserve()'s doc comment for why), and only the EXACT token found is
//      released -- never a blanket per-month/report clear -- so a
//      brand-new reservation from a genuinely in-flight request is never
//      disturbed by this pass.
// A month/report is only cleared/released if its own repair step actually
// succeeded (not skipped-as-superseded); a failed or superseded step leaves
// that exact piece of pending state in place so a later read tries again.
// Never throws -- a read that triggers a failed repair still returns
// whatever data is available; the caller decides how to present that.
//
// `options.now` (Date or epoch ms) overrides the current time for the
// Tier-2 staleness check -- used by tests to exercise the age-gate
// deterministically instead of with real sleeps. Defaults to Date.now().
async function repairIfPending(userId, options = {}) {
  try {
    const nowMs =
      options.now instanceof Date
        ? options.now.getTime()
        : typeof options.now === "number"
        ? options.now
        : Date.now();
    const staleThreshold = nowMs - RESERVATION_STALE_MS;

    // -- Pass 0: legacy backward-compatibility (rolling-deployment
    // recovery) ----------------------------------------------------------
    //
    // Confirmed gap: an OLD-version process may have written a legacy
    // single-object `reservedReport`/`reservedUserWide` reservation, had
    // its primary mutation COMMIT, then crashed before confirm() ever ran
    // -- leaving ONLY that legacy Tier-2 evidence behind. The array-based
    // reserve()/confirm()/abandon() above never read or write these two
    // legacy field names (by design -- see the system-wide reservation-
    // ownership correction elsewhere in this file), so without this pass,
    // that surviving evidence would be permanently invisible to repair,
    // silently losing the recovery signal for a mutation that IS durably
    // committed. This is a materially different (and worse) failure mode
    // than an ordinary stale Tier-2 entry: an ordinary one is still found
    // and defensively recomputed forever by pass 2 below; a legacy one,
    // left unhandled, is found NEVER.
    //
    // Design: runtime dual-read compatibility (no migration script). Each
    // STALE legacy reservation (same RESERVATION_STALE_MS age-gate as
    // every other Tier-2 entry -- a fresh one might still belong to a
    // genuinely in-flight OLD-version request and must not be touched) is
    // atomically PROMOTED into the exact modern Tier-1 evidence it
    // represents, in the SAME MongoDB write that clears the legacy field.
    // A single atomic findOneAndUpdate can only either fully apply or not
    // apply at all, so there is no window where the evidence exists in
    // neither representation, and no window where the legacy field is
    // cleared without having been promoted first. Once promoted, pass 1
    // immediately below (which re-reads a FRESH `before`) picks up the
    // newly-set reportPending/pendingBudgetMonths and reconciles it using
    // the exact same fenced, retry-safe, already-proven Tier-1 machinery
    // every other marker uses -- no bespoke recompute path is added for
    // legacy data, and a failure in that reconciliation leaves the
    // now-modern Tier-1 evidence durable/retryable exactly like any other
    // Tier-1 failure (see pass 1's own failure handling below).
    //
    // Idempotency: each promotion's filter is CAS'd on the legacy field's
    // OWN token (`"reservedReport.token": token`). The SAME write that
    // matches also clears the field, so that exact filter can never match
    // again -- a concurrent or later repeated repairIfPending() call for
    // the same stale legacy reservation finds zero matching documents and
    // is a correct, safe no-op (identical CAS discipline to
    // clearIfRevisionMatches()/confirm()/abandon() elsewhere in this file,
    // applied to a per-field token instead of the shared revision
    // counter). recalculateBudget's own $addToSet for the userWide
    // promotion's month enumeration is separately idempotent regardless.
    //
    // Non-stale legacy reservations are deliberately left completely
    // untouched (same age-gate rationale as every other Tier-2 entry) --
    // they remain visible in THIS call's own `stillPending` result (see
    // the end of this function) until they age past the threshold, at
    // which point this same pass promotes them on a later call.
    let legacyReportPromoted = false;
    let legacyUserWidePromoted = false;

    try {
      const legacySnapshot = await getPendingSync(userId);
      const legacyReport = legacySnapshot && legacySnapshot.reservedReport;
      if (
        legacyReport &&
        legacyReport.token &&
        new Date(legacyReport.reservedAt).getTime() < staleThreshold
      ) {
        const promoted = await PendingSync.findOneAndUpdate(
          { user: userId, "reservedReport.token": legacyReport.token },
          {
            $set: { reportPending: true, lastAttemptAt: new Date() },
            $inc: { revision: 1 },
            $unset: { reservedReport: "" },
          },
          { new: true }
        );
        legacyReportPromoted = Boolean(promoted);
      }
    } catch (err) {
      // Promotion itself failed (e.g. a transient Mongo error) -- the
      // legacy reservation survives completely untouched (an atomic
      // findOneAndUpdate either fully applies or not at all) and remains
      // durable, stale evidence for the NEXT repairIfPending() call to
      // retry -- never lost, never partially applied.
      try {
        await PendingSync.updateOne(
          { user: userId },
          { $set: { lastError: sanitizeError(err), lastAttemptAt: new Date() } }
        );
      } catch (_e) {
        // Intentionally swallowed -- see outer catch's rationale.
      }
    }

    try {
      const legacySnapshot = await getPendingSync(userId);
      const legacyUserWide = legacySnapshot && legacySnapshot.reservedUserWide;
      if (
        legacyUserWide &&
        legacyUserWide.token &&
        new Date(legacyUserWide.reservedAt).getTime() < staleThreshold
      ) {
        // Same broad-recovery principle as the modern
        // reservedUserWideReservations Tier-2 pass below: the legacy
        // reservation does not know which month(s) its owning mutation
        // actually affected, so promotion enumerates EVERY existing
        // BudgetModel month for this user into pendingBudgetMonths. This
        // enumeration read is safe to repeat/race -- $addToSet is itself
        // idempotent, and the promotion write as a whole is still guarded
        // by the legacy token CAS below.
        const existingBudgetMonths = await BudgetModel.find({ userId }).select("month").lean();
        const monthAnchors = [];
        for (const doc of existingBudgetMonths) {
          const anchor = getMonthAnchorFromKey(doc.month);
          if (anchor) monthAnchors.push(anchor); // defensively skip any unparsable legacy month key
        }

        const update = {
          $set: { lastAttemptAt: new Date() },
          $inc: { revision: 1 },
          $unset: { reservedUserWide: "" },
        };
        if (monthAnchors.length > 0) {
          update.$addToSet = { pendingBudgetMonths: { $each: monthAnchors } };
        }

        const promoted = await PendingSync.findOneAndUpdate(
          { user: userId, "reservedUserWide.token": legacyUserWide.token },
          update,
          { new: true }
        );
        legacyUserWidePromoted = Boolean(promoted);
      }
    } catch (err) {
      try {
        await PendingSync.updateOne(
          { user: userId },
          { $set: { lastError: sanitizeError(err), lastAttemptAt: new Date() } }
        );
      } catch (_e) {
        // Intentionally swallowed -- see outer catch's rationale.
      }
    }

    const before = await getPendingSync(userId);
    const hasTier1 = Boolean(before && (before.pendingBudgetMonths.length > 0 || before.reportPending));

    let revisionMatchedOnClear = false;
    let budgetRepairFailed = false;
    let reportRepairFailed = false;

    if (hasTier1) {
      // Phase C.4 requirement #4 -- a FRESH, uniquely-allocated ticket for
      // THIS repair attempt, never the statically-read `before.revision`.
      // See allocateRepairRevision()'s own doc comment for the exact
      // corruption this closes: two concurrent Tier-1 repairs observing
      // the identical `before.revision` (nothing else bumped the counter
      // between them) could otherwise persist a stale, older-snapshot
      // result AFTER a concurrent, fresher-snapshot repair already won,
      // silently overwriting it, because the CAS filter is a `<=`
      // comparison and both attempts would have fenced their writes to the
      // SAME value. Allocating a new value here means this attempt's own
      // writes (and its own clearIfRevisionMatches CAS below, which now
      // checks against this SAME fresh ticket) can never collide with a
      // concurrent repair's ticket -- exactly one of the two is ever
      // higher, and the CAS only ever lets the higher one's write survive.
      const revision = await allocateRepairRevision(userId);
      const repairedMonths = [];
      let budgetError = null;
      let reportCleared = false;
      let reportError = null;

      for (const anchor of before.pendingBudgetMonths) {
        try {
          const result = await recalculateBudget(userId, anchor, { fenceRevision: revision });
          if (result && result.skipped) {
            // Superseded by newer recorded work since `revision` was
            // captured above -- do not treat as repaired. The newer
            // work's own attempt (or a later repair with a fresh
            // revision) is responsible for actually persisting it.
            budgetError = budgetError || new Error("Superseded by newer pending work");
          } else {
            repairedMonths.push(anchor);
          }
        } catch (err) {
          budgetError = err;
        }
      }

      if (before.reportPending) {
        try {
          const result = await refreshReport(userId, { fenceRevision: revision });
          if (result && result.skipped) {
            reportError = reportError || new Error("Superseded by newer pending work");
          } else {
            reportCleared = true;
          }
        } catch (err) {
          reportError = err;
        }
      }

      const clearResult = await clearIfRevisionMatches({
        userId,
        revision,
        repairedBudgetMonths: repairedMonths,
        reportCleared,
      });
      revisionMatchedOnClear = clearResult.matched;
      budgetRepairFailed = Boolean(budgetError);
      reportRepairFailed = Boolean(reportError);

      const failure = budgetError || reportError;
      if (failure) {
        try {
          await PendingSync.updateOne(
            { user: userId },
            { $set: { lastError: sanitizeError(failure), lastAttemptAt: new Date() } }
          );
        } catch (_bookkeepingErr) {
          // Intentionally swallowed -- see outer catch's rationale.
        }
      }
    }

    // Tier 2: age-gated DEFENSIVE recompute -- NEVER releases a
    // reservation. See point 1 of the Phase C.2 correctness gate: a fixed
    // timeout can prove "this reservation's owner has almost certainly
    // already finished one way or another" in the ORDINARY case, but it
    // can never prove a genuinely still-alive, unusually slow owner will
    // not still write later -- there is no upper bound on real-world
    // request latency. Releasing/clearing the reservation once it merely
    // LOOKS stale would destroy the only durable evidence for a write that
    // has not happened yet, reopening the exact crash gap Tier 2 exists to
    // close (proven by the required 7-step interleaving test in
    // mutationRecoveryCorrectness.test.js).
    //
    // So this pass, once a reservation is stale, ONLY performs an
    // idempotent, harmless-to-repeat recompute using CURRENT live data
    // (correct whether the true owner is dead or still en route, and
    // fenced by the SAME atomic CAS as every other write in this file --
    // see budget.service.js/reportService.js -- so it can never clobber a
    // fresher result). It never pulls/clears the reservation itself. A
    // reservation is retired ONLY by:
    //   - confirm() -- the owning mutation's own write actually landing
    //     and explicitly releasing its own token(s); or
    //   - abandon() (below) -- the owning controller explicitly releasing
    //     its own token(s) after determining its OWN primary write
    //     definitively failed and will not be retried by this request.
    // A reservation whose true owner crashed and never retries, and which
    // is therefore never confirmed or abandoned, remains indefinitely --
    // and repair correctly treats it as stale-and-worth-recomputing on
    // EVERY subsequent read for that user, FOREVER, until something
    // eventually confirms or abandons it. This is UNBOUNDED repeated
    // repair work, not a "bounded" cost -- it does not decay, does not
    // cap out, and does not stop on its own. It is the deliberate,
    // explicitly accepted trade this phase's own brief calls for ("keep
    // durable recoverability until the owner explicitly confirms or
    // aborts"): correctness (never silently losing recovery evidence)
    // takes priority over bounding this cost via an automatic but unsafe
    // cleanup (see abandon()'s own doc comment for why age alone is never
    // sufficient grounds to release a reservation). If this operational
    // cost becomes a real concern in practice, the correct fix is
    // operator-visible alerting/monitoring on old reservations (out of
    // scope here), never a time-based auto-release.
    //
    // `staleThreshold` was already computed at the top of this function
    // (pass 0 needs it too) -- reused here unchanged.
    const current = await getPendingSync(userId);

    const staleBudgetReservations = ((current && current.reservedBudgetMonths) || []).filter(
      (r) => new Date(r.reservedAt).getTime() < staleThreshold
    );
    // System-wide reservation-ownership correction -- reservedReports/
    // reservedUserWideReservations are now arrays, so MULTIPLE independent
    // reservations for the same user can be simultaneously stale (e.g. an
    // abandoned R1 alongside a genuinely still-in-flight, not-yet-stale
    // R2). staleness is evaluated per-entry; the report/budget itself only
    // needs ONE recompute regardless of how many stale entries exist
    // (refreshReport/recalculateBudget always recompute from CURRENT live
    // data, never a delta tied to a specific reservation), so the presence
    // of ANY stale entry triggers exactly one recompute below -- never one
    // recompute per stale entry.
    const staleReportReservations = ((current && current.reservedReports) || []).filter(
      (r) => new Date(r.reservedAt).getTime() < staleThreshold
    );
    const reportReservationStale = staleReportReservations.length > 0;
    const staleUserWideReservations = ((current && current.reservedUserWideReservations) || []).filter(
      (r) => new Date(r.reservedAt).getTime() < staleThreshold
    );
    const userWideReservationStale = staleUserWideReservations.length > 0;

    // Phase C.4 requirement #4 -- exactly the same fix as the Tier-1 pass
    // above, applied to Tier-2: a FRESH ticket for THIS repair attempt's
    // entire Tier-2 portion (shared across its three sub-passes below,
    // since they run strictly sequentially within this one call -- the
    // corruption this closes is between DIFFERENT repairIfPending() calls
    // racing each other, not between sub-passes of the same call), never
    // the statically-read `current.revision`. Only allocated when there is
    // actually stale Tier-2 work to fence, so a read that finds nothing
    // stale never churns the counter. See allocateRepairRevision()'s doc
    // comment for the exact corruption this prevents: without a per-attempt
    // ticket, two concurrent repairs of the SAME stale reservation (most
    // notably reservedUserWideReservations, whose own required proof test exercises
    // this exact interleaving) could otherwise both fence their writes to
    // the SAME revision, letting whichever one persists SECOND silently
    // overwrite a fresher result with a staler one.
    const hasTier2Work = staleBudgetReservations.length > 0 || reportReservationStale || userWideReservationStale;
    const tier2Revision = hasTier2Work
      ? await allocateRepairRevision(userId)
      : current
      ? current.revision
      : undefined;

    for (const r of staleBudgetReservations) {
      try {
        await recalculateBudget(userId, r.month, { fenceRevision: tier2Revision });
        // Deliberately no $pull here -- see comment above.
      } catch (err) {
        budgetRepairFailed = true;
        try {
          await PendingSync.updateOne(
            { user: userId },
            { $set: { lastError: sanitizeError(err), lastAttemptAt: new Date() } }
          );
        } catch (_e) {
          // Intentionally swallowed.
        }
      }
    }

    if (reportReservationStale) {
      try {
        await refreshReport(userId, { fenceRevision: tier2Revision });
        // Deliberately no reservedReports clear here -- see comment above.
        // A stale entry survives this pass regardless of outcome; only the
        // owning mutation's own confirm() or abandon() ever removes ITS
        // OWN entry.
      } catch (err) {
        reportRepairFailed = true;
        try {
          await PendingSync.updateOne(
            { user: userId },
            { $set: { lastError: sanitizeError(err), lastAttemptAt: new Date() } }
          );
        } catch (_e) {
          // Intentionally swallowed.
        }
      }
    }

    // Phase C.3 -- reservedUserWideReservations' own defensive recompute.
    // Unlike reservedBudgetMonths (which names specific months), this
    // reservation deliberately does not know which month(s) the owning
    // edit/delete actually affected -- it was taken BEFORE the write,
    // precisely so it remains valid no matter which month the write lands
    // in. Once ANY entry is stale, the only sound recovery is to
    // reconstruct EVERY month this user currently has a BudgetModel
    // document for, straight from authoritative expense data -- including
    // a month whose expense total is now zero (recalculateBudget's own
    // aggregate naturally returns 0 when nothing matches, so a month the
    // edit/delete emptied out is still correctly repaired here, not
    // skipped). A month the user never set a budget for has no
    // BudgetModel document and nothing user-facing to repair --
    // recalculateBudget's fenced call already returns `null` for that
    // case unchanged, exactly as it does for any other month without a
    // document. Same non-destructive principle as every other Tier-2
    // pass: NEVER releases any reservedUserWideReservations entry itself
    // -- only the owning mutation's own confirm() or abandon() ever
    // removes ITS OWN entry.
    if (userWideReservationStale) {
      try {
        const existingBudgetMonths = await BudgetModel.find({ userId }).select("month").lean();
        for (const doc of existingBudgetMonths) {
          const monthAnchor = getMonthAnchorFromKey(doc.month);
          if (!monthAnchor) continue; // defensively skip any unparsable legacy month key
          try {
            await recalculateBudget(userId, monthAnchor, { fenceRevision: tier2Revision });
            // Deliberately no reservedUserWideReservations clear here --
            // see comment above.
          } catch (err) {
            budgetRepairFailed = true;
            try {
              await PendingSync.updateOne(
                { user: userId },
                { $set: { lastError: sanitizeError(err), lastAttemptAt: new Date() } }
              );
            } catch (_e) {
              // Intentionally swallowed.
            }
          }
        }
      } catch (err) {
        // The enumeration query itself failed (e.g. a transient Mongo
        // error) -- treat as a budget repair failure for this pass; the
        // reservation survives untouched and the next stale read retries
        // the enumeration from scratch.
        budgetRepairFailed = true;
        try {
          await PendingSync.updateOne(
            { user: userId },
            { $set: { lastError: sanitizeError(err), lastAttemptAt: new Date() } }
          );
        } catch (_e) {
          // Intentionally swallowed.
        }
      }
    }

    const after = await getPendingSync(userId);
    // Requirement (final correctness pass, legacy compatibility) -- a
    // NON-stale legacy reservation is never touched by pass 0 above, so it
    // must still be represented here: `stillPending` reflects it exactly
    // like any other untouched-but-present piece of pending state, so a
    // caller never mistakes "nothing to do" for "there is legacy evidence
    // still waiting to age past the threshold".
    const stillPending = Boolean(
      after &&
        (after.pendingBudgetMonths.length > 0 ||
          after.reportPending ||
          (after.reservedBudgetMonths && after.reservedBudgetMonths.length > 0) ||
          (after.reservedReports && after.reservedReports.length > 0) ||
          (after.reservedUserWideReservations && after.reservedUserWideReservations.length > 0) ||
          Boolean(after.reservedReport && after.reservedReport.token) ||
          Boolean(after.reservedUserWide && after.reservedUserWide.token))
    );

    return {
      // legacyReportPromoted/legacyUserWidePromoted deliberately NOT
      // included in the returned object -- neither
      // Controllers/BudgetControllers/getbudgets.js (discards the return
      // value entirely) nor Controllers/report.controller.js (reads only
      // repairLookupFailed/reportRepairFailed/stillPending) needs them, so
      // this previously-stable public contract is kept unchanged. The two
      // local flags above still feed `attempted` below (a promotion IS
      // work this call attempted) and legacy-promotion itself is fully
      // provable from persisted document state (reservedReport/
      // reservedUserWide cleared, reportPending/pendingBudgetMonths set)
      // and from the Tier-1 pass's own recompute/clear side effects that
      // immediately follow a promotion in the same call -- see
      // tests/syncRecoveryService.legacyCompatibility.test.js.
      attempted:
        hasTier1 ||
        staleBudgetReservations.length > 0 ||
        reportReservationStale ||
        userWideReservationStale ||
        legacyReportPromoted ||
        legacyUserWidePromoted,
      revisionMatchedOnClear,
      budgetRepairFailed,
      reportRepairFailed,
      stillPending,
    };
  } catch (err) {
    console.error("syncRecoveryService.repairIfPending failed:", sanitizeError(err));
    return { attempted: false, stillPending: true, repairLookupFailed: true };
  }
}

// Runs the SAME immediate, best-effort synchronization every mutation
// controller already attempts (recalculateBudget for each affected month,
// then refreshReport). As of Phase C.1, the controller must call reserve()
// BEFORE its own primary write and pass the resulting tokens here; this
// function's FIRST action is confirm() (unconditional, not only on
// failure), so durable Tier-1 evidence exists before any recompute is even
// attempted. `revision` returned by confirm() then fences every
// recompute+persist attempt in this same call, and is the CAS value for the
// final clearIfRevisionMatches call -- so this function alone provides both
// halves of the correctness guarantee for its own mutation: durable
// evidence survives a crash at any point after this function is entered,
// and this function's own writes can never be silently clobbered by (nor
// silently clobber) a concurrent repair or another mutation for the same
// user. Returns the exact `derivedData` object the controller response
// contract exposes (see Controllers/ExpenseControllers/*.js).
//
// `budgetDates` may be empty (nothing to recalculate -- e.g. an edit that
// changed neither amount nor date), one date (add/delete, or an edit that
// stayed within the same month), or two dates (an edit whose expenseDate
// moved to a different month -- both the old and new month are always
// attempted independently, so one failing never skips the other).
// `budgetTokens`/`reportToken` are the reservation(s) obtained from this
// same mutation's own prior reserve() call (empty/null when the caller
// never reserved, e.g. an idempotent replay of an already-committed
// expense -- confirm() still runs and still marks Tier-1 pending correctly
// in that case, it just has nothing to release). `userWideToken` (Phase
// C.3) is the alternative edit/delete now use instead of budgetTokens --
// see reserve()'s and confirm()'s own doc comments.
async function synchronizeAfterMutation({
  userId,
  budgetDates = [],
  budgetTokens = [],
  reportToken = null,
  userWideToken = null,
} = {}) {
  const revision = await confirm({
    userId,
    budgetDates,
    confirmReport: true,
    budgetTokens,
    reportToken,
    userWideToken,
  });

  const failedBudgetDates = [];
  const repairedBudgetDates = [];
  let budgetStatus = "synchronized";
  let reportStatus = "synchronized";
  let firstError = null;

  for (const date of budgetDates) {
    try {
      const result = await recalculateBudget(userId, date, { fenceRevision: revision });
      if (result && result.skipped) {
        // Someone else recorded newer work for this user since `revision`
        // was captured above -- this result cannot be proven fresh, so it
        // was not persisted. Left pending; the newer caller's own attempt
        // (or a later repair) uses its own up-to-date revision.
        failedBudgetDates.push(date);
        budgetStatus = "pending";
      } else {
        repairedBudgetDates.push(date);
      }
    } catch (err) {
      failedBudgetDates.push(date);
      budgetStatus = "pending";
      firstError = firstError || err;
    }
  }

  let reportCleared = false;
  try {
    const result = await refreshReport(userId, { fenceRevision: revision });
    if (result && result.skipped) {
      reportStatus = "pending";
    } else {
      reportCleared = true;
    }
  } catch (err) {
    reportStatus = "pending";
    firstError = firstError || err;
  }

  await clearIfRevisionMatches({
    userId,
    revision,
    repairedBudgetMonths: repairedBudgetDates,
    reportCleared,
  });

  if (budgetStatus === "pending" || reportStatus === "pending") {
    try {
      await PendingSync.updateOne(
        { user: userId },
        { $set: { lastError: sanitizeError(firstError), lastAttemptAt: new Date() } }
      );
    } catch (_bookkeepingErr) {
      // Intentionally swallowed -- this is best-effort observability only;
      // the Tier-1 pending state itself (written by confirm() above) is
      // already durable regardless of whether this bookkeeping write lands.
    }
  }

  const recoveryPending = budgetStatus === "pending" || reportStatus === "pending";

  return {
    status: recoveryPending ? "pending" : "synchronized",
    budget: budgetStatus,
    report: reportStatus,
    recoveryPending,
  };
}

module.exports = {
  RESERVATION_STALE_MS,
  markPending,
  reserve,
  confirm,
  abandon,
  getPendingSync,
  clearIfRevisionMatches,
  allocateRepairRevision,
  repairIfPending,
  synchronizeAfterMutation,
};
