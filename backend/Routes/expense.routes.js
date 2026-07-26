const router = require('express').Router();

const verifyToken = require('../Middlewares/Auth');

const {
    lastWeekExpense,
    getByCustom, 
    getByCategory
} = require('../Controllers/GetExpenseControllers');

// Get last week's expenses
router.get('/last-week', verifyToken, lastWeekExpense);

// Get expenses by category
router.get('/by-category', verifyToken, getByCategory);

// Get expenses using custom filters
router.get('/search', verifyToken, getByCustom);

module.exports = router;