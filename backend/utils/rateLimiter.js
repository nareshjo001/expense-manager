const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const {
    fingerprint,
    hashResetToken,
    normalizeEmail,
} = require("../Services/AuthServices/security.service");

const AUTH_RATE_LIMIT_MESSAGE = Object.freeze({
    success: false,
    code: "AUTH_RATE_LIMITED",
    message: "Too many attempts. Please try again later."
});

const identityKey = (req) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return ipKeyGenerator(req.ip);
    return `identity:${fingerprint(email) || hashResetToken(email)}`;
};

const createIdentityLimiter = (max) => rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    keyGenerator: identityKey,
    message: AUTH_RATE_LIMIT_MESSAGE,
    standardHeaders: true,
    legacyHeaders: false
});

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
    windowMs: 15 * 60 * 1000,
    max: 60,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: AUTH_RATE_LIMIT_MESSAGE,
    standardHeaders: true,
    legacyHeaders: false
});

const loginLimiter = createIdentityLimiter(10);
const otpIssueLimiter = createIdentityLimiter(5);
const otpVerifyLimiter = createIdentityLimiter(8);
const passwordResetLimiter = createIdentityLimiter(5);
const receiptLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 12,
    keyGenerator: (req) => req.userId || ipKeyGenerator(req.ip),
    message: {
        success: false,
        code: "RECEIPT_RATE_LIMITED",
        message: "Too many receipt uploads. Please try again later."
    },
    standardHeaders: true,
    legacyHeaders: false
});


// SIA limiter (M3-1) -- a dedicated, stricter limiter for POST /sia/ask,
const siaLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,

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

// SIA voice limiter (Workstream 2) -- a DEDICATED, SEPARATE limiter
const siaVoiceLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,

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

module.exports = {
    apiLimiter,
    authLimiter,
    loginLimiter,
    otpIssueLimiter,
    otpVerifyLimiter,
    passwordResetLimiter,
    receiptLimiter,
    siaLimiter,
    siaVoiceLimiter
};
