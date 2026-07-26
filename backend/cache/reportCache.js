const { redisClient } = require("../config/redis");

const TTL = 3600; // 1 hour

const getCacheKey = (userId) => `report:${userId}`;

async function get(userId) {
    try {
        const data = await redisClient.get(getCacheKey(userId));

        if (!data) return null;

        return JSON.parse(data);
    } catch (err) {
        console.error(`Report cache get failed for user ${userId}:`, err.message);
        return null;
    }
}

async function set(userId, report) {
    try {
        await redisClient.set(
            getCacheKey(userId),
            JSON.stringify(report),
            {
                EX: TTL,
            }
        );
    } catch (err) {
        console.error(`Report cache set failed for user ${userId}:`, err.message);
    }
}

async function invalidate(userId) {
    try {
        await redisClient.del(getCacheKey(userId));
    } catch (err) {
        console.error(`Report cache invalidate failed for user ${userId}:`, err.message);
    }
}

module.exports = {
    get,
    set,
    invalidate,
};