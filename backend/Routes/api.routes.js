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

// ---------------- EXPENSE FETCH CONTROLLERS ----------------
// Used to get expense data
const {
    lastWeekExpense,
    getByCustom, 
    getByCategory
} = require('../Controllers/GetExpenseControllers');

// ---------------- EXPENSE CRUD CONTROLLERS ----------------
// Used to add, edit, delete expenses and manage budgets
const { 
    addExpense,
    deleteExpense, 
    geteditexpense, 
    editexpense, 
} = require('../Controllers/ExpenseControllers');

const { 
    getbudgets, 
    setbudget,
    updatebudget,
} = require('../Controllers/BudgetControllers');

// ---------------- AUTH MIDDLEWARE ----------------
// Verifies JWT token before allowing access
const verifyToken = require('../Middlewares/Auth');

// ---------------- LINE CHART CONTROLLERS ----------------
// Used for line chart analytics
const {
    getloggedyears,
    linechartbyweek,
    linechartbymonth, 
    linechartbyyear, 
    linechartbetweenyears,
} = require('../Controllers/LineChartControllers');

// ---------------- BAR CHART CONTROLLERS ----------------
// Used for bar chart analytics
const { 
    barchartbycategory, 
    barchartbymonth 
} = require('../Controllers/BarChartControllers');

// ---------------- PIE CHART CONTROLLERS ----------------
// Used for pie chart analytics
const { 
    getPieCategoryData,
    getcomparisonforpie 
} = require('../Controllers/PieChartControllers');

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

// ================= PROTECTED EXPENSE ROUTES =================

// Add new expense (validated)
router.post('/expenses', verifyToken, expenseValidation, addExpense);

// Get last week's expenses
router.get('/getlastweek', verifyToken, lastWeekExpense);

// Get expenses by category
router.get('/getbycategory', verifyToken, getByCategory);

// Get expenses using custom filters
router.get('/getbycustom', verifyToken, getByCustom);

// Delete an expense
router.delete('/delete', verifyToken, deleteExpense);

// Get budgets
router.get('/getbudgets', verifyToken, getbudgets);

// Set budget
router.post('/setbudget', verifyToken, setbudget);

// Update budget
router.put('/update-budget', verifyToken, updatebudget);

// Get expense data for editing
router.get('/geteditexpense', verifyToken, geteditexpense);

// Edit an expense
router.put('/editexpense', verifyToken, editexpense);

// ================= PROTECTED ANALYTICS ROUTES =================

// LINE CHART
// Get years where user has expense data
router.get('/getloggedyears', verifyToken, getloggedyears);

// Line chart data by week (protected)
router.get('/linechartbyweek', verifyToken, linechartbyweek);

// Line chart data by month
router.get('/linechartbymonth', verifyToken, linechartbymonth);

// Line chart data by year
router.get('/linechartbyyear', verifyToken, linechartbyyear);

// Line chart data between years
router.get('/linechartbetweenyears', verifyToken, linechartbetweenyears);

// BAR CHART
// Bar chart by category
router.get('/barchartbycategory', verifyToken, barchartbycategory);

// Bar chart by month
router.get('/barchartbymonth', verifyToken, barchartbymonth);

// PIE CHART
// Pie chart by category or count data
router.get('/getPieCategoryData', verifyToken, getPieCategoryData);

// Pie chart budget comparison data
router.get('/getcomparisonforpie', verifyToken, getcomparisonforpie);

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