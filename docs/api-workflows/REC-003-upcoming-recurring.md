# REC-003: Upcoming recurring expenses

`GET /api/recurring/upcoming?from=&to=` and the panel that renders it.

## Status: 5 of 6 tasks

| Task | State |
|---|---|
| T01 Deterministic projection service | Done — `backend/Services/RecurringServices/upcomingProjection.js` |
| T02 Upcoming endpoint with date bounds | Done — `backend/Controllers/RecurringExpenses/upcoming.js` |
| T03 Empty / error / stale states | Done — three distinct states, see below |
| T04 Upcoming list UI | Done — `frontend/src/components/recurring/UpcomingRecurring.js` |
| T05 Link pause/edit actions | **Partial — blocked on REC-002** |
| T06 Timezone / month-end projection tests | Done — 24 tests |

## Why T05 is not done

The task is "link pause/edit actions". Edit is linked. **Pause does not
exist**, and cannot be linked without inventing it:

- `RecurringExpense` has no lifecycle state field. Every stored definition is
  unconditionally active. Adding one is REC-002-T01.
- There is no pause/resume API. The only off switch is `PATCH /api/recurring`
  with `isRecurring: false`, which **deletes the definition** — losing
  `lastLoggedDate` and resetting `nextDueDate` if it is ever re-enabled.
  Labelling that "pause" would promise the user a resume that does not
  happen. Real pause/resume is REC-002-T02.

So the UI links edit and nothing else, and
`UpcomingRecurring.test.js` asserts that no pause or resume control is
rendered — so the gap fails loudly if someone adds a mislabelled button.

## The projection contract

The projection's only job is to agree with `cron/recurringJob.js`. Three
things about that job's behaviour are non-obvious, and a reasonable-looking
projection gets all three wrong:

**1. The schedule is always the 1st, in UTC.** The job advances with
`Date.UTC(year, month + 1, 1)`. Day-of-month is hard-coded, so there is no
"same day next month" rule and therefore **no Jan-31 → Feb-31 problem to
solve**. Preserving the original day-of-month would generate dates the job
never produces. The tests state this explicitly so nobody "fixes" it.

**2. It advances from the due date, not from now** — one month per pass, and
the job runs once a day. A definition three months overdue produces **one
occurrence per day for three days**, not three today. The projection reports
`expectedExpenseDate` accordingly.

**3. The created expense is dated when the job ran, not when it was due.**
`expenseDate` is `new Date()`. For an overdue backlog that is not the due
date at all. The response carries both `dueDate` (the schedule) and
`expectedExpenseDate` (what the expense will carry), because conflating them
is how a report total stops matching a forecast.

## Response

```
{ data: [{ recurringId, expenseId, expenseName, expenseCategory,
           expenseAmount, expenseAmountMinor,
           dueDate, dueCalendarDate, expectedExpenseDate, overdue }],
  summary: { count, overdueCount, definitionCount, totalMinor, timeZone },
  window: { from, to },
  generatedAt }
```

- **Bounded.** Omitting `from`/`to` gives the server's default ~3-month
  window, not everything — the rule EXP-003 established. A window over 366
  days is **refused** with `WINDOW_TOO_LARGE` rather than truncated, so a
  client cannot label three months of data as two years.
- **`dueCalendarDate`** is the date resolved in the app's configured time
  zone. The client renders this rather than reformatting `dueDate`, because
  UTC midnight on the 1st is *the previous day* for any viewer west of UTC —
  30 September for a 1 October charge.
- **`totalMinor`** sums integer paise only (ADR-0003). Summing rupee floats
  here would reintroduce the drift, in the number users are most likely to
  plan against.
- **User-scoped**, asserted in the route tests: another user's definitions
  would disclose their rent, salary and subscriptions.

## T03's three states, and why they are three

A list component usually gets these wrong by collapsing them:

- **Empty** is two different facts. "You have no recurring expenses" is fixed
  by setting one up; "your recurring expenses produce nothing in this window"
  is fixed by looking further ahead. One blank panel for both says nothing.
- **Error** must not render as an empty schedule. "Nothing upcoming" when the
  request actually failed is a lie the user may plan around — the most common
  way a list component misleads. There is an explicit error state with a
  retry.
- **Stale** matters because this is a projection of what a cron job will do.
  If the job has not run, occurrences are overdue and the dates shown are
  already in the past. `summary.overdueCount` drives a notice explaining that
  the job catches up one per day — without it, the list looks like a
  rendering bug.
