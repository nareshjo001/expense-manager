const { ExpenseModel } = require('../../config/Schemas');

const fetchExpense = async (startDate, endDate, userId) => {
    return await ExpenseModel.find({
        userId,
        expenseDate: {
            $gte: startDate,
            $lte: endDate
        }
    }).lean();
};


module.exports = { fetchExpense }