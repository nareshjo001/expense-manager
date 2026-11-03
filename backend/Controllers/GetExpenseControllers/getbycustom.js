const { UserModel } = require('../../config/Schemas');
const { sortAscending } = require('../../Services/HelperServices/getexpense.service');
const { annotateRecurringState } = require('../../Services/RecurringServices/recurringStateService');
const { resolveLimit, decodeCursor, PaginationValidationError } = require('../../utils/pagination');
// DAT-001-T06 -- additive minor-unit fields; see utils/moneyView.js for why
// they are derived at read time rather than read from the shadow columns.
const { withMinorFieldsAll } = require('../../utils/moneyView');
// Md.
const { searchExpenses } = require('../../Services/ExpenseServices/expenseSearchService');

// Cursor-paginated, user-scoped date-range search.
const getByCustomPaginated = async (user, searchParams, limit, cursor) => {
    // Js, not inline here.
    const { page, hasMore, nextCursor } = await searchExpenses(user._id, searchParams, limit, cursor);
    const annotated = await annotateRecurringState(user._id, page);

    return { data: withMinorFieldsAll(sortAscending(annotated), ['expenseAmount']), hasMore, nextCursor };
};

const getByCustom = async (req, res) => {
    try {
        // Validate user 
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Extract custom date range + EXP-002's new optional filters from query params.
        const { startDate, endDate, limit: rawLimit, cursor: rawCursor, nameContains, category, minAmount, maxAmount, isRecurring } = req.query;
        
        // Validate that both dates are provided
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'startDate and endDate are required', success: false });
        }
        
        // Convert string query params into Date objects
        const start = new Date(startDate);
        const end = new Date(endDate);

        // Reject malformed dates.
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ message: 'startDate and endDate must be valid dates', success: false });
        }

        // The 4 new optional filters: when this controller is called directly (bypassing expenseSearchValidation), values arrive as raw query strings; when called through the real route, Joi has already coerced minAmount/maxAmount to numbers and isRecurring to a boolean, so these conversions are no-ops in that path and only do real work for a direct-call caller.
        const searchParams = {
            startDate: start,
            endDate: end,
            nameContains: typeof nameContains === 'string' ? nameContains : undefined,
            category: typeof category === 'string' ? category : undefined,
            minAmount: minAmount !== undefined ? Number(minAmount) : undefined,
            maxAmount: maxAmount !== undefined ? Number(maxAmount) : undefined,
            isRecurring: isRecurring === undefined ? undefined : (isRecurring === true || isRecurring === 'true'),
        };

        // `limit` is now always resolved to a bounded value.
        let limit;
        let cursor;
        try {
            limit = resolveLimit(rawLimit);
            cursor = decodeCursor(rawCursor);
        } catch (validationErr) {
            if (validationErr instanceof PaginationValidationError) {
                return res.status(400).json({ message: validationErr.message, success: false, errorCode: validationErr.code });
            }
            throw validationErr;
        }

        const { data, hasMore, nextCursor } = await getByCustomPaginated(user, searchParams, limit, cursor);
        return res.status(200).json({ message: 'Success', data, success: true, hasMore, nextCursor });
    
    } catch(err) {
        // Catch unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { getByCustom }
