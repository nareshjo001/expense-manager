"use strict";

// REC-003-T01 -- deterministic projection of upcoming recurring expenses.
//
// "Deterministic" is the whole requirement and it is not decoration: this
// service must predict exactly what cron/recurringJob.js will do, because a
// projection that disagrees with the job is worse than no projection. A user
// who is told "₹1,200 rent on 1 October" and gets something else has been
// given a number they may have budgeted against.
//
// So this file is written against the job's actual behaviour rather than
// against what a monthly recurrence "should" mean. Three things about that
// behaviour are non-obvious, and a reasonable-looking projection gets all
// three wrong:
//
// 1. THE SCHEDULE IS ALWAYS THE 1ST, IN UTC. recurringJob.js advances with
//
//      new Date(Date.UTC(originalNextDue.getUTCFullYear(),
//                        originalNextDue.getUTCMonth() + 1, 1, 0, 0, 0))
//
//    Day-of-month is hard-coded to 1. There is no "same day next month"
//    rule, so there is no Jan-31 -> Feb-31 problem to solve -- and inventing
//    one would produce dates the job never generates. A projection that
//    preserved the original day-of-month would be wrong for every definition
//    whose nextDueDate is not already the 1st (which the toggle in
//    Controllers/RecurringExpenses/recurring.js can produce, since it seeds
//    nextDueDate as the 1st of next month but a definition predating that
//    code, or edited directly, need not be).
//
// 2. IT ADVANCES FROM THE DUE DATE, NOT FROM NOW. The update is
//    `nextDueDate: newNextDue` computed from `originalNextDue` -- one month
//    per pass. The job runs once a day. So a definition three months overdue
//    is not caught up in one run: it produces ONE occurrence per daily run
//    for three days. Projecting overdue items as "all appearing today" would
//    misstate both the dates and the day's total.
//
// 3. THE CREATED EXPENSE IS DATED WHEN THE JOB RAN, NOT WHEN IT WAS DUE.
//    `expenseDate: occurrenceExpenseDate` is `new Date()`. So an occurrence
//    due 1 October appears in the user's expense list dated whenever the job
//    next ran -- which for an overdue backlog is not 1 October at all. This
//    projection reports the scheduled date AND the date the expense will
//    actually carry, because they are different fields and conflating them is
//    how a report total stops matching a forecast.
//
// REC-002-T03 update: RecurringExpense now HAS a lifecycle (status:
// active/paused/ended) and an optional endDate (REC-002-T01/T02, Done). This
// file still does not model pause/resume itself -- there is nothing to
// model: Controllers/RecurringExpenses/upcoming.js only ever passes this
// file 'active' definitions (a paused or ended definition produces no
// occurrences, so it is filtered out before projection rather than
// special-cased inside it). What this file DOES honor directly is endDate,
// because that is a per-occurrence cutoff a single active definition's own
// schedule can still hit mid-projection -- see projectDefinition below, and
// cron/recurringJob.js's matching auto-end logic. Both compare
// `dueDate > endDate` the same way, so the projection and the job can never
// disagree about when a schedule ends.
// The app's canonical time zone, plus IANA-zone validation. NOT-003-T04
// extracted this into a shared util (utils/timeZone.js) once a second
// feature (quiet hours) needed the exact same validation this file already
// had -- see that module's header for the fuller note. Re-exported below
// under the same name so nothing that already imports resolveTimeZone from
// THIS file breaks.
const { resolveTimeZone } = require("../../utils/timeZone");

// Hard cap on how far ahead a caller may project. Not a performance guard --
// projecting 12 occurrences is trivial. It is an honesty guard: the further
// out you go, the more the projection depends on nothing changing, and a
// two-year forecast of a definition the user will edit next week reads as
// more certain than it is.
const MAX_PROJECTION_DAYS = 366;

// Matches recurringJob.js's advancement exactly. Kept as its own function so
// the correspondence is one line to check rather than inlined arithmetic.
function advanceOneMonth(dueDate) {
  return new Date(
    Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth() + 1, 1, 0, 0, 0)
  );
}

// The job runs on a daily cron. An overdue definition therefore catches up at
// one occurrence per day, oldest first -- so the Nth overdue occurrence is
// expected to be created N days from the next run, not today.
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

// Formats an instant as a calendar date in the application's time zone.
//
// The schedule is UTC midnight on the 1st, which in Asia/Kolkata (the app
// default) is 05:30 on the 1st -- same calendar day. But for a zone west of
// UTC it is the PREVIOUS day's evening, so a naive `toISOString().slice(0,10)`
// would show users a date one day off from the one their own calendar shows.
function calendarDateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  // en-CA yields YYYY-MM-DD.
  return parts;
}

