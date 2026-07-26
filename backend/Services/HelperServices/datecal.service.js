// Resolve the start and end of a month.
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

module.exports = { getMonthRange, getLastWeekQueryDates };