const { redisClient } = require("../config/redis");

const TTL = 3600; // 1 hour

const getCacheKey = (userId) => `report:${userId}`;

// Phase C.3 -- atomic revision-aware cache write.
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
async function getWithRevision(userId) {
    try {
        const data = await redisClient.get(getCacheKey(userId));
        if (!data) return null;

        const decoded = JSON.parse(data);
        if (decoded && Object.prototype.hasOwnProperty.call(decoded, "payload")) {
            return { revision: decoded.revision ?? null, payload: decoded.payload };
        }
        // Legacy bare-payload entry, written before this CAS wrapper
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
