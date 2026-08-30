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


// SIA limiter (M3-1) -- a dedicated, stricter limiter for POST /sia/ask,
// separate from apiLimiter's shared 150/15min budget so heavier LLM-backed
// usage on this one endpoint cannot starve every other authenticated
// route's quota. Must be applied AFTER verifyToken (see
// Routes/sia.routes.js) so req.userId is always already set -- the
// ipKeyGenerator fallback below is defensive only and is not expected to be
// reached in practice, mirroring apiLimiter's own keying convention. Never
// keys on the question, financial context, API key, or raw JWT.
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
// instance for POST /sia/transcriptions, independent of siaLimiter above.
// A separate rateLimit() call means a separate internal store/bucket: a
// caller who exhausts this budget can still use /sia/ask (and vice versa),
// so heavy voice-upload usage can never starve the text pipeline's quota
// or trigger its 429, and neither route's usage counts against the
// other's. Applied AFTER verifyToken (see Routes/sia.routes.js), same
// convention as siaLimiter -- ipKeyGenerator is a defensive fallback only.
// Never keys on the audio bytes, transcript, question, or API key.
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

module.exports = { apiLimiter, authLimiter, siaLimiter, siaVoiceLimiter };