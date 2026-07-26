const { UserModel } = require('../../config/Schemas');
const { fetchExpense } = require('./fetchExpenses');
const { sortAscending } = require('../../Services/HelperServices/getexpense.service');

const getByCustom = async (req, res) => {
    try {
        // Validate user 
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Extract custom date range from query params
        const { startDate, endDate }= req.query;
        
        // Validate that both dates are provided
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'startDate and endDate are required', success: false });
        }
        
        // Convert string query params into Date objects
        const start = new Date(startDate);
        const end = new Date(endDate);

        // Reject malformed dates before querying — otherwise an Invalid Date
        // can surface as a generic 500 from the database layer instead of a
        // clear 400 for what is really a client input error.
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ message: 'startDate and endDate must be valid dates', success: false });
        }

        // Fetch expenses within range and sort oldest → newest
        const expenses = sortAscending(
            await fetchExpense(start, end, user._id)
        );

        // Send successful response
        res.status(200).json({  message: 'Success', data: expenses, success: true });
    
    } catch(err) {
        // Catch unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { getByCustom }