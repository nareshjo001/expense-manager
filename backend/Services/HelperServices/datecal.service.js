// Utility function to calculate the start and end of a month
const getMonthRange = (date = new Date()) => {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return { monthStart, monthEnd };
};

// Utility function to calculate date ranges 
const getLastWeekQueryDates = () => {
    // Current date reference
    const now = new Date();

    // Calculate date ranges
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(now.getDate() - 7);

    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(now.getDate() - 14);

    const fourtyTwoDaysAgo = new Date();
    fourtyTwoDaysAgo.setDate(now.getDate() - 42);

    return {
        now,
        sevenDaysAgo,
        fourteenDaysAgo,
        fourtyTwoDaysAgo
    }
}

// Utility to calculate date range based on year query for pie charts
const getPieDateRange = (year = '') => {
    let startDate;
    let endDate;

    if (year) {
        const numericYear = Number(year);

        // Start: Jan 1
        startDate = new Date(numericYear, 0, 1);

        // End: Dec 31 23:59:59.999
        endDate = new Date(numericYear + 1, 0, 0, 23, 59, 59, 999);
    } else {
        const now = new Date();

        // Start of current month
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);

        // End of current month
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    return { startDate, endDate };
};

module.exports = { getMonthRange, getLastWeekQueryDates, getPieDateRange };