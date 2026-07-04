const { fetchExpense } = require('../Controllers/GetExpenseControllers/fetchExpenses');
const { fetchBudgets } = require('../Controllers/BudgetControllers/fetchBudgets');

const getCurrentMonthExpenses = async (userId) => {
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return await fetchExpense(startDate, endDate, userId);
};

const getPreviousMonthExpenses = async (userId) => {
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endDate = new Date(today.getFullYear(), today.getMonth(), 0);

    return await fetchExpense(startDate, endDate, userId);
};

const getCurrentYearExpenses = async (userId) => {
  const today = new Date();
  const startDate = new Date(today.getFullYear(), 0, 1);
  const endDate = new Date(today.getFullYear(), 11, 31);

  return await fetchExpense(startDate, endDate, userId);
}

const getPreviousYearExpenses = async (userId) => {
    const year = new Date().getFullYear() - 1;
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year, 11, 31);

    return await fetchExpense(startDate, endDate, userId);
};


const getAllBudgets = async (userId) => {
  const budgets = await fetchBudgets(userId);

  return budgets;
};

module.exports = { 
  getCurrentMonthExpenses, 
  getPreviousMonthExpenses, 
  getCurrentYearExpenses, 
  getPreviousYearExpenses, 
  getAllBudgets 
};