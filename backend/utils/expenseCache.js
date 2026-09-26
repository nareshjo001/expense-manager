const { redisClient } = require('../config/redis');
const { logEvent } = require('./logger');

const DEFAULT_TTL_SECONDS = 300;

// Cache keys follow "<feature>:<userId>[:<variant>]".
const getUserIdFromKey = (key) => key.split(':')[1];
// Logged instead of the key itself: the key embeds the user's id.
const featureOf = (key) => String(key).split(':')[0];
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

        logEvent({ level: 'info', scope: 'cache', event: 'cache_set', feature: featureOf(key) });
    } catch (err) {
        logEvent({ level: 'error', scope: 'cache', event: 'cache_set_failed', feature: featureOf(key), errorName: err && err.name });
    }
};

// Get Cache
const getCache = async (key) => {
    try {
        const raw = await redisClient.get(key);

        if (!raw) return null;

        logEvent({ level: 'info', scope: 'cache', event: 'cache_hit', feature: featureOf(key) });
        return JSON.parse(raw);
    } catch (err) {
        logEvent({ level: 'error', scope: 'cache', event: 'cache_get_failed', feature: featureOf(key), errorName: err && err.name });
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

        logEvent({ level: 'info', scope: 'cache', event: 'cache_cleared' });
    } catch (err) {
        logEvent({ level: 'error', scope: 'cache', event: 'cache_clear_failed', errorName: err && err.name });
    }
};

module.exports = { setCache, getCache, clearUserExpenseCache };