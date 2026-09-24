"use strict";

// IMP-001-T06 -- final step of the CSV import pipeline: committing an
// ImportSession's user-accepted rows into real, permanent Expense
// documents, exactly once, even under a retried/duplicated/concurrent
// commit call. Reuses this codebase's existing expense-creation
// conventions verbatim (Controllers/ExpenseControllers/addexpense.js is
// the authoritative reference this module was built against) rather than
// inventing a parallel path: same ExpenseModel shape, same
// reserve()/save/synchronizeAfterMutation() sequencing from
// syncRecoveryService.js, same clearUserExpenseCache() call, and the same
// {userId, id} unique-index idempotency mechanism (here keyed as
// `import:<sessionId>:<rowIndex>` instead of a client-chosen id) so a
// retried commit's duplicate ExpenseModel insert hits the identical
// Mongo E11000 path addexpense.js already handles.
const ImportSession = require("../../models/ImportSession");
const { ExpenseModel } = require("../../config/Schemas");
const { reserve, abandon, synchronizeAfterMutation } = require("../syncRecoveryService");
const { clearUserExpenseCache } = require("../../utils/expenseCache");
const { normalizeCategory } = require("../../utils/categoryNormalization");
const {
  IMPORT_SESSION_STATUSES,
  IMPORT_ROW_DECISIONS,
} = require("../../utils/importTypes");

const ERROR_CODES = Object.freeze({
  NOT_FOUND: "NOT_FOUND",
  ALREADY_COMMITTING: "ALREADY_COMMITTING",
  SESSION_EXPIRED: "SESSION_EXPIRED",
});

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// Builds this row's idempotency key. Same {userId, id} unique index
// ExpenseModel already has for a manually-added expense (config/
// Schemas.js) -- reused here rather than a second mechanism, so a
// retried commit's re-insert attempt for the same row naturally hits the
// same E11000 duplicate-key path addexpense.js already handles below.
function rowIdempotencyKey(sessionId, rowIndex) {
  return `import:${sessionId}:${rowIndex}`;
}

