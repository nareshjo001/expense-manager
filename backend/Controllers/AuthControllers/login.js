const { UserModel } = require('../../config/Schemas');
const { logEvent } = require('../../utils/logger');
const passwordService = require('../../Services/AuthServices/password.service');
const { createLoginSession } = require('./session');
const {
    INVALID_CREDENTIALS_RESPONSE,
    emitAuthAuditEvent,
    normalizeEmail,
} = require('../../Services/AuthServices/security.service');

const login = async (req, res) => {
    try {
        const { email: rawEmail, password } = req.body;
        // DAT-002-T02 -- normalize before the query, not just for the audit
        // hash. UserModel.email is now stored lowercase+trimmed (schema
        // setter, config/Schemas.js); querying with the same normalization
        // is what makes a case-varying login actually match that record.
        const email = normalizeEmail(rawEmail);
        const user = await UserModel.findOne({ email });
        const comparePasswordSafely = passwordService.comparePasswordOrDummy || passwordService.comparePassword;
        const isMatch = await comparePasswordSafely(password, user?.password);

        if (!user || !isMatch || !user.isVerified) {
            emitAuthAuditEvent({
                event: 'login',
                outcome: 'denied',
                reason: !user ? 'unknown_identity' : !isMatch ? 'invalid_secret' : 'unverified_account',
                req,
                email,
            });
            return res.status(401).json(INVALID_CREDENTIALS_RESPONSE);
        }

        const token = await createLoginSession(user, req, res);
        emitAuthAuditEvent({ event: 'login', outcome: 'success', req, email });
        res.status(200).json({ message: 'Login Successful', success: true, token, email: user.email, firstname: user.fullName });
    } catch (err) {
        logEvent({ level: 'error', scope: 'auth', event: 'login_failed', requestId: req.requestId, errorName: err && err.name });
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
};

module.exports = { login };
