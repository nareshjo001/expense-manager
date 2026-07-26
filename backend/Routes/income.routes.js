const router = require('express').Router();

const verifyToken = require('../Middlewares/Auth');

const {
  addIncomeValidation,
  editIncomeValidation
} = require('../Middlewares/AuthValidation');

const {
    addIncome,
    getIncome,
    editIncome,
    deleteIncome,
    getInsightsHeader,
    getInsightsCard
} = require('../Controllers/IncomeControllers');


// Add a new income record
router.post('/add', verifyToken, addIncomeValidation, addIncome);

// Get all income records
router.get('/get', verifyToken, getIncome);

// Update an existing income record
router.put('/edit', verifyToken, editIncomeValidation, editIncome);

// Delete an income record
router.delete('/delete', verifyToken, deleteIncome);

// Get income insights header data
router.post('/insights-header', verifyToken, getInsightsHeader);

// Get income insights card data
router.post('/insights-card', verifyToken, getInsightsCard);


module.exports = router;