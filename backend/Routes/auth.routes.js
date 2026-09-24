// Create Express router
const router = require('express').Router();

// ---------------- VALIDATION MIDDLEWARES ----------------
// Used to validate request data before controller runs
const {
  signupValidation,
  loginValidation,
  emailOnlyValidation,
  verifyOtpValidation,
  resetPasswordValidation,
  requestDeletionValidation,
} = require('../Middlewares/AuthValidation');

// ---------------- AUTH CONTROLLERS ----------------
// Handle authentication-related logic
const {
  signup,
  login,
  verifyOTP,
  resendOTP,
  forgotPassword,
  resetPassword,
  refresh,
  logout,
  logoutAll,
  requestDeletion,
  cancelDeletion,
  getDeletionStatus,
} = require('../Controllers/AuthControllers');
const verifyToken = require('../Middlewares/Auth');
const sessionCsrf = require('../Middlewares/sessionCsrf');

const rateLimiters = require('../utils/rateLimiter');
const authLimiter = rateLimiters.authLimiter;
const loginLimiter = rateLimiters.loginLimiter || authLimiter;
const otpIssueLimiter = rateLimiters.otpIssueLimiter || authLimiter;
const otpVerifyLimiter = rateLimiters.otpVerifyLimiter || authLimiter;
const passwordResetLimiter = rateLimiters.passwordResetLimiter || authLimiter;

router.post('/login', authLimiter, loginValidation, loginLimiter, login);
router.post('/signup', authLimiter, signupValidation, otpIssueLimiter, signup);
router.post('/verify-otp', authLimiter, verifyOtpValidation, otpVerifyLimiter, verifyOTP);
router.post('/resend-otp', authLimiter, emailOnlyValidation, otpIssueLimiter, resendOTP);
router.post('/forgot-password', authLimiter, emailOnlyValidation, otpIssueLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPasswordValidation, passwordResetLimiter, resetPassword);
router.post('/refresh', authLimiter, sessionCsrf, refresh);
router.post('/logout', authLimiter, sessionCsrf, logout);
router.post('/logout-all', verifyToken, authLimiter, logoutAll);

// PRV-001-T03 (ADR-0007) -- re-authenticated deletion request/cancel/status.
// passwordResetLimiter reused deliberately: both endpoints gate a
// password-compare against a stored hash, the same brute-force surface
// that limiter already exists to bound.
router.post('/request-deletion', verifyToken, authLimiter, requestDeletionValidation, passwordResetLimiter, requestDeletion);
router.post('/cancel-deletion', verifyToken, authLimiter, cancelDeletion);
router.get('/deletion-status', verifyToken, authLimiter, getDeletionStatus);

module.exports = router;
