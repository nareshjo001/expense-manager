const rateLimit = require('express-rate-limit');

// API limiter (user-based)
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 150,

    keyGenerator: (req) => {
        return req.userId || req.ip;
    },

    message: {
        success: false,
        message: "Too many requests. Please try again later."
    },

    standardHeaders: true,
    legacyHeaders: false
});

// Auth limiter (IP-based) for credential and OTP endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 20,

    message: {
        success: false,
        message: "Too many attempts. Please try again later."
    },

    standardHeaders: true,
    legacyHeaders: false
});

module.exports = { apiLimiter, authLimiter };