const { redisClient } = require("../config/redis");

const TTL = 3600; // 1 hour

const getCacheKey = (userId) => `report:${userId}`;

// Phase C.3 -- atomic revision-aware cache write.
//
// Confirmed problem: an ordinary GET-then-SET (or a bare unconditional SET,
// which is what this module used before) is NOT atomic across concurrent
// writers. Proven race: Refresh A applies its Mongo write at revision 10,
// then pauses (process scheduling, GC, network) AFTER the Mongo write
// succeeds but BEFORE its own Redis SET runs. Refresh B, for the SAME user,
// applies its Mongo write at revision 11 and successfully stores it in
// Redis. A then resumes and performs its own (unconditional) SET -- silently
// overwriting B's newer cached report with A's older one. Every subsequent
// cache read now serves stale data until some later refresh happens to run
// again, with no error or signal anywhere that this happened.
//
// Every cache entry this module writes is therefore `{ revision, payload }`,
// never a bare report object, and every write (SET) is a single atomic Lua
// script executed via EVAL: it reads whatever is currently cached, and only
// overwrites it when the incoming write's revision is NOT OLDER than the
// currently cached entry's revision. Redis executes a Lua script as one
// atomic operation -- no other command (including another EVAL of this same
// script) can interleave between this script's own GET and SET, which is
// exactly the property a plain client-side GET-then-SET cannot offer. This
// closes the A/B race above unconditionally: whichever of A/B's Redis writes
// actually executes SECOND is the one whose revision is compared against the
// FIRST one's already-stored revision, and an older revision always loses
// regardless of which call *started* first or how long either call's own
// Mongo write took.
//
// `revision` is the SAME `syncRevision`/PendingSync `revision` value already
// used to fence the Mongo write in Services/reportService.js's
// persistAndCache()/budget.service.js's recalculateBudget() -- passing the
// identical value keeps a single, consistent ordering across both stores. A
// `null`/`undefined` revision means "no fencing context available" (e.g. the
// very first report ever generated for a user, before any mutation/revision
// exists yet): such a write is allowed to populate an EMPTY cache slot (there
// is nothing to protect against yet) but is NEVER allowed to overwrite an
// entry that already carries a real numeric revision, since an unrevisioned
// write cannot prove it is not stale relative to that entry.
const CAS_SET_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
local incomingRevision = ARGV[2]

if existing then
  local ok, decoded = pcall(cjson.decode, existing)
  if ok and decoded ~= nil and decoded.revision ~= nil and decoded.revision ~= cjson.null then
    if incomingRevision == '' then
      return 0
    end
    if tonumber(incomingRevision) < tonumber(decoded.revision) then
      return 0
    end
  end
end

redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

// Phase C.3 -- the same CAS comparison as CAS_SET_SCRIPT, but for deletion.
// Confirmed problem (requirement #2's invalidation clause): reportCache
// itself never calls invalidate() today (verified -- only get()/set() are
// used by Services/reportService.js), but a bare unconditional DEL is
// exactly as unsafe as a bare unconditional SET would be if any future
// caller invalidates using stale knowledge of "this revision is now wrong"
// -- an older invalidation attempt could delete a newer entry a concurrent,
// newer refresh already cached, reintroducing an unnecessary cache miss (not
// a correctness bug on its own, but a real regression of the CAS guarantee
// above: a "delete" from an older writer should never undo a newer writer's
// already-cached result). This makes invalidation participate in the exact
// same revision ordering as writes: only deletes when the caller's
// `revision` is NOT OLDER than whatever is currently cached (or when nothing
// is cached, or when the caller passes no revision at all -- an
// unconditional/administrative invalidation with no revision context, e.g. a
// manual cache-clear operation, is intentionally still honored unconditionally
// since it does not claim any freshness knowledge to violate).
const CAS_DEL_SCRIPT = `
local existing = redis.call('GET', KEYS[1])
local incomingRevision = ARGV[1]

if existing and incomingRevision ~= '' then
  local ok, decoded = pcall(cjson.decode, existing)
  if ok and decoded ~= nil and decoded.revision ~= nil and decoded.revision ~= cjson.null then
    if tonumber(incomingRevision) < tonumber(decoded.revision) then
      return 0
    end
  end
end

redis.call('DEL', KEYS[1])
return 1
`;

async function get(userId) {
    try {
        const data = await redisClient.get(getCacheKey(userId));

        if (!data) return null;

        const decoded = JSON.parse(data);
        // Tolerate a legacy cache entry written before this CAS wrapper
        // existed (a bare report object, no `{ revision, payload }`
        // envelope) -- treat it as the payload directly rather than
        // erroring or silently returning `undefined`.
        if (decoded && Object.prototype.hasOwnProperty.call(decoded, "payload")) {
            return decoded.payload;
        }
        return decoded;
    } catch (err) {
        console.error(`Report cache get failed for user ${userId}:`, err.message);
        return null;
    }
}

// Phase C.4 requirement #2 -- returns the FULL `{ revision, payload }`
// envelope (or `null`), unlike get() above which discards the revision.
// Confirmed problem: get()'s own CAS-write guarantee (an older Refresh can
// never overwrite a newer cached entry) does NOT, by itself, prove that
// whatever IS currently cached is fresh enough to serve -- it only proves
// ordering AMONG writes that actually reached Redis. A write can succeed
// in Mongo and then never reach Redis at all (a genuine Redis-layer error,
// silently swallowed by set()'s own try/catch; or a crash between the
// Mongo CAS succeeding and this module's own EVAL call ever running -- see
// Services/reportService.js's persistAndCache doc comment). In either
// case, Redis is left holding a real, validly-CAS-written, but now STALE
// entry, and nothing about get()'s own contract exposes that staleness --
// only the caller comparing the returned revision against some OTHER
// durable source of truth can catch it. Services/reportService.js's
// getReport() is that caller -- see its own doc comment for what it
// compares this against.
async function getWithRevision(userId) {
    try {
        const data = await redisClient.get(getCacheKey(userId));
        if (!data) return null;

        const decoded = JSON.parse(data);
        if (decoded && Object.prototype.hasOwnProperty.call(decoded, "payload")) {
            return { revision: decoded.revision ?? null, payload: decoded.payload };
        }
        // Legacy bare-payload entry, written before this CAS wrapper
        // existed -- no revision information was ever recorded for it, so
        // it can never be proven fresh against a real revision requirement.
        return { revision: null, payload: decoded };
    } catch (err) {
        console.error(`Report cache get failed for user ${userId}:`, err.message);
        return null;
    }
}

async function set(userId, report, revision = null) {
    try {
        const envelope = JSON.stringify({ revision, payload: report });
        await redisClient.eval(CAS_SET_SCRIPT, {
            keys: [getCacheKey(userId)],
            arguments: [envelope, revision === null || revision === undefined ? "" : String(revision), String(TTL)],
        });
    } catch (err) {
        console.error(`Report cache set failed for user ${userId}:`, err.message);
    }
}

async function invalidate(userId, revision = null) {
    try {
        await redisClient.eval(CAS_DEL_SCRIPT, {
            keys: [getCacheKey(userId)],
            arguments: [revision === null || revision === undefined ? "" : String(revision)],
        });
    } catch (err) {
        console.error(`Report cache invalidate failed for user ${userId}:`, err.message);
    }
}

module.exports = {
    get,
    getWithRevision,
    set,
    invalidate,
};
