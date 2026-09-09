const { UserModel, ExpenseModel } = require('../../config/Schemas');
const { sortAscending } = require('../../Services/HelperServices/getexpense.service');
const { annotateRecurringState } = require('../../Services/RecurringServices/recurringStateService');
const { resolveLimit, decodeCursor, buildCursorFilter, paginateResults, PaginationValidationError } = require('../../utils/pagination');

// EXP-003 -- cursor-paginated, user-scoped date-range search. Since
// EXP-003-T03 this is the ONLY query path this route takes; the previous
// unbounded fallback through fetchExpense() is gone.
//
// It remains a SEPARATE query path from fetchExpense/fetchExpenseRaw rather
// than a change to that shared helper, and that separation still matters:
// analytics, report and chart code calls fetchExpense for a date range and
// needs the COMPLETE range. Paging it would silently truncate the input to a
// total and produce a confidently wrong number.
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

        // EXP-003-T03 -- `limit` is now always resolved to a bounded value.
        // Omitting it yields DEFAULT_LIMIT, not the whole range: this route
        // used to fall back to an unbounded fetchExpense() call, which is the
        // "unbounded user history" the feature exists to remove. Every
        // response from here is therefore a bounded page carrying hasMore and
        // nextCursor, so a client that wants everything pages for it and the
        // server never has to materialise an unknown number of documents.
        //
        // A cursor no longer requires an explicit limit alongside it. That
        // rule existed because there was no default to fall back on and
        // guessing a page size would have been arbitrary; now the default is
        // the documented page size, so a cursor on its own is unambiguous.
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

        const { data, hasMore, nextCursor } = await getByCustomPaginated(user, start, end, limit, cursor);
        return res.status(200).json({ message: 'Success', data, success: true, hasMore, nextCursor });
    
    } catch(err) {
        // Catch unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { getByCustom }
