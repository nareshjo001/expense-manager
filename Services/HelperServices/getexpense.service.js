// To group expenses by category
const groupByCategoryHelper = (expenses) => {
    return expenses.reduce((groups, exp) => {
            const cat = exp.expenseCategory || 'Others';
            if(!groups[cat]) groups[cat] = [];
            groups[cat].push(exp);
            return groups;
        }, {});
}

// Sort expense from newest to oldest (-1)
const sortDescending = (expenses) => {
    return expenses.sort((a, b) =>
        b.expenseDate - a.expenseDate
    );
};

// Sort expense from oldest to newest (1)
const sortAscending = (expenses) => {
    return expenses.sort((a, b) =>
        a.expenseDate - b.expenseDate
    );
};

// Group expenses by week
const bucketByWeek = (expenses = [], options = {}) => {
    if (!Array.isArray(expenses)) return [];
    
    const { labelType = 'date' } = options;
    
    const weeks = {};

    expenses.forEach(exp => {
        const date = new Date(exp.expenseDate);

        // Calculate Monday as week start
        const weekStart = new Date(date);
        const day = weekStart.getDay();
        const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
        weekStart.setDate(diff);
        weekStart.setHours(0,0,0,0);

        const key = weekStart.toISOString().slice(0,10);
        weeks[key] = (weeks[key] || 0) + Number(exp.expenseAmount || 0);
    });

    const sortedWeeks = Object.entries(weeks)
        .map(([week, total]) => ({ week, total }))
        .sort((a, b) => new Date(a.week) - new Date(b.week));

    // If labelType = weekNumber → convert labels
    if (labelType === 'weekNumber') {
        return sortedWeeks.map((item, index) => ({
            week: `Week ${index + 1}`,
            total: item.total
        }));
    }
    
    return sortedWeeks;
};

// Group expenses by month
const groupByMonth = (allExpenses = []) => {
    const now = new Date();
    let history = [];

    for (let i = 1; i <= 3; i++) {

        const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);

        const monthExpenses = allExpenses.filter(e =>
            e.expenseDate >= monthStart &&
            e.expenseDate <= monthEnd
        );

        history.push({
            month: `${monthStart.getFullYear()}-${monthStart.getMonth() + 1}`,
            categories: groupByCategoryHelper(monthExpenses),
        });
    }

    return history;
}

module.exports = {
    groupByMonth,
    groupByCategoryHelper,
    sortDescending,
    sortAscending,
    bucketByWeek
}