const { UserModel } = require('../../config/Schemas');
const { sortAscending } = require('../../Services/HelperServices/getexpense.service');
const { annotateRecurringState } = require('../../Services/RecurringServices/recurringStateService');
const { resolveLimit, decodeCursor, PaginationValidationError } = require('../../utils/pagination');
// DAT-001-T06 -- additive minor-unit fields; see utils/moneyView.js for why
// they are derived at read time rather than read from the shadow columns.
const { withMinorFieldsAll } = require('../../utils/moneyView');
// EXP-002-T04 -- the four new optional filters + the actual filter-building
// query logic now live in this dedicated service; see
// docs/expense/EXP-002-T03-T04-normalized-fields-and-query-service.md.
const { searchExpenses } = require('../../Services/ExpenseServices/expenseSearchService');

// EXP-003 -- cursor-paginated, user-scoped date-range search. Since
// EXP-003-T03 this is the ONLY query path this route takes; the previous
// unbounded fallback through fetchExpense() is gone.
//
// It remains a SEPARATE query path from fetchExpense/fetchExpenseRaw rather
// than a change to that shared helper, and that separation still matters:
// analytics, report and chart code calls fetchExpense for a date range and
// needs the COMPLETE range. Paging it would silently truncate the input to a
// total and produce a confidently wrong number.
const getByCustomPaginated = async (user, searchParams, limit, cursor) => {
    // EXP-002-T04 -- filter-building (date range + the 4 new optional
    // filters, all AND-combined per EXP-002-T01) now lives in
    // expenseSearchService.js, not inline here.
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

        // Extract custom date range + EXP-002's new optional filters from
        // query params. expenseSearchValidation (Middlewares/AuthValidation.js)
        // already validated/coerced these at the route boundary for the real
        // HTTP route; the checks below remain as defense-in-depth for any
        // caller that invokes this controller directly (e.g.
        // tests/getByCustom.pagination.test.js does exactly that).
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

        // The 4 new optional filters: when this controller is called
        // directly (bypassing expenseSearchValidation), values arrive as
        // raw query strings; when called through the real route, Joi has
        // already coerced minAmount/maxAmount to numbers and isRecurring to
        // a boolean, so these conversions are no-ops in that path and only
        // do real work for a direct-call caller.
        const searchParams = {
            startDate: start,
            endDate: end,
            nameContains: typeof nameContains === 'string' ? nameContains : undefined,
            category: typeof category === 'string' ? category : undefined,
            minAmount: minAmount !== undefined ? Number(minAmount) : undefined,
            maxAmount: maxAmount !== undefined ? Number(maxAmount) : undefined,
            isRecurring: isRecurring === undefined ? undefined : (isRecurring === true || isRecurring === 'true'),
        };

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

        const { data, hasMore, nextCursor } = await getByCustomPaginated(user, searchParams, limit, cursor);
        return res.status(200).json({ message: 'Success', data, success: true, hasMore, nextCursor });
    
    } catch(err) {
        // Catch unexpected server errors
        console.error(err);
        res.status(500).json({ message: 'Internal Server Error', success: false });
    }
}

module.exports = { getByCustom }
