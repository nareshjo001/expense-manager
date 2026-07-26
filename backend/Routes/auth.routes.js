// Create Express router
const router = require('express').Router();

// ---------------- VALIDATION MIDDLEWARES ----------------
// Used to validate request data before controller runs
const {
  signupValidation,
  loginValidation,
} = require('../Middlewares/AuthValidation');

// ---------------- AUTH CONTROLLERS ----------------
// Handle authentication-related logic
const {
  signup,
  login,
  verifyOTP,
  resendOTP,
  forgotPassword,
  resetPassword
} = require('../Controllers/AuthControllers');

const { authLimiter } = require('../utils/rateLimiter');

router.post('/login', authLimiter, loginValidation, login);      // User login with validation
router.post('/signup', authLimiter, signupValidation, signup);   // User signup with validation
router.post('/verify-otp', authLimiter, verifyOTP);              // OTP verification
router.post('/resend-otp', authLimiter, resendOTP);              // Resend OTP
router.post('/forgot-password', authLimiter, forgotPassword);    // Forgot password request
router.post('/reset-password', authLimiter, resetPassword);      // Reset password

module.exports = router;
