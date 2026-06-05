// In-memory cache using Maps
const cache = new Map();

const MAX_CACHE_SIZE = 100; // limit total entries

// Set Cache
const setCache = (key, data, ttl = 300000) => {
    // Remove oldest entry if cache is full
    if (cache.size >= MAX_CACHE_SIZE) {
        const oldestKey = cache.keys().next().value; // Gets the first inserted key in the Map
        cache.delete(oldestKey);
    }

    cache.set(key, {
        data,
        expiry: Date.now() + ttl
    });
    console.log(`Cache set: ${key}`);
};

// Get Cache
const getCache = (key) => {
    const entry = cache.get(key);

    if (!entry) return null;

    // Remove expired entry
    if (Date.now() > entry.expiry) {
        cache.delete(key);
        return null;
    }

    console.log(`Cache hit: ${key}`);
    return entry.data;
};

// Clear all cache for a user
const clearUserExpenseCache = (userId) => {
    for (const key of cache.keys()) {
        if (key.includes(`:${userId}`)) {
            cache.delete(key);
        }
    }

    console.log(`Cache cleared for user: ${userId}`);
};

// Auto cleanup expired entries every 1 min
setInterval(() => {
    const now = Date.now();

    for (const [key, value] of cache.entries()) {
        if (value.expiry < now) {
            cache.delete(key);
        }
    }

    if (process.env.NODE_ENV === 'development') {
        console.log('Expired cache cleaned');
    }
}, 60000);

module.exports = { setCache, getCache, clearUserExpenseCache };