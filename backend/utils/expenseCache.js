const { redisClient } = require('../config/redis');

const DEFAULT_TTL_SECONDS = 300;

// All keys written through this module follow "<feature>:<userId>[:<variant>...]"
// (e.g. "lastWeek:<userId>", "category:<userId>:<period>", "pie:<userId>:<year>:<type>").
// This lets clearUserExpenseCache find every key for a user without a KEYS/SCAN
const getUserIdFromKey = (key) => key.split(':')[1];
const userKeySetName = (userId) => `cachekeys:${userId}`;

// Set Cache
const setCache = async (key, data, ttl = DEFAULT_TTL_SECONDS) => {
    try {
        // Queue the value SET and its tracking-set SADD/EXPIRE into a single
        // MULTI/EXEC transaction so they're sent to Redis as one atomic unit —
        // a partial failure (e.g. the connection dropping between commands)
        // can no longer leave the cached value written but untracked in
        // cachekeys:<userId>, which would make it invisible to
        // clearUserExpenseCache until it expired on its own.
        const multi = redisClient.multi().set(key, JSON.stringify(data), { EX: ttl });

        const userId = getUserIdFromKey(key);
        if (userId) {
            const setKey = userKeySetName(userId);
            multi.sAdd(setKey, key).expire(setKey, ttl);
        }

        await multi.exec();

        console.log(`Cache set: ${key}`);
    } catch (err) {
        // Caching is best-effort — a Redis hiccup should not fail the request.
        console.error(`Cache set failed for ${key}:`, err.message);
    }
};

// Get Cache
const getCache = async (key) => {
    try {
        const raw = await redisClient.get(key);

        if (!raw) return null;

        console.log(`Cache hit: ${key}`);
        return JSON.parse(raw);
    } catch (err) {
        // Treat a Redis error the same as a cache miss so the caller falls
        // through to the live DB path instead of throwing.
        console.error(`Cache get failed for ${key}:`, err.message);
        return null;
    }
};

// Clear all cache for a user
const clearUserExpenseCache = async (userId) => {
    try {
        const setKey = userKeySetName(userId);
        const keys = await redisClient.sMembers(setKey);

        if (keys.length > 0) {
            await redisClient.del(keys);
        }

        await redisClient.del(setKey);

        console.log(`Cache cleared for user: ${userId}`);
    } catch (err) {
        console.error(`Cache clear failed for user ${userId}:`, err.message);
    }
};

module.exports = { setCache, getCache, clearUserExpenseCache };