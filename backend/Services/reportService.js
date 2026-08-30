const reportCache = require('../cache/reportCache');
const { generateReport } = require("../analytics/reportGenerator");
const FinancialReport = require("../models/Report");
const { isCurrentReport } = require("../analytics/reportContractVersion");
// Phase C.4 requirement #2 -- getReport() reads models/PendingSync.js
// DIRECTLY (not through Services/syncRecoveryService.js) to avoid a
// circular require: syncRecoveryService.js already requires THIS module
// (for refreshReport). PendingSync is just a schema/model, not a service,
// so requiring it here directly carries no such risk.
const PendingSync = require("../models/PendingSync");

// Persists the freshly generated report through the existing upsert
// convention and re-caches it -- but see Phase C.2's `options.fenceRevision`
// handling below, which is the ACTUAL atomic guard used by refreshReport().
// A freshly generated report always carries the current metadata.version
// (see analytics/reportGenerator.js), so this call is the single place a
// legacy document gets replaced with a current one -- both in MongoDB and
// in Redis -- without ever touching another user's data or flushing the
// cache wholesale.
//
// Phase C.2 -- `options.fenceRevision`: when provided, the Mongo write
// itself (not a prior check) is conditioned on this exact document's
// stored `syncRevision` being absent or <= fenceRevision, and the SAME
// write stamps `syncRevision: fenceRevision`. This is a single atomic
// findOneAndUpdate -- there is no window between "checked" and "written"
// for a concurrent, newer refreshReport call to land in. Whichever call's
// write actually applies FIRST sets syncRevision to its own value; any
// other call fenced to an equal-or-older revision then atomically fails to
// match, regardless of which call started first or how long its own
// generateReport() took.
//
// Redis is written ONLY when the Mongo write actually applied -- never on
// a superseded/skipped result. This is what closes the equivalent Redis
// race: since a "win" strictly requires syncRevision > whatever is
// currently stored, the sequence of `reportCache.set()` calls for a given
// user is monotonically non-decreasing in revision. An older, slower
// refresh can never reach the Redis-set step after a newer one already
// won the Mongo CAS -- its own CAS attempt fails first, and it returns
// `{ skipped: true }` before ever touching the cache (so it also cannot
// invalidate a newer cache entry -- there is no separate invalidate call
// on the skipped path at all).
const persistAndCache = async (userId, generatedReport, options = {}) => {
  const { fenceRevision } = options;
  const isFenced = fenceRevision !== undefined && fenceRevision !== null;

  const filter = isFenced
    ? {
        user: userId,
        $or: [
          { syncRevision: { $exists: false } },
          { syncRevision: { $lte: fenceRevision } },
        ],
      }
    : { user: userId };

  // Phase C.3 -- built as a `$set` UPDATE, never a full-document
  // REPLACEMENT. Confirmed problem: MongoDB's replacement-style
  // `findOneAndUpdate(filter, plainObject)` fully REPLACES the matched
  // document, silently dropping any field not present in `plainObject` --
  // including `syncRevision` itself on an UNFENCED call (the plain object
  // built here never contained that field), which would otherwise erase the
  // very revision-fencing data every other atomic write in this codebase
  // (recalculateBudget, this same function's fenced branch, reportCache's
  // new CAS writes) depends on being reliably present. `$set` only ever
  // touches the exact top-level keys listed -- every other field on the
  // existing document (including a `syncRevision` an earlier fenced call
  // already stamped) survives untouched.
  const setFields = {
    user: userId,
    ...generatedReport,
  };
  if (isFenced) {
    setFields.syncRevision = fenceRevision;
  }
  // Remove the retired report branch from already-persisted documents as
  // part of the same atomic refresh. Without this, `$set` would preserve a
  // legacy `risk` field even though new reports no longer generate one.
  const update = { $set: setFields, $unset: { risk: "" } };

  // Phase C.2 correction -- this conditional write is NEVER allowed to
  // upsert. `user` carries a unique index (see models/Report.js), and
  // combining `upsert: true` with a filter that can fail to match an
  // EXISTING document (the whole point of the $or fence above) is a known
  // MongoDB pitfall: when nothing matches the full filter, an upsert
  // attempts to INSERT a new document rather than cleanly reporting "no
  // match" -- which here would collide with the unique index and throw a
  // duplicate-key error instead of the intended `{ skipped: true }`
  // outcome. Upserting (first-ever report creation, where genuinely no
  // document exists yet for this user) is handled as its own explicit,
  // separate step below, only once existence has actually been confirmed
  // to be absent.
  const savedReport = await FinancialReport.findOneAndUpdate(filter, update, {
    new: true,
    upsert: false,
    runValidators: true,
  }).lean();

  if (savedReport) {
    // Phase C.3 -- pass the SAME revision that just fenced the Mongo write
    // through to reportCache.set()'s own CAS, keeping Redis and Mongo
    // ordered by the identical value. An unfenced call passes `null`,
    // meaning "no fencing context" -- see reportCache.js's own doc comment
    // for why that can still populate an empty cache slot but can never
    // clobber an entry that already carries a real revision.
    await reportCache.set(userId, savedReport, isFenced ? fenceRevision : null);
    return savedReport;
  }

  // No document matched the (possibly fenced) filter -- distinguish "a
  // document exists but this call's fenceRevision lost" from "no document
  // exists for this user at all yet". Redis is deliberately never touched
  // on the fenced-out path.
  const existing = await FinancialReport.findOne({ user: userId }).lean();
  if (existing) {
    const skipped = { skipped: true, reason: 'superseded' };
    if (Number.isFinite(existing.syncRevision)) {
      skipped.currentRevision = existing.syncRevision;
    }
    return skipped;
  }

  // Genuinely the first report ever generated for this user. See
  // requirement #3's fix below (retryOnDuplicateKey) for how concurrent
  // first-ever creations for the SAME user are now resolved atomically --
  // this call may itself be a duplicate-key RETRY into the fenced update
  // above rather than a raw upsert; see createFirstReport().
  return createFirstReport(userId, setFields, fenceRevision, isFenced);
};

