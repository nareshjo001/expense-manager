// Single source of truth for calendar month names/order used across chart
// controllers and services. Previously duplicated as separate local arrays
// in chart.service.js, linechartbetweenyears.js, and barchartbymonth.js.

const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr',
    'May', 'Jun', 'Jul', 'Aug',
    'Sep', 'Oct', 'Nov', 'Dec'
];

// Same array/order as MONTH_NAMES, exported under the name some call sites
// already used locally (e.g. barchartbymonth.js's sort comparator). Kept as
// a second export name — not a second array — so each call site can import
// under its existing local variable name with zero behavior change.
const MONTH_ORDER = MONTH_NAMES;

module.exports = { MONTH_NAMES, MONTH_ORDER };