// Projects the occurrences a single definition will produce within a window.
//
// `now` is injected rather than read from the clock so tests can pin it and
// so a caller projecting a report for a past window gets consistent overdue
// accounting.
function projectDefinition(definition, { from, to, now, timeZone, overdueRank }) {
  const occurrences = [];
  if (!definition || !definition.nextDueDate) return { occurrences, overdueCount: 0 };

  let due = new Date(definition.nextDueDate);
  if (Number.isNaN(due.getTime())) return { occurrences, overdueCount: 0 };

  let overdueCount = 0;
  let rank = overdueRank;

  // Guard against a pathological nextDueDate far in the past producing an
  // unbounded loop before it reaches `from`. One iteration per month is
  // cheap, but "one per month since 1970" is not, and a corrupt date should
  // not hang a request.
  let iterations = 0;
  const MAX_ITERATIONS = 2000;

  while (due <= to && iterations < MAX_ITERATIONS) {
    // REC-002-T03 -- matches cron/recurringJob.js's auto-end check exactly:
    // once a due date passes endDate, the job never creates that occurrence
    // (it ends the definition instead), so this projection must not predict
    // one either. `due` only advances forward each iteration, so once it
    // exceeds endDate every later iteration would too -- breaking here is
    // sufficient, not just a `continue`.
    if (definition.endDate && due > new Date(definition.endDate)) break;

    iterations += 1;

    const isOverdue = due <= now;
    if (isOverdue) {
      overdueCount += 1;
      rank += 1;
    }

    if (due >= from) {
      // For an overdue occurrence, the expense the job creates is dated the
      // day the job runs -- which, with one catch-up per daily run, is
      // `rank` days from now. For a future occurrence the job runs on the
      // due date itself, so the two coincide.
      const expectedCreationDate = isOverdue ? addDays(now, rank) : due;

      occurrences.push({
        recurringId: String(definition._id),
        expenseId: definition.expenseId ? String(definition.expenseId) : null,
        expenseName: definition.expenseName,
        expenseCategory: definition.expenseCategory,
        expenseAmount: definition.expenseAmount,
        expenseAmountMinor:
          typeof definition.expenseAmountMinor === "number" ? definition.expenseAmountMinor : null,
        // The schedule.
        dueDate: due.toISOString(),
        dueCalendarDate: calendarDateInZone(due, timeZone),
        // What the created expense will actually carry (see this file's
        // header, point 3). Equal to dueDate for anything not overdue.
        expectedExpenseDate: expectedCreationDate.toISOString(),
        overdue: isOverdue,
      });
    }

    due = advanceOneMonth(due);
  }

  return { occurrences, overdueCount };
}

// Projects every definition's occurrences across a window.
//
// Returns occurrences sorted by due date, plus a summary the UI needs in
// order to say something truthful about the state of the schedule rather
// than just listing rows.
function projectUpcoming(definitions, { from, to, now = new Date(), timeZone } = {}) {
  const zone = resolveTimeZone(timeZone || process.env.APP_TIME_ZONE);
  const windowStart = from instanceof Date ? from : new Date(from);
  const windowEnd = to instanceof Date ? to : new Date(to);

  const list = Array.isArray(definitions) ? definitions : [];

  // Overdue catch-up is global, not per-definition: the job processes every
  // due definition in one pass, advancing each by one month. So on the next
  // run EVERY overdue definition produces one occurrence, on the run after
  // that every still-overdue one produces its next, and so on. The rank that
  // matters is therefore how many months a given definition is behind, not
  // its position in the list.
  const all = [];
  let totalOverdue = 0;

  for (const definition of list) {
    const { occurrences, overdueCount } = projectDefinition(definition, {
      from: windowStart,
      to: windowEnd,
      now,
      timeZone: zone,
      overdueRank: 0,
    });
    all.push(...occurrences);
    totalOverdue += overdueCount;
  }

  all.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    // Stable secondary ordering so the same input always renders the same
    // way -- otherwise a list reorders between refreshes for no reason.
    return a.recurringId < b.recurringId ? -1 : 1;
  });

  const totalMinor = all.reduce(
    (sum, o) => (typeof o.expenseAmountMinor === "number" ? sum + o.expenseAmountMinor : sum),
    0
  );

  return {
    occurrences: all,
    summary: {
      count: all.length,
      overdueCount: totalOverdue,
      definitionCount: list.length,
      // Sum in minor units only. Adding floats here would reintroduce
      // exactly the drift ADR-0003 exists to remove, and this total is the
      // number a user is most likely to plan against.
      totalMinor,
      timeZone: zone,
    },
  };
}

module.exports = {
  projectUpcoming,
  projectDefinition,
  advanceOneMonth,
  calendarDateInZone,
  resolveTimeZone,
  MAX_PROJECTION_DAYS,
};
