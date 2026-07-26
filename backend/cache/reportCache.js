const { redisClient } = require("../config/redis");

const TTL = 3600; // 1 hour

const getCacheKey = (userId) => `report:${userId}`;

async function get(userId) {
    try {
        const data = await redisClient.get(getCacheKey(userId));

        if (!data) return null;

        return JSON.parse(data);
    } catch (err) {
        // A Redis failure here should look like a cache miss to the caller
        // (reportService.getReport already falls back to Mongo on null),
        // not fail the request.
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
        // Caching is best-effort. The caller (getReport/refreshReport) may have
        // already committed a successful DB write/read before reaching this
        // call — a Redis outage here must not turn that success into a 500.
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