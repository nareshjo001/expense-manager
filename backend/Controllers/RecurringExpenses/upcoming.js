"use strict";

// REC-003-T02 -- GET /api/recurring/upcoming, with date bounds.
//
// "With date bounds" is load-bearing, and for the same reason EXP-003 exists:
// an unbounded projection endpoint is an endpoint a client can ask to
// forecast a hundred years. The window is validated and capped here rather
// than trusted, and a caller that supplies nothing gets a sensible default
// window rather than everything.
const { RecurringExpenseModel } = require("../../models/RecurringExpense");
const { projectUpcoming, MAX_PROJECTION_DAYS } = require("../../Services/RecurringServices/upcomingProjection");
// DAT-001-T06 -- responses carry minor units additively.
const { toMinorOrNull } = require("../../utils/moneyView");

const DEFAULT_WINDOW_DAYS = 92; // ~3 months: enough to plan against, short enough to still be true.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateParam(raw, fallback) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const parsed = new Date(String(raw));
  if (Number.isNaN(parsed.getTime())) {
    const err = new Error("from and to must be valid dates");
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

const getUpcoming = async (req, res) => {
  try {
    const now = new Date();

    let from;
    let to;
    try {
      // Default window starts now, not at the beginning of the month: the
      // question this endpoint answers is "what is coming", and an occurrence
      // that already happened is not coming. Overdue ones are still included
      // because they have NOT happened -- see the projection service.
      from = parseDateParam(req.query.from, new Date(now.getTime() - MS_PER_DAY));
      to = parseDateParam(req.query.to, new Date(now.getTime() + DEFAULT_WINDOW_DAYS * MS_PER_DAY));
    } catch (validationErr) {
      return res.status(400).json({ message: validationErr.message, success: false });
    }

    if (to <= from) {
      return res.status(400).json({ message: "to must be after from", success: false });
    }

    const windowDays = Math.ceil((to - from) / MS_PER_DAY);
    if (windowDays > MAX_PROJECTION_DAYS) {
      // Refused rather than silently truncated. A client that asked for two
      // years and received three months without being told would render a
      // total labelled "next 2 years" that is nothing of the kind.
      return res.status(400).json({
        message: `Requested window of ${windowDays} days exceeds the maximum of ${MAX_PROJECTION_DAYS}`,
        success: false,
        errorCode: "WINDOW_TOO_LARGE",
      });
    }

    // User-scoped. Another user's definitions must never reach this
    // projection -- the same rule every read path in this codebase follows.
    const definitions = await RecurringExpenseModel.find({ userId: req.userId }).lean();

    const { occurrences, summary } = projectUpcoming(definitions, { from, to, now });

    // Derive minor units at read time for any definition whose shadow field
    // is absent (MONEY_MINOR_DUAL_WRITE_ENABLED defaults false) -- same
    // decision as utils/moneyView.js, and the reason the projection's
    // totalMinor can be trusted.
    const withMinor = occurrences.map((o) => ({
      ...o,
      expenseAmountMinor:
        o.expenseAmountMinor !== null ? o.expenseAmountMinor : toMinorOrNull(o.expenseAmount),
    }));

    const totalMinor = withMinor.reduce(
      (sum, o) => (typeof o.expenseAmountMinor === "number" ? sum + o.expenseAmountMinor : sum),
      0
    );

    return res.status(200).json({
      message: "Success",
      success: true,
      data: withMinor,
      summary: { ...summary, totalMinor },
      window: { from: from.toISOString(), to: to.toISOString() },
      // The client needs this to decide whether to show a "schedule is
      // behind" warning, and to know the projection is a projection.
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal Server Error", success: false });
  }
};

module.exports = { getUpcoming };
