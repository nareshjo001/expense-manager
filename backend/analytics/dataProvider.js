// Raw (unannotated) fetch -- analyticsContext.js batches all four of these
// collections through ONE combined annotateRecurringState call instead of
// one per collection (the four ranges below overlap in expense _ids near
// month/year boundaries, so per-collection annotation would re-query the
// same definitions redundantly).
const { fetchExpenseRaw } = require('../Controllers/GetExpenseControllers/fetchExpenses');
const { fetchBudgets } = require('../Controllers/BudgetControllers/fetchBudgets');

const resolveNow = (asOfDate) => {
  const date = asOfDate instanceof Date ? new Date(asOfDate.getTime()) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const getCurrentMonthExpenses = async (userId, asOfDate) => {
  const today = resolveNow(asOfDate);
  const startDate = new Date(today.getFullYear(), today.getMonth(), 1);
  const endDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  endDate.setMilliseconds(endDate.getMilliseconds() - 1);

  return await fetchExpenseRaw(startDate, endDate, userId);
};

const getPreviousMonthExpenses = async (userId, asOfDate) => {
    const today = resolveNow(asOfDate);
    const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endDate = new Date(today.getFullYear(), today.getMonth(), 1);
    endDate.setMilliseconds(endDate.getMilliseconds() - 1);

    return await fetchExpenseRaw(startDate, endDate, userId);
};

const getCurrentYearExpenses = async (userId, asOfDate) => {
  const today = resolveNow(asOfDate);
  const startDate = new Date(today.getFullYear(), 0, 1);
  const endDate = new Date(today.getFullYear() + 1, 0, 1);
  endDate.setMilliseconds(endDate.getMilliseconds() - 1);

  return await fetchExpenseRaw(startDate, endDate, userId);
}

const getPreviousYearExpenses = async (userId, asOfDate) => {
    const year = resolveNow(asOfDate).getFullYear() - 1;
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year + 1, 0, 1);
    endDate.setMilliseconds(endDate.getMilliseconds() - 1);

    return await fetchExpenseRaw(startDate, endDate, userId);
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
