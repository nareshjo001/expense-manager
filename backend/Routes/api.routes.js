// Create Express router
const router = require('express').Router();

// ---------------- VALIDATION MIDDLEWARES ----------------
// Used to validate request data before controller runs
const {
  signupValidation,
  loginValidation,
  expenseValidation
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

const { 
    getbudgets, 
    setbudget,
    updatebudget,
} = require('../Controllers/BudgetControllers');

// ---------------- AUTH MIDDLEWARE ----------------
// Verifies JWT token before allowing access
const verifyToken = require('../Middlewares/Auth');


// PUSH NOTIFICATIONS & EXPENSE RECURRING
const { deviceRegistration } = require('../Controllers/PushNotifications/deviceRegistration');
const {
    recurring,
} = require('../Controllers/RecurringExpenses');

// INCOME 
const {
    addIncome,
    getIncome,
    editIncome,
    deleteIncome,
    getInsightsHeader,
    getInsightsCard
} = require('../Controllers/IncomeControllers');

// ================= AUTH ROUTES =================

router.post('/login', loginValidation, login);      // User login with validation
router.post('/signup', signupValidation, signup);   // User signup with validation
router.post('/verify-otp', verifyOTP);              // OTP verification
router.post('/resend-otp', resendOTP);              // Resend OTP
router.post('/forgot-password', forgotPassword);    // Forgot password request
router.post('/reset-password', resetPassword);      // Reset password

// ================= PROTECTED ROUTES =================
// Get budgets
router.get('/getbudgets', verifyToken, getbudgets);

// Set budget
router.post('/setbudget', verifyToken, setbudget);

// Update budget
router.put('/update-budget', verifyToken, updatebudget);

// ================= PROTECTED ANALYTICS ROUTES =================

// Device registration for push notifications
router.post('/device-token', verifyToken, deviceRegistration);

// Mark expense recurring
router.patch('/recurring', verifyToken, recurring);

// Income routes
router.post('/add-income', verifyToken, addIncome);
router.get('/get-income', verifyToken, getIncome);
router.put('/edit-income', verifyToken, editIncome);
router.delete('/delete-income', verifyToken, deleteIncome);
router.post('/income-insights-header', verifyToken, getInsightsHeader);
router.post('/income-insights-card', verifyToken, getInsightsCard);

module.exports = router;