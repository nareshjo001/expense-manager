const router = require('express').Router();

// ---------------- BUDGET CONTROLLERS ----------------
const {
    getbudgets,
    setbudget,
    updatebudget,
} = require('../Controllers/BudgetControllers');

// ---------------- AUTH MIDDLEWARE ----------------
// Verifies JWT token before allowing access
const verifyToken = require('../Middlewares/Auth');

// ---------------- PUSH NOTIFICATIONS & EXPENSE RECURRING ----------------
const { deviceRegistration } = require('../Controllers/PushNotifications/deviceRegistration');
const {
    recurring,
    getUpcoming,
} = require('../Controllers/RecurringExpenses');

// ================= BUDGET ROUTES =================

// Get budgets
router.get('/getbudgets', verifyToken, getbudgets);

// Set budget
router.post('/setbudget', verifyToken, setbudget);

// Update budget
router.put('/update-budget', verifyToken, updatebudget);

// ================= DEVICE / RECURRING ROUTES =================

// Device registration for push notifications
router.post('/device-token', verifyToken, deviceRegistration);

// Mark expense recurring
router.patch('/recurring', verifyToken, recurring);

// REC-003-T02 -- projected upcoming occurrences, bounded by an explicit
// date window (see Controllers/RecurringExpenses/upcoming.js for why the
// window is capped rather than optional).
router.get('/recurring/upcoming', verifyToken, getUpcoming);

module.exports = router;
