// Expense-mutation reliability: a durable per-user PendingSync marker plus read-time repair (no queue/worker/transaction) closes the crash gap between a committed expense write and its budget/report recompute. Tier 1 (pendingBudgetMonths/reportPending) is confirmed, CAS-guarded work; Tier 2 (reservedBudgetMonths/reservedReports/reservedUserWideReservations) is pre-write intent evidence written by reserve(), stored as owned-token arrays, retired only by the owning confirm()/abandon() call -- never by age alone. See reserve()/confirm()/repairIfPending() below for the mechanics.
"use strict";

const crypto = require("crypto");
const PendingSync = require("../models/PendingSync");
const { BudgetModel } = require("../config/Schemas");
const { recalculateBudget, getMonthAnchor, getMonthAnchorFromKey } = require("./BudgetServices/budget.service");
const { refreshReport } = require("./reportService");

const MAX_ERROR_LENGTH = 500;

// Age past which a reservation is worth a defensive recompute (repairIfPending()'s Tier-2 pass) -- never grounds for releasing it, since a fixed timeout can't prove a slow owner won't still write; `now` is injectable so tests can exercise the age-gate deterministically.
const RESERVATION_STALE_MS = 15000;

function newToken() {
  return crypto.randomBytes(16).toString("hex");
}