function toIdString(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

// Public safe shape for one row -- same convention the session preview
// (T03/T04) already uses: never the raw Mongoose subdocument.
function rowSafeShape(row) {
  return {
    rowIndex: row.rowIndex,
    mapped: {
      expenseName: row.mapped ? row.mapped.expenseName : null,
      expenseAmount: row.mapped ? row.mapped.expenseAmount : null,
      expenseDate: row.mapped ? row.mapped.expenseDate : null,
      expenseCategory: row.mapped ? row.mapped.expenseCategory : null,
    },
    decision: row.decision,
    committedExpenseId: toIdString(row.committedExpenseId),
    validationErrors: Array.isArray(row.validationErrors) ? row.validationErrors : [],
  };
}

// Public safe shape for the whole session -- used both for a fresh
// commit result and for an idempotent replay of an already-committed
// session (rebuilt from persisted state, no new work performed).
function sessionSafeShape(session) {
  return {
    id: toIdString(session._id),
    status: session.status,
    committedAt: session.committedAt || null,
    committedCount: session.committedCount || 0,
    skippedCount: session.skippedCount || 0,
    rows: (session.rows || []).map(rowSafeShape),
  };
}

// A row is eligible to actually become an Expense only if: the user
// accepted it, it carries no validation errors from the parse/validate
// step (T06 never trusts an ACCEPT decision on an invalid row -- see
// ImportSession.js's own comment on importRowSchema.validationErrors),
// its category normalizes to a non-null value (normalizeCategory is the
// same write-boundary gate addexpense.js already enforces), and its
// other required fields are present/well-formed. That last part is
// defense-in-depth beyond what the contract promises (T03 should never
// hand T06 an accept-decided, error-free row with a missing/malformed
// required field) -- but a malformed row reaching this far must never be
// allowed to throw an uncaught Mongoose ValidationError mid-batch and
// abort every OTHER row's commit, so it is treated as ineligible
// (counted in skippedCount) instead.
function evaluateRowEligibility(row) {
  if (row.decision !== IMPORT_ROW_DECISIONS.ACCEPT) {
    return { eligible: false };
  }
  if (Array.isArray(row.validationErrors) && row.validationErrors.length > 0) {
    return { eligible: false };
  }

  const mapped = row.mapped || {};
  const normalizedCategory = normalizeCategory(mapped.expenseCategory);
  if (normalizedCategory === null) {
    return { eligible: false };
  }

  const expenseName = typeof mapped.expenseName === "string" ? mapped.expenseName.trim() : "";
  if (!expenseName) {
    return { eligible: false };
  }

  const expenseAmount = mapped.expenseAmount;
  if (typeof expenseAmount !== "number" || !Number.isFinite(expenseAmount)) {
    return { eligible: false };
  }

  const expenseDate = new Date(mapped.expenseDate);
  if (Number.isNaN(expenseDate.getTime())) {
    return { eligible: false };
  }

  return {
    eligible: true,
    expenseName,
    normalizedCategory,
    expenseAmount,
    expenseDate,
  };
}

async function commitImportSession({ userId, sessionId }) {
  // Session-level idempotency: atomic compare-and-swap, previewing ->
  // committing. This is what makes a concurrent/retried second commit
  // request provably unable to double-commit -- only the single caller
  // whose findOneAndUpdate actually matched status:"previewing" ever
  // proceeds to create expenses.
  let session = await ImportSession.findOneAndUpdate(
    { _id: sessionId, userId, status: IMPORT_SESSION_STATUSES.PREVIEWING },
    { $set: { status: IMPORT_SESSION_STATUSES.COMMITTING } },
    { new: true }
  );

  if (!session) {
    // The CAS didn't match -- re-fetch to find out why and branch on the
    // session's ACTUAL current status.
    const existing = await ImportSession.findOne({ _id: sessionId, userId });
    if (!existing) {
      throw makeError(ERROR_CODES.NOT_FOUND, "Import session not found.");
    }

    if (existing.status === IMPORT_SESSION_STATUSES.COMMITTED) {
      // Idempotent replay: the same success response a fresh commit
      // would have produced, rebuilt from already-committed row data.
      // No expense creation, no reserve/sync/cache work -- this is a
      // pure read.
      return sessionSafeShape(existing);
    }
    if (existing.status === IMPORT_SESSION_STATUSES.COMMITTING) {
      throw makeError(ERROR_CODES.ALREADY_COMMITTING, "This import session is already being committed.");
    }
    if (existing.status === IMPORT_SESSION_STATUSES.EXPIRED) {
      throw makeError(ERROR_CODES.SESSION_EXPIRED, "This import session has expired.");
    }

    // Defensive: under normal atomic-CAS semantics this branch is
    // unreachable (a CAS miss means the status was NOT "previewing" at
    // that instant, and status only ever moves forward -- see
    // importTypes.js's own state-machine comment). Surfaced as an
    // unexpected error rather than silently retried, so it is never
    // swallowed.
    throw new Error(`Unexpected import session status "${existing.status}" after a failed CAS.`);
  }

  // From here on, this call exclusively owns the session (status is
  // "committing", and only this call's own CAS set it there).
  const sessionIdStr = toIdString(session._id);
  const rows = session.rows || [];

  const eligibleEntries = [];
  for (const row of rows) {
    const evaluation = evaluateRowEligibility(row);
    if (evaluation.eligible) {
      eligibleEntries.push({ row, ...evaluation });
    }
  }

  // Reserve budget/report recalculation capacity ONCE for the whole
  // batch (never once per row) -- same Phase C reserve-before-write
  // discipline addexpense.js uses for a single expense, scaled to N.
  const budgetDates = eligibleEntries.map((entry) => entry.expenseDate);
  const reserved = await reserve({
    userId,
    budgetDates,
    reserveReport: true,
  });
  const budgetTokens = reserved.budgetReservations.map((r) => r.token);
  const reportToken = reserved.reportReservation && reserved.reportReservation.token;

  if (eligibleEntries.length === 0) {
    // Nothing will be written -- this is the "reserve succeeded but we
    // bail out before attempting any saves at all" case: release the
    // reservation immediately instead of leaving it to age out, and
    // finalize the session with 0 committed / all rows skipped.
    await abandon({ userId, budgetTokens, reportToken }).catch(() => {});

    session.status = IMPORT_SESSION_STATUSES.COMMITTED;
    session.committedAt = new Date();
    session.committedCount = 0;
    session.skippedCount = rows.length;
    await session.save();

    return sessionSafeShape(session);
  }

  let committedCount = 0;

  try {
    for (const entry of eligibleEntries) {
      const { row, expenseName, normalizedCategory, expenseAmount, expenseDate } = entry;
      const idempotencyKey = rowIdempotencyKey(sessionIdStr, row.rowIndex);

      const newExpense = new ExpenseModel({
        userId,
        id: idempotencyKey,
        expenseName,
        expenseCategory: normalizedCategory,
        expenseAmount,
        expenseDate,
        expenseDescription: "",
      });

      try {
        await newExpense.save();
        row.committedExpenseId = newExpense._id;
        committedCount += 1;
      } catch (saveErr) {
        if (saveErr && saveErr.code === 11000) {
          // Same race addexpense.js already handles: a concurrent/
          // retried commit attempt for the SAME row won first. That
          // attempt's write is authoritative -- look it up and reuse it
          // rather than failing this row (or the whole batch).
          const existingExpense = await ExpenseModel.findOne({ userId, id: idempotencyKey }).lean();
          if (existingExpense) {
            row.committedExpenseId = existingExpense._id;
            committedCount += 1;
            continue;
          }
        }
        // Any other failure (including an 11000 whose winner
        // mysteriously can't be found) is a genuine, unexpected error --
        // propagate to the outer catch's partial-failure recovery.
        throw saveErr;
      }
    }

    session.status = IMPORT_SESSION_STATUSES.COMMITTED;
    session.committedAt = new Date();
    session.committedCount = committedCount;
    session.skippedCount = rows.length - committedCount;
    await session.save();

    await clearUserExpenseCache(userId);
    await synchronizeAfterMutation({
      userId,
      budgetDates,
      budgetTokens,
      reportToken,
    });

    return sessionSafeShape(session);
  } catch (err) {
    // Mid-loop failure recovery. Some rows in `eligibleEntries` may
    // already have a real, saved Expense document (row.committedExpenseId
    // was set on the in-memory subdocument before the failure) -- those
    // writes are genuine and permanent, they are simply not yet reflected
    // in the session's own persisted state.
    //
    // Recovery choice: revert status to PREVIEWING rather than leaving it
    // stuck in COMMITTING. Rationale: (1) it lets the user's client retry
    // the commit immediately instead of waiting out the ~24h retention
    // sweep (importTypes.js's IMPORT_SESSION_RETENTION_HOURS); (2) it is
    // provably safe to retry because of the exact same {userId, id}
    // idempotency key scheme used above -- a retried commit re-attempts
    // every eligible row, and every row that already has a real Expense
    // document simply hits the E11000 path again and is looked up rather
    // than double-created. The alternative (leave status:"committing")
    // would only be safer if retrying were somehow unsafe, which it is
    // not here.
    try {
      session.status = IMPORT_SESSION_STATUSES.PREVIEWING;
      await session.save();
    } catch (_persistErr) {
      // Best-effort only -- if even this fails, the session is left in
      // "committing" and the ~24h retention sweep (importTypes.js) is the
      // fallback recovery path; the already-created Expense documents are
      // unaffected either way since they don't live on the session.
    }

    // Sync whatever budget/report impact the rows that DID succeed
    // before the failure actually had -- recalculateBudget/refreshReport
    // read real, current Expense data, so running this for the full
    // originally-reserved date set is correct regardless of exactly how
    // many of those rows ended up committed. Best-effort: this must never
    // mask the original failure below.
    await synchronizeAfterMutation({
      userId,
      budgetDates,
      budgetTokens,
      reportToken,
    }).catch(() => {});
    await clearUserExpenseCache(userId).catch(() => {});

    console.error("importCommitService.commitImportSession failed mid-batch:", err);
    throw err;
  }
}

module.exports = {
  commitImportSession,
  ERROR_CODES,
};
