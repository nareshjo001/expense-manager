const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 150,

    keyGenerator: (req) => {
        return req.userId || ipKeyGenerator(req.ip);
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