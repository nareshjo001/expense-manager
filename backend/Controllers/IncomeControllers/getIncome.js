const { UserModel, IncomeModel } = require('../../config/Schemas');
const { resolvePeriod } = require('../../Services/InsightServices/periodResolver');
const { resolveLimit, decodeCursor, buildCursorFilter, paginateResults, PaginationValidationError } = require('../../utils/pagination');

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

    // EXP-003-T03 -- `limit` always resolves to a bounded value; omitting it
    // yields DEFAULT_LIMIT rather than the user's entire income history. The
    // unbounded IncomeModel.find(filter) fallback that used to live below is
    // gone, and with it the last way a client could ask this route for an
    // unknown number of documents. A cursor no longer needs an explicit
    // limit beside it, since the default page size now makes it unambiguous.
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

    const filter = { userId: user._id };
    if (range) {
      filter.incomeDate = {
        $gte: range.startDate,
        $lt: range.endDate,
      };
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
