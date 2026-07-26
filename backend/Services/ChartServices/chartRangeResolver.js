// Date range resolution for chart queries, in server local time.

// Resolve start and end of a calendar month.
const resolveMonthRange = (year, month) => {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);
    return { startDate, endDate };
};

// Resolve start and end of a calendar year.
const resolveYearRange = (year) => {
    const startDate = new Date(year, 0, 1);
    const endDate = new Date(year + 1, 0, 0, 23, 59, 59, 999);
    return { startDate, endDate };
};

// Resolve start and end of the current month.
const resolveCurrentMonthRange = () => {
    const now = new Date();
    return resolveMonthRange(now.getFullYear(), now.getMonth() + 1);
};

// Resolve start and end of the current year.
const resolveCurrentYearRange = () => {
    const now = new Date();
    return resolveYearRange(now.getFullYear());
};

// Resolve a range spanning the earliest to latest given year.
const resolveMultiYearRange = (years) => {
    const startDate = new Date(Math.min(...years), 0, 1);
    const endDate = new Date(Math.max(...years), 11, 31, 23, 59, 59, 999);
    return { startDate, endDate };
};

// Resolve an unbounded range covering all history.
const resolveAllTime = () => null;

module.exports = {
    resolveMonthRange,
    resolveYearRange,
    resolveCurrentMonthRange,
    resolveCurrentYearRange,
    resolveMultiYearRange,
    resolveAllTime
};
