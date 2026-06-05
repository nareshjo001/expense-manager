const { parseISO, getYear, getMonth } = require('date-fns');

// Group expenses by year
const groupByYear = (expenses = []) => {
    const yearlyExpenses = {};

    expenses.forEach((expense) => {
        const date = parseISO(expense.expenseDate.toISOString());
        const year = getYear(date);

        if(!yearlyExpenses[year]) yearlyExpenses[year] = [];
        yearlyExpenses[year].push(expense);
    });

    const result = Object.entries(yearlyExpenses).map(([year, yearExpenses]) => {
        const total = yearExpenses.reduce((sum, exp) => sum + Number(exp.expenseAmount), 0);
        return { year: Number(year), total };
    });

    return result;
}

// Group and total expenses by month Jan - Dec
const monthlyTotals = (expenses = []) => {
    const monthlyTotals = Array(12).fill(0);

    expenses.forEach((expense) => {
        const monthIndex = getMonth(expense.expenseDate);
        monthlyTotals[monthIndex] += Number(expense.expenseAmount);
    });

    const monthNames = [
        `Jan`, `Feb`, `Mar`, `Apr`,
        `May`, `Jun`, `Jul`, `Aug`,
        `Sep`, `Oct`, `Nov`, `Dec`
    ];

    const result = monthNames.map((month, index) => ({
        month,
        total: monthlyTotals[index],
    })).filter(item => item.total > 0);

    return result;
}

// To calculate category wise totals
const categoryTotals = (groupedByCategory) => {
    const result = Object.entries(groupedByCategory).map(([category, categoryExpenses]) => {
        const total = categoryExpenses.reduce(
            (sum, exp) => sum + Number(exp.expenseAmount),
            0
        );
            return { category, total };
    });

    return result;
}

// To calculate category wise transaction counts
const categoryCounts = (groupedByCategory) => {
    const result = Object.entries(groupedByCategory).map(([category, categoryExpenses]) => {
            const total = categoryExpenses.reduce(
                (sum, exp) => sum + Number(1),
                0
            );
            return { category, total };
    });

    return result;
}

module.exports = {
    groupByYear,
    monthlyTotals,
    categoryTotals,
    categoryCounts
}