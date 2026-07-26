const { redisClient } = require('../config/redis');

const DEFAULT_TTL_SECONDS = 300;

// Cache keys follow "<feature>:<userId>[:<variant>]".
const getUserIdFromKey = (key) => key.split(':')[1];
const userKeySetName = (userId) => `cachekeys:${userId}`;

// Set Cache
const setCache = async (key, data, ttl = DEFAULT_TTL_SECONDS) => {
    try {
        // Write the value and track its key in one transaction.
        const multi = redisClient.multi().set(key, JSON.stringify(data), { EX: ttl });

        const userId = getUserIdFromKey(key);
        if (userId) {
            const setKey = userKeySetName(userId);
            multi.sAdd(setKey, key).expire(setKey, ttl);
        }

        await multi.exec();

        console.log(`Cache set: ${key}`);
    } catch (err) {
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