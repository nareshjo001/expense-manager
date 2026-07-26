const router = require('express').Router();

const verifyToken = require('../Middlewares/Auth');
const { expenseValidation } = require('../Middlewares/AuthValidation');

const {
    lastWeekExpense,
    getByCustom, 
    getByCategory
} = require('../Controllers/GetExpenseControllers');

const { 
    addExpense,
    deleteExpense, 
    geteditexpense, 
    editexpense, 
} = require('../Controllers/ExpenseControllers');

// Get last week's expenses
router.get('/last-week', verifyToken, lastWeekExpense);

// Get expenses by category
router.get('/by-category', verifyToken, getByCategory);

// Get expenses using custom filters
router.get('/search', verifyToken, getByCustom);

// Add new expense
router.post('/add-expense', verifyToken, expenseValidation, addExpense);

// Delete an expense
router.delete('/delete-expense', verifyToken, deleteExpense);

// Get expense data for editing
router.get('/expense-edit-data', verifyToken, geteditexpense);

// Edit an expense
router.put('/update-expense', verifyToken, editexpense);


module.exports = router;