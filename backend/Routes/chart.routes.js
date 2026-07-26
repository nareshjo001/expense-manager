const router = require('express').Router();

const verifyToken = require('../Middlewares/Auth');

// Used for line chart analytics
const {
    getloggedyears,
    linechartbyweek,
    linechartbymonth, 
    linechartbyyear, 
    linechartbetweenyears,
} = require('../Controllers/LineChartControllers');


// Used for bar chart analytics
const { 
    barchartbycategory, 
    barchartbymonth 
} = require('../Controllers/BarChartControllers');


// Used for pie chart analytics
const { 
    getPieCategoryData,
    getcomparisonforpie 
} = require('../Controllers/PieChartControllers');


// LINE CHART
// Get years where user has expense data
router.get('/getloggedyears', verifyToken, getloggedyears);

// Line chart data by week (protected)
router.get('/linechartbyweek', verifyToken, linechartbyweek);

// Line chart data by month
router.get('/linechartbymonth', verifyToken, linechartbymonth);

// Line chart data by year
router.get('/linechartbyyear', verifyToken, linechartbyyear);

// Line chart data between years
router.get('/linechartbetweenyears', verifyToken, linechartbetweenyears);


// BAR CHART
// Bar chart by category
router.get('/barchartbycategory', verifyToken, barchartbycategory);

// Bar chart by month
router.get('/barchartbymonth', verifyToken, barchartbymonth);


// PIE CHART
// Pie chart by category or count data
router.get('/getPieCategoryData', verifyToken, getPieCategoryData);

// Pie chart budget comparison data
router.get('/getcomparisonforpie', verifyToken, getcomparisonforpie);


module.exports = router;