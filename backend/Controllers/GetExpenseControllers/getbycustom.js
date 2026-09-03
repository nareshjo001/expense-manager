const { UserModel, ExpenseModel } = require('../../config/Schemas');
const { fetchExpense } = require('./fetchExpenses');
const { sortAscending } = require('../../Services/HelperServices/getexpense.service');
const { annotateRecurringState } = require('../../Services/RecurringServices/recurringStateService');
const { parseLimit, decodeCursor, buildCursorFilter, paginateResults, PaginationValidationError } = require('../../utils/pagination');

// EXP-003 -- cursor-paginated variant of the same user-scoped date-range
// search, used only when the caller passes `limit`. Deliberately a
// SEPARATE query path from fetchExpense/fetchExpenseRaw (below) rather
// than a change to that shared helper -- analytics/report/chart code also
// calls fetchExpense for a date range and needs the COMPLETE range, never
// a truncated page.
const getByCustomPaginated = async (user, start, end, limit, cursor) => {
    const filter = {
        userId: user._id,
        expenseDate: { $gte: start, $lte: end },
        ...buildCursorFilter(cursor, 'expenseDate'),
    };

    // Fetch one extra document beyond the page size to detect "more pages
    // remain" without a separate count query.
    const documents = await ExpenseModel.find(filter)
        .sort({ expenseDate: -1, _id: -1 })
        .limit(limit + 1)
        .lean();

    const { page, hasMore, nextCursor } = paginateResults(documents, limit, 'expenseDate');
    const annotated = await annotateRecurringState(user._id, page);

    return { data: sortAscending(annotated), hasMore, nextCursor };
};

const getByCustom = async (req, res) => {
    try {
        // Validate user 
        const user = await UserModel.findById(req.userId);
        if (!user) {
            return res.status(401).json({ message: 'User does not exist', success: false });
        }

        // Extract custom date range from query params
        const { startDate, endDate, limit: rawLimit, cursor: rawCursor }= req.query;
        
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

        let limit;
        let cursor;
        try {
            limit = parseLimit(rawLimit);
            cursor = decodeCursor(rawCursor);
        } catch (validationErr) {
            if (validationErr instanceof PaginationValidationError) {
                return res.status(400).json({ message: validationErr.message, success: false, errorCode: validationErr.code });
            }
            throw validationErr;
        }

        // A cursor implies pagination was already in progress -- require an
        // explicit limit too rather than silently guessing a page size.
        if (cursor && limit === undefined) {
            return res.status(400).json({ message: 'limit is required when cursor is provided.', success: false, errorCode: 'INVALID_PAGINATION_PARAMS' });
        }

        // No `limit` -- exact previous behavior, unbounded within the date range.
        if (limit === undefined) {
            const expenses = sortAscending(await fetchExpense(start, end, user._id));
            return res.status(200).json({ message: 'Success', data: expenses, success: true });
        }

        const { data, hasMore, nextCursor } = await getByCustomPaginated(user, start, end, limit, cursor);
        return res.status(200).json({ message: 'Success', data, success: true, hasMore, nextCursor });
    
    } catch(err) {
        // Catch unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { getByCustom }