// Atomically claims a fresh, unique fencing revision for exactly one repair attempt (a single Tier-1 or Tier-2 pass), so two concurrent repairs for the same user can never fence their writes to the same value and let the physically-later write silently overwrite a fresher result.
async function allocateRepairRevision(userId) {
  const record = await PendingSync.findOneAndUpdate(
    { user: userId },
    { $inc: { revision: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return record.revision;
}

// Never persists a raw stack trace or document content -- only a short, sanitized message, matching PendingSync's own maxlength.
function sanitizeError(err) {
  if (!err) return null;
  const message = typeof err.message === "string" && err.message ? err.message : String(err);
  return message.length > MAX_ERROR_LENGTH ? message.slice(0, MAX_ERROR_LENGTH) : message;
}

// Deduplicates dates down to their distinct month anchors, so the same month is never recorded twice regardless of which day-of-month triggered it.
function dedupeMonthAnchors(dates) {
  const seen = new Map();
  for (const date of dates || []) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
    const anchor = getMonthAnchor(date);
    seen.set(anchor.getTime(), anchor);
  }
  return [...seen.values()];
}

// PendingSync has existed across server timezone changes. Preserve the exact
function dedupeExactDates(dates) {
  const seen = new Map();
  for (const date of dates || []) {
    const parsed = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(parsed.getTime())) continue;
    seen.set(parsed.getTime(), parsed);
  }
  return [...seen.values()];
}

// Records new pending derived-data work outside the confirm()/reserve() flow (e.g. repair-failure bookkeeping); purely additive so concurrent callers never lose each other's updates.
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

// Pre-write durable intent marker -- MUST be called and awaited BEFORE the primary expense write, so a crash before confirm() still leaves evidence for repairIfPending() to find. Each reservation gets its own token (not the shared `revision`) so a concurrent repair can never mistake it for, or prematurely clear it via, a different stale reservation.
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
  // Broad, month-agnostic reservation for edit/delete -- valid regardless of which month the write ultimately lands in, so no second reservation is needed after the write.
  const userWideReservation = reserveUserWide ? { token: newToken(), reservedAt: now } : null;

  // Every reservation is PUSHED as its own array entry (never $set, which would overwrite an earlier still-unconfirmed one), so concurrent reservations for the same user always coexist.
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

// Post-write confirm, called immediately after the primary write commits and before any recompute -- unconditionally, so a crash right after this call still leaves a durable, repair-eligible Tier-1 marker. One atomic update bumps `revision`, sets Tier-1 fields, and releases the specific reservation token(s) being confirmed; runs even for callers that never reserved. Returns the new revision.
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

  // $pull releases only the specific token(s) this call owns -- a different in-flight reservation for the same user is never touched.
  const pull = {};
  if (budgetTokens.length > 0) {
    pull.reservedBudgetMonths = { token: { $in: budgetTokens } };
  }
  if (reportToken) {
    pull.reservedReports = { token: reportToken };
  }
  // Same atomic write that just recorded the true affected month(s) as Tier-1 pending work, so there is never a window where they're covered by neither the reservation nor a Tier-1 marker.
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

// Explicit reservation release, called only by the request that owns the token(s) once it knows its own write definitively failed -- never based on elapsed time. Best-effort: if this update fails, the reservation just survives and is harmlessly recomputed once stale, same as any other abandoned reservation.
async function abandon({ userId, budgetTokens = [], reportToken = null, userWideToken = null } = {}) {
  if (budgetTokens.length === 0 && !reportToken && !userWideToken) return null;

  // $pull releases only evidence owned by the exact token(s) passed in -- never a different, still-valid reservation for the same user/field.
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

// CAS clear: only removes the specific repaired budget months and only clears reportPending if the marker's revision still matches the caller's captured value -- a newer mutation's revision bump makes this a no-op. Guards the MARKER only; the derived-data write itself is separately guarded by `fenceRevision` on recalculateBudget/refreshReport.
async function clearIfRevisionMatches({
  userId,
  revision,
  repairedBudgetMonths = [],
  repairedStoredBudgetMonthAnchors = [],
  reportCleared = false,
} = {}) {
  const monthAnchors = dedupeExactDates([
    ...dedupeMonthAnchors(repairedBudgetMonths),
    ...dedupeExactDates(repairedStoredBudgetMonthAnchors),
  ]);

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

// Shared read-time repair used by reportService.getReport() and getbudgets.js. Runs three passes -- 0: promote stale legacy reservedReport/reservedUserWide into modern Tier-1 evidence; 1: Tier-1 recompute+clear, fenced so a slow repair can't clobber fresher data; 2: Tier-2 recompute for reservations older than RESERVATION_STALE_MS, releasing only the exact stale token found. A step only clears its pending state on real (non-superseded) success; never throws. `options.now` overrides the current time for deterministic Tier-2 staleness tests.
async function repairIfPending(userId, options = {}) {
  try {
    const nowMs =
      options.now instanceof Date
        ? options.now.getTime()
        : typeof options.now === "number"
        ? options.now
        : Date.now();
    const staleThreshold = nowMs - RESERVATION_STALE_MS;

    // Pass 0: legacy backward-compatibility. An old-version process may have left a legacy single-object reservedReport/reservedUserWide reservation with no matching array-based evidence; once stale, atomically promote it into modern Tier-1 evidence (same write that clears the legacy field, so it's CAS'd and idempotent against repeats) so pass 1 below reconciles it via the normal machinery. Non-stale legacy reservations are left untouched until they age past the threshold.
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
      // Promotion failed -- the legacy reservation survives untouched (atomic findOneAndUpdate either fully applies or not at all) for the next call to retry.
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
        // Same broad-recovery principle as the modern Tier-2 pass below: this reservation doesn't know which month(s) it affected, so promotion enumerates every existing BudgetModel month for this user (safe to repeat -- $addToSet is idempotent, and the write is guarded by the legacy token CAS below).
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
      // A fresh, uniquely-allocated ticket for this attempt (never the statically-read before.revision) -- see allocateRepairRevision()'s doc comment for why two concurrent repairs sharing a revision could otherwise let a staler result overwrite a fresher one.
      const revision = await allocateRepairRevision(userId);
      const repairedMonths = [];
      let budgetError = null;
      let reportCleared = false;
      let reportError = null;
      let highestSupersedingRevision = null;

      for (const anchor of before.pendingBudgetMonths) {
        try {
          const result = await recalculateBudget(userId, anchor, { fenceRevision: revision });
          if (result && result.skipped) {
            // Superseded by newer recorded work -- not treated as repaired; the newer work's own attempt (or a later repair) persists it.
            budgetError = budgetError || new Error("Superseded by newer pending work");
            if (Number.isFinite(result.currentRevision)) {
              highestSupersedingRevision = Math.max(
                highestSupersedingRevision || 0,
                result.currentRevision
              );
            }
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
            if (Number.isFinite(result.currentRevision)) {
              highestSupersedingRevision = Math.max(
                highestSupersedingRevision || 0,
                result.currentRevision
              );
            }
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
        // These values came directly from PendingSync. Pull their exact
        repairedStoredBudgetMonthAnchors: repairedMonths,
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

      // A derived document can legitimately reject an older concurrent
      if (highestSupersedingRevision !== null && !options.revisionFloorRetry) {
        const markerAfterSkip = await getPendingSync(userId);
        const markerRevision = Number(markerAfterSkip && markerAfterSkip.revision);
        if (Number.isFinite(markerRevision) && highestSupersedingRevision > markerRevision) {
          await PendingSync.findOneAndUpdate(
            { user: userId },
            { $max: { revision: highestSupersedingRevision } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          return repairIfPending(userId, { ...options, revisionFloorRetry: true });
        }
      }
    }

    // Tier 2: age-gated defensive recompute that NEVER releases a reservation -- a fixed timeout can't prove a genuinely still-alive, slow owner won't still write, so clearing on mere staleness would reopen the crash gap Tier 2 exists to close. Only confirm() or abandon() ever retires a reservation; an owner that crashed and never retries leaves it stale-and-recomputed on every subsequent read indefinitely -- an accepted, unbounded cost in exchange for never silently losing recovery evidence. `staleThreshold` was already computed above (pass 0 needs it too).
    const current = await getPendingSync(userId);

    const staleBudgetReservations = ((current && current.reservedBudgetMonths) || []).filter(
      (r) => new Date(r.reservedAt).getTime() < staleThreshold
    );
    // reservedReports/reservedUserWideReservations are arrays, so multiple entries can be simultaneously stale; staleness is per-entry but only one recompute runs below regardless of how many stale entries exist.
    const staleReportReservations = ((current && current.reservedReports) || []).filter(
      (r) => new Date(r.reservedAt).getTime() < staleThreshold
    );
    const reportReservationStale = staleReportReservations.length > 0;
    const staleUserWideReservations = ((current && current.reservedUserWideReservations) || []).filter(
      (r) => new Date(r.reservedAt).getTime() < staleThreshold
    );
    const userWideReservationStale = staleUserWideReservations.length > 0;

    // Same fresh-ticket fix as the Tier-1 pass, shared across this call's three Tier-2 sub-passes; only allocated when there's actually stale work to fence, so an empty read never churns the counter.
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
        // Deliberately no reservedReports clear here -- only the owning mutation's own confirm()/abandon() ever removes its entry.
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

    // reservedUserWideReservations' own defensive recompute: unlike reservedBudgetMonths, it doesn't know which month(s) were affected (taken before the write), so once any entry is stale it reconstructs every BudgetModel month this user has from live expense data. Never releases the reservation itself -- only confirm()/abandon() does that.
    if (userWideReservationStale) {
      try {
        const existingBudgetMonths = await BudgetModel.find({ userId }).select("month").lean();
        for (const doc of existingBudgetMonths) {
          const monthAnchor = getMonthAnchorFromKey(doc.month);
          if (!monthAnchor) continue; // defensively skip any unparsable legacy month key
          try {
            await recalculateBudget(userId, monthAnchor, { fenceRevision: tier2Revision });
            // Deliberately no reservedUserWideReservations clear here -- see comment above.
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
        // Enumeration query itself failed -- treat as a budget repair failure; the reservation survives untouched for the next stale read to retry.
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
    // A non-stale legacy reservation is untouched by pass 0, so it's still represented here -- a caller never mistakes "nothing to do" for "legacy evidence still waiting to age out".
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
      // legacyReportPromoted/legacyUserWidePromoted are deliberately not part of this public return contract -- no caller reads them; they still feed `attempted` below, and legacy promotion is provable from persisted document state (see tests/syncRecoveryService.legacyCompatibility.test.js).
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

// Best-effort post-write synchronization: the caller must have already called reserve() and must pass its tokens here. First action is an unconditional confirm(), so durable Tier-1 evidence exists before any recompute; the revision it returns then fences every recompute+persist in this call and the final clearIfRevisionMatches. `budgetDates` may hold 0, 1, or 2 dates (an edit that moved months attempts both independently); `budgetTokens`/`reportToken`/`userWideToken` are this mutation's own reserve() tokens (empty/null for a caller that never reserved -- confirm() still runs correctly, it just has nothing to release).
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
        // Someone else recorded newer work since `revision` was captured -- left pending for the newer caller's own attempt or a later repair.
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
      // Intentionally swallowed -- best-effort observability only; the Tier-1 pending state (written by confirm() above) is already durable regardless.
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
