// Resolve the date range for an insights period, or null if unsupported.
const resolvePeriod = (period) => {
    const now = new Date();

    switch (period) {
        case 'current_month': {
            const startDate = new Date(
                now.getFullYear(),
                now.getMonth(),
                1
            );

            const endDate = new Date(
                now.getFullYear(),
                now.getMonth() + 1,
                1
            );

            return { startDate, endDate };
        }

        case 'financial_year': {
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth();

            // Indian financial year runs April to March.
            const fyStartYear =
                currentMonth >= 3
                    ? currentYear
                    : currentYear - 1;

            const startDate = new Date(fyStartYear, 3, 1);
            const endDate = new Date(fyStartYear + 1, 3, 1);

            return { startDate, endDate };
        }

        default:
            return null;
    }
};

module.exports = { resolvePeriod };
