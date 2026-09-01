const { UserModel, BudgetModel } = require('../../config/Schemas');
const { MONTH_ORDER } = require('../../Services/ChartServices/chartConstants');
const syncRecoveryService = require('../../Services/syncRecoveryService');

// Order budget records chronologically by month key.
const sortByMonthKey = (a, b) => {
    const [aMonth, aYear] = a.month.split(' ');
    const [bMonth, bYear] = b.month.split(' ');

    if (Number(aYear) !== Number(bYear)) {
        return Number(aYear) - Number(bYear);
    }

    return MONTH_ORDER.indexOf(aMonth) - MONTH_ORDER.indexOf(bMonth);
};

const getbudgets = async (req, res) => {
    try {
        // Check if the authenticated user exists in the database
        const user = await UserModel.findById(req.userId);
        if(!user) {
            return res.status(401).json({ message: 'User does not exist', success: false});
        }

        // Phase C -- Expense Mutation Reliability: repair-on-read. Unlike
        await syncRecoveryService.repairIfPending(user._id);

        // Fetch all budgets belonging to this user, ordered chronologically
        const budgets = (await BudgetModel.find({ userId: user._id }).lean())
            .sort(sortByMonthKey);

        // Phase C.1 -- known-stale budget data must not be presented as
        const pendingAfterRepair = await syncRecoveryService.getPendingSync(user._id);
        const stalePendingMonthKeys = new Set(
            ((pendingAfterRepair && pendingAfterRepair.pendingBudgetMonths) || []).map((d) =>
                new Date(d).toLocaleString('default', { month: 'short', year: 'numeric' })
            )
        );
        const staleReservedMonthKeys = new Set(
            ((pendingAfterRepair && pendingAfterRepair.reservedBudgetMonths) || []).map((r) =>
                new Date(r.month).toLocaleString('default', { month: 'short', year: 'numeric' })
            )
        );
        const staleMonths = [...new Set([...stalePendingMonthKeys, ...staleReservedMonthKeys])];
        const recoveryPending = staleMonths.length > 0;

        // Send successful response with budget data
        res.status(200).json({
            message: 'Success',
            data: budgets,
            success: true,
            recoveryPending,
            staleMonths,
        });
    
      } catch(err) {
        // Catch unexpected server/database errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { getbudgets };