// Phase C.3 requirement #3 -- atomic, race-safe first-report creation.
//
// Confirmed problem: the PREVIOUS design here was
// "non-upserting fenced update -> existence check -> separate unconditional
// upsert". That sequence is NOT atomic end-to-end: two concurrent refreshes
// for a user with NO existing FinancialReport document (older attempt A,
// newer attempt B) can BOTH fail the initial fenced update (nothing exists
// yet to match), BOTH observe "no existing document" at the existence
// check, and BOTH then reach the final "unconditional upsert" step. Two
// concurrent upserts against the SAME unique-indexed `user` field cannot
// both succeed -- MongoDB itself resolves that with a duplicate-key error
// on whichever loses the race -- but the old code only caught E11000
// around that single call and mapped it straight to `{ skipped: true }`
// WITHOUT ever re-attempting to persist that call's (possibly NEWER) data
// through the normal fenced path. If B's upsert happened to lose the raw
// insert race to A's, B's genuinely newer content would be silently
// dropped, and the document left holding A's older content -- exactly the
// "no unhandled E11000, newer revision and payload retained" failure this
// requirement calls out.
//
// Fix: an upsert attempt that fails with E11000 means a document now
// definitely exists (the very race just proved it) -- so, rather than
// treating that as terminal, this retries EXACTLY ONE atomic, revision
// fenced `findOneAndUpdate` (upsert:false) against it, using the SAME
// filter/update `persistAndCache` already uses for the normal case. That
// retry is intrinsically safe to call unconditionally, regardless of
// whether this attempt is fenced or not:
//   - If this attempt IS fenced and its fenceRevision is >= whatever the
//     winning creator stamped, the retry's CAS wins and this call's
//     (newer) payload+revision persists, correctly overwriting the
//     just-inserted document -- newer data end-to-end.
//   - If this attempt IS fenced but LOST (its fenceRevision is older), the
//     retry's CAS correctly fails to match, and this call reports
//     `{ skipped: true, reason: 'superseded' }` -- older work is exactly
//     the case this requirement calls "reported as superseded".
//   - If this attempt is UNFENCED (fenceRevision undefined -- e.g.
//     getReport()'s very first cold-start call), the retry's filter is
//     `{ user: userId }` with no `$or` fence, so it unconditionally
//     re-applies via `$set` -- correct, since an unfenced caller has no
//     revision to lose to anyone by definition.
// Exactly one document ever exists afterward either way (the unique index
// guarantees that on its own), the newer revision/payload is always what
// survives when two calls DO have comparable revisions, and no E11000 ever
// escapes this function uncaught.
async function createFirstReport(userId, setFields, fenceRevision, isFenced) {
  // Phase C.3 correction -- this FIRST attempt uses the SAME (possibly
  // fenced) filter persistAndCache's own main attempt uses, not a bare
  // `{ user: userId }`. Using an unconditional filter here would be its own
  // unfenced write: if another writer has, by this point, already created
  // (or fenced-updated) the document with a NEWER revision, an
  // unconditional filter would MATCH it unconditionally and silently
  // overwrite that newer content with this call's own (possibly older)
  // one -- exactly the "newer revision silently dropped" failure this
  // requirement exists to prevent. Using the fenced filter here means an
  // upsert against an EXISTING, newer document correctly fails to match
  // (never overwrites it) and instead falls through to the upsert's own
  // INSERT attempt, which then collides with the unique index and throws
  // E11000 -- caught below and resolved by the retry, never left
  // unconditional.
  const filter = isFenced
    ? {
        user: userId,
        $or: [
          { syncRevision: { $exists: false } },
          { syncRevision: { $lte: fenceRevision } },
        ],
      }
    : { user: userId };

  try {
    const created = await FinancialReport.findOneAndUpdate(
      filter,
      { $set: setFields, $unset: { risk: "" } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();
    await reportCache.set(userId, created, isFenced ? fenceRevision : null);
    return created;
  } catch (err) {
    if (!err || err.code !== 11000) {
      throw err;
    }

    // Either a genuinely concurrent first-ever creation won the raw
    // insert, or an existing (fenced-out or not) document already covers
    // this user and this call's filter failed to match it, so the upsert
    // attempted -- and lost -- an INSERT. Either way, a document now
    // definitely exists. Retry through the SAME atomic, fenced (or
    // unfenced, matching this call's own fencing) update persistAndCache
    // uses for every other write, exactly once, this time WITHOUT upsert
    // (nothing further to insert -- a document is now guaranteed to
    // exist). This is a single findOneAndUpdate, not a loop -- the unique
    // index guarantees at most one further insert race can ever occur for
    // this user, and it was just resolved by the E11000 above.
    const retried = await FinancialReport.findOneAndUpdate(
      filter,
      { $set: setFields, $unset: { risk: "" } },
      { new: true, upsert: false, runValidators: true }
    ).lean();

    if (retried) {
      await reportCache.set(userId, retried, isFenced ? fenceRevision : null);
      return retried;
    }

    // This attempt's own fenceRevision lost to whichever concurrent writer
    // actually persisted -- correctly reported as superseded, never as an
    // unhandled duplicate-key error, and never silently overwritten either.
    return { skipped: true, reason: 'superseded' };
  }
}

// Phase C.4 requirement #2 -- getReport() must not be able to serve a
// cache entry (or even a STORED Mongo document) older than the durable
// minimum revision this user's report is known to require.
//
// Confirmed problem: the C.3 Redis CAS (cache/reportCache.js) proves an
// OLDER write can never overwrite a NEWER one already in Redis -- it does
// NOT prove Redis currently holds the LATEST write. A write can win the
// Mongo CAS and then never reach Redis at all (a genuine Redis-layer
// error, self-caught inside reportCache.js's own set(); or a process
// crash between the Mongo CAS succeeding and this module's own EVAL call
// ever running). Either way, Redis is left holding a validly-CAS-written
// but now STALE entry, and the OLD getReport() only ever checked
// isCurrentReport() (the report CONTRACT version, e.g. whether the
// `anomalies` section exists) -- never whether the cached REVISION was
// actually current. A stale-but-contract-current cache entry sailed
// straight through as a "Redis HIT".
//
// The fix: read models/PendingSync.js's `revision`/`reportPending` first
// (a single, tiny, indexed-by-user document -- cheap on every read) as the
// durable minimum-freshness signal. Every mutation controller passes
// `confirmReport: true` unconditionally through synchronizeAfterMutation,
// so `revision` and "the revision the report was last confirmed against"
// always advance together -- whenever `reportPending` is false, `revision`
// is EXACTLY the fenceRevision a correctly up-to-date report must carry.
// Neither the cache NOR the stored Mongo document is trusted unless its
// own recorded revision is >= that minimum (and reportPending is false);
// otherwise this falls through to a genuine live regeneration, exactly as
// the original "stale contract version" path already did for a legacy
// document -- now also triggered by a stale REVISION, not just a stale
// contract shape.
const getReport = async (userId) => {
  const pendingSync = await PendingSync.findOne({ user: userId }).lean();
  const reportPending = Boolean(pendingSync && pendingSync.reportPending);
  const minAcceptableRevision = pendingSync ? pendingSync.revision : null;

  // A cached/stored revision is fresh enough only when there is no known
  // pending recovery AND (there is no revision floor established yet for
  // this user at all, OR the candidate's own revision meets or exceeds
  // it). `candidateRevision` of `null`/`undefined` (no revision context
  // was ever recorded for that entry) can never satisfy a real floor.
  const isFreshEnough = (candidateRevision) => {
    if (reportPending) return false;
    if (minAcceptableRevision === null || minAcceptableRevision === undefined) return true;
    return (
      candidateRevision !== null &&
      candidateRevision !== undefined &&
      candidateRevision >= minAcceptableRevision
    );
  };

  const cachedEnvelope = await reportCache.getWithRevision(userId);

  if (cachedEnvelope) {
    if (isFreshEnough(cachedEnvelope.revision) && isCurrentReport(cachedEnvelope.payload)) {
      console.log("Redis HIT");
      return cachedEnvelope.payload;
    }
    // Either a legacy cached report (stale by CONTRACT, not content -- see
    // the original comment this replaces) or -- the new case this
    // requirement closes -- a cached entry whose own revision is older
    // than the durable minimum, or a known-pending report recovery. Either
    // way, this cache entry is never returned; the cache key is overwritten
    // (not flushed) once a genuinely fresh report is available below.
    console.log(
      reportPending
        ? "Redis HIT (report recovery pending, bypassing cache)"
        : "Redis HIT (stale cached revision or contract version, regenerating)"
    );
  } else {
    console.log("Redis MISS");
  }

  let report = await FinancialReport.findOne({ user: userId }).lean();

  if (report) {
    if (isFreshEnough(report.syncRevision) && isCurrentReport(report)) {
      await reportCache.set(userId, report, report.syncRevision ?? null);
      return report;
    }
    // A legacy persisted document, OR the stored document's own revision
    // is behind the durable minimum, OR a report recovery is known
    // pending -- never served as fresh. Falls through to regeneration;
    // persistAndCache() below upserts this exact user's document in place
    // (no other user's data is touched, no collection-wide migration/
    // backfill is run here).
    console.log(
      reportPending
        ? "Stored report has a pending recovery marker, regenerating"
        : "Stored report has a stale contract version or revision, regenerating"
    );
  }

  const generatedReport = await generateReport(userId);

  return persistAndCache(userId, generatedReport);
};

// Regenerate and cache the user's financial report.
//
// Phase C.2 -- `options.fenceRevision`: passed straight through to
// persistAndCache(), whose atomic conditional write is the actual fencing
// mechanism (see its doc comment above). generateReport() always computes
// from current data regardless of fencing; the fence only ever decides
// whether the RESULT is allowed to be persisted. There is no separate
// pre-write revision check here anymore -- a bare read-then-compare (C.1's
// original approach) is a check-to-write race, not atomic fencing.
// Callers that omit fenceRevision are unaffected -- byte-for-byte original
// behavior.
const refreshReport = async (userId, options = {}) => {
  const { fenceRevision } = options;

  const generatedReport = await generateReport(userId);

  return persistAndCache(userId, generatedReport, { fenceRevision });
};

module.exports = {
  getReport,
  refreshReport,
};
