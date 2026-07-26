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

module.exports = router;
