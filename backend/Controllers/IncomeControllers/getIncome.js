const { UserModel, IncomeModel } = require('../../config/Schemas');
const { resolvePeriod } = require('../../Services/InsightServices/periodResolver');
const { parseLimit, decodeCursor, buildCursorFilter, paginateResults, PaginationValidationError } = require('../../utils/pagination');

const getIncome = async (req, res) => {
  try {
    // Get userId from verified JWT (set in auth middleware)
    const user = await UserModel.findById(req.userId);
    if (!user) {
      return res.status(401).json({ message: 'User does not exist', success: false });
    }

    const { period, limit: rawLimit, cursor: rawCursor } = req.query || {};
    const range = period ? resolvePeriod(period) : null;

    if (period && !range) {
      return res.status(400).json({
        success: false,
        message: 'Invalid period. Use current_month or financial_year.',
      });
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

    const filter = { userId: user._id };
    if (range) {
      filter.incomeDate = {
        $gte: range.startDate,
        $lt: range.endDate,
      };
    }

    // No `limit` -- exact previous behavior, unbounded.
    if (limit === undefined) {
      const incomeRecords = await IncomeModel.find(filter).sort({ incomeDate: -1 }); // Sort by date descending
      return res.status(200).json({ message: 'Income records retrieved successfully', success: true, data: incomeRecords });
    }

    // EXP-003 -- cursor-paginated path. Fetch one extra document beyond the
    // page size to detect "more pages remain" without a separate count query.
    const paginatedFilter = { ...filter, ...buildCursorFilter(cursor, 'incomeDate') };
    const documents = await IncomeModel.find(paginatedFilter)
      .sort({ incomeDate: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const { page, hasMore, nextCursor } = paginateResults(documents, limit, 'incomeDate');

    res.status(200).json({ message: 'Income records retrieved successfully', success: true, data: page, hasMore, nextCursor });
  } catch (err) {
    // Send generic server error response
    console.error(err);
    res.status(500).json({ message: 'Internal Server Error', success: false });
  }
};

module.exports = { getIncome };
