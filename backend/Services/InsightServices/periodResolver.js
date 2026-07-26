// Resolves the {startDate, endDate} range for the periods supported by the
// Income insights endpoints (getInsightsHeader, getInsightsCard). Extracted
// from the identical switch statement that previously existed, verbatim, in
// both controllers, so the date math has one source of truth.
//
// Supported periods:
//   'current_month'  -> 1st of the current month through 1st of next month
//   'financial_year' -> Indian FY: Apr 1 -> Mar 31 (exclusive upper bound
//                        Apr 1 of the following year)
//
// Returns null for any unrecognized (or missing) period, so callers branch
// to their own existing 400 "Invalid period" response exactly as before —
// this function makes no assumption about how that should be reported.
const resolvePeriod = (period) => {
    const now = new Date();

    switch (period) {
        case 'current_month': {
            const startDate = new Date(
                now.getFullYear(),
                now.getMonth(),
                1
            );

            // First day of next month
            const endDate = new Date(
                now.getFullYear(),
                now.getMonth() + 1,
                1
            );

            return { startDate, endDate };
        }

        case 'financial_year': {
            const currentYear = now.getFullYear();
            const currentMonth = now.getMonth(); // 0-11

            // Indian FY: Apr 1 -> Mar 31
            const fyStartYear =
                currentMonth >= 3
                    ? currentYear
                    : currentYear - 1;

            const startDate = new Date(fyStartYear, 3, 1); // Apr 1
            const endDate = new Date(fyStartYear + 1, 3, 1); // Apr 1 next year

            return { startDate, endDate };
        }

        default:
            return null;
    }
};

module.exports = { resolvePeriod };
