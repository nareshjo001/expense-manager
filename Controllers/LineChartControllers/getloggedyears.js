const { UserModel, ExpenseModel } = require('../../config/Schemas');

const getloggedyears = async (req, res) => {
    try {
        // Validate authenticated user
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Use MongoDB aggregation to extract distinct years
        const years = await ExpenseModel.aggregate([
            { $match: { userId: user._id } },
            {
                $group: {
                    _id: { $year: "$expenseDate" }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Convert aggregation result to simple array
        const formattedYears = years.map(y => y._id);

        // Send success response
        res.status(200).json({ success: true, data: formattedYears });

    } catch (err) {
        // Handle server errors 
        console.error('Error in getloggedyears:', err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
};

module.exports = { getloggedyears };