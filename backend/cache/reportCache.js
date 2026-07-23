const { redisClient } = require("../config/redis");

const TTL = 3600; // 1 hour

const getCacheKey = (userId) => `report:${userId}`;

async function get(userId) {
    const data = await redisClient.get(getCacheKey(userId));

    if (!data) return null;

    return JSON.parse(data);
}

async function set(userId, report) {
    await redisClient.set(
        getCacheKey(userId),
        JSON.stringify(report),
        {
            EX: TTL,
        }
    );
}

async function invalidate(userId) {
    await redisClient.del(getCacheKey(userId));
}

module.exports = {
    get,
    set,
    invalidate,
};