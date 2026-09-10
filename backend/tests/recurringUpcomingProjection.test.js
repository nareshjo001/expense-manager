// REC-003-T06 -- timezone and month-end projection tests.
//
// The projection's only job is to agree with cron/recurringJob.js. So most of
// these tests are written as "the job does X, therefore the projection must
// say X" rather than as "a monthly recurrence should mean Y" -- because where
// the two differ, the job wins and the projection is the bug.
"use strict";

const {
  projectUpcoming,
  advanceOneMonth,
  calendarDateInZone,
} = require("../Services/RecurringServices/upcomingProjection");

const utc = (y, m, d, h = 0, min = 0) => new Date(Date.UTC(y, m - 1, d, h, min, 0));

function definition(overrides = {}) {
  return {
    _id: "rec1",
    expenseId: "exp1",
    expenseName: "Rent",
    expenseCategory: "Housing",
    expenseAmount: 12000,
    expenseAmountMinor: 1200000,
    lastLoggedDate: utc(2026, 9, 1),
    nextDueDate: utc(2026, 10, 1),
    ...overrides,
  };
}

describe("advanceOneMonth mirrors recurringJob.js exactly", () => {
  test("always lands on the 1st at 00:00 UTC", () => {
    const next = advanceOneMonth(utc(2026, 10, 1));
    expect(next.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  test("rolls the year over December -> January", () => {
    expect(advanceOneMonth(utc(2026, 12, 1)).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  test("normalizes a non-1st due date onto the 1st", () => {
    // The job computes Date.UTC(year, month+1, 1) from the ORIGINAL due date,
    // so a definition sitting on the 17th does not stay on the 17th. A
    // projection that preserved day-of-month would be wrong for every such
    // definition -- and the recurring toggle only guarantees the 1st for
    // definitions it created itself.
    expect(advanceOneMonth(utc(2026, 10, 17)).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  test("there is no month-end overflow to solve, because the day is hard-coded", () => {
    // Jan 31 -> Feb 31 is the classic monthly-recurrence bug. It cannot occur
    // here, and the test states that so nobody "fixes" it by introducing
    // day-of-month preservation the job does not have.
    expect(advanceOneMonth(utc(2026, 1, 31)).toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(advanceOneMonth(utc(2026, 2, 1)).toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  test("a leap-year February behaves the same as any other month", () => {
    expect(advanceOneMonth(utc(2028, 2, 1)).toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });
});

describe("projectUpcoming -- future occurrences", () => {
  test("projects one occurrence per month within the window", () => {
    const { occurrences } = projectUpcoming([definition()], {
      from: utc(2026, 9, 15),
      to: utc(2027, 1, 15),
      now: utc(2026, 9, 15),
      timeZone: "UTC",
    });

    expect(occurrences.map((o) => o.dueDate)).toEqual([
      "2026-10-01T00:00:00.000Z",
      "2026-11-01T00:00:00.000Z",
      "2026-12-01T00:00:00.000Z",
      "2027-01-01T00:00:00.000Z",
    ]);
  });

  test("excludes occurrences outside the window on both sides", () => {
    const { occurrences } = projectUpcoming([definition()], {
      from: utc(2026, 11, 1),
      to: utc(2026, 12, 1),
      now: utc(2026, 9, 15),
      timeZone: "UTC",
    });

    expect(occurrences.map((o) => o.dueDate)).toEqual([
      "2026-11-01T00:00:00.000Z",
      "2026-12-01T00:00:00.000Z",
    ]);
  });

  test("a future occurrence's expense will be dated its due date", () => {
    const { occurrences } = projectUpcoming([definition()], {
      from: utc(2026, 9, 15),
      to: utc(2026, 10, 15),
      now: utc(2026, 9, 15),
      timeZone: "UTC",
    });

    expect(occurrences[0].overdue).toBe(false);
    expect(occurrences[0].expectedExpenseDate).toBe(occurrences[0].dueDate);
  });

  test("sums amounts in minor units, never floats", () => {
    // Adding rupee floats here would reintroduce the drift ADR-0003 removes,
    // and this total is the number a user is most likely to plan against.
    const { summary } = projectUpcoming(
      [
        definition({ _id: "a", expenseAmount: 40.3, expenseAmountMinor: 4030 }),
        definition({ _id: "b", expenseAmount: 0.7, expenseAmountMinor: 70 }),
      ],
      { from: utc(2026, 9, 15), to: utc(2026, 10, 15), now: utc(2026, 9, 15), timeZone: "UTC" }
    );

    expect(summary.totalMinor).toBe(4100);
  });
});

describe("projectUpcoming -- overdue catch-up", () => {
  test("an overdue occurrence is reported as overdue but still listed", () => {
    // It has not happened yet -- the job has not run. Dropping it would hide
    // money the user is about to be charged.
    const { occurrences, summary } = projectUpcoming(
      [definition({ nextDueDate: utc(2026, 8, 1) })],
      { from: utc(2026, 8, 1), to: utc(2026, 11, 1), now: utc(2026, 10, 15), timeZone: "UTC" }
    );

    expect(occurrences[0].dueDate).toBe("2026-08-01T00:00:00.000Z");
    expect(occurrences[0].overdue).toBe(true);
    expect(summary.overdueCount).toBeGreaterThan(0);
  });

  test("a three-month backlog catches up one occurrence per day, not all at once", () => {
    // recurringJob.js advances nextDueDate by ONE month per pass and runs
    // once a day. So three overdue months produce three occurrences on three
    // consecutive days. Projecting them as all appearing today would misstate
    // both the dates and today's total.
    const { occurrences } = projectUpcoming(
      [definition({ nextDueDate: utc(2026, 8, 1) })],
      { from: utc(2026, 8, 1), to: utc(2026, 11, 1), now: utc(2026, 10, 15), timeZone: "UTC" }
    );

    const overdue = occurrences.filter((o) => o.overdue);
    expect(overdue).toHaveLength(3); // Aug 1, Sep 1, Oct 1

    // Expected creation dates are consecutive days from `now`, oldest first.
    expect(overdue.map((o) => o.expectedExpenseDate)).toEqual([
      "2026-10-16T00:00:00.000Z",
      "2026-10-17T00:00:00.000Z",
      "2026-10-18T00:00:00.000Z",
    ]);
  });

  test("an overdue occurrence's expense date differs from its due date", () => {
    // The job sets expenseDate to `new Date()`, not to the due date. These
    // are different fields and conflating them is how a report total stops
    // matching a forecast.
    const { occurrences } = projectUpcoming(
      [definition({ nextDueDate: utc(2026, 8, 1) })],
      { from: utc(2026, 8, 1), to: utc(2026, 9, 1), now: utc(2026, 10, 15), timeZone: "UTC" }
    );

    expect(occurrences[0].dueDate).not.toBe(occurrences[0].expectedExpenseDate);
  });

  test("nothing is overdue when the next due date is in the future", () => {
    const { summary } = projectUpcoming([definition()], {
      from: utc(2026, 9, 15),
      to: utc(2026, 11, 15),
      now: utc(2026, 9, 15),
      timeZone: "UTC",
    });

    expect(summary.overdueCount).toBe(0);
  });
});

describe("time zones", () => {
  test("Asia/Kolkata sees UTC-midnight-on-the-1st as the 1st", () => {
    // +05:30, so 00:00 UTC is 05:30 the same calendar day.
    expect(calendarDateInZone(utc(2026, 10, 1), "Asia/Kolkata")).toBe("2026-10-01");
  });

  test("a zone west of UTC sees it as the PREVIOUS day", () => {
    // This is the bug a naive toISOString().slice(0,10) produces: the user's
    // own calendar says 30 September and the app says 1 October.
    expect(calendarDateInZone(utc(2026, 10, 1), "America/New_York")).toBe("2026-09-30");
    expect(calendarDateInZone(utc(2026, 10, 1), "America/Los_Angeles")).toBe("2026-09-30");
  });

  test("the projection reports the calendar date in the configured zone", () => {
    const { occurrences, summary } = projectUpcoming([definition()], {
      from: utc(2026, 9, 15),
      to: utc(2026, 10, 15),
      now: utc(2026, 9, 15),
      timeZone: "America/New_York",
    });

    expect(occurrences[0].dueCalendarDate).toBe("2026-09-30");
    // The instant itself is unchanged -- only its presentation moves.
    expect(occurrences[0].dueDate).toBe("2026-10-01T00:00:00.000Z");
    expect(summary.timeZone).toBe("America/New_York");
  });

  test("an unrecognized zone falls back to the app default rather than throwing", () => {
    const { summary } = projectUpcoming([definition()], {
      from: utc(2026, 9, 15),
      to: utc(2026, 10, 15),
      now: utc(2026, 9, 15),
      timeZone: "Not/AZone",
    });

    expect(summary.timeZone).toBe("Asia/Kolkata");
  });

  test("a DST transition does not shift the schedule, because the schedule is UTC", () => {
    // Europe/London is UTC+1 in summer, UTC+0 in winter. The due instant is
    // UTC midnight either way, so the calendar date only moves if the offset
    // is negative -- which London's never is.
    expect(calendarDateInZone(utc(2026, 7, 1), "Europe/London")).toBe("2026-07-01");
    expect(calendarDateInZone(utc(2026, 12, 1), "Europe/London")).toBe("2026-12-01");
  });
});

describe("robustness", () => {
  test("an empty definition list projects nothing", () => {
    const { occurrences, summary } = projectUpcoming([], {
      from: utc(2026, 9, 1),
      to: utc(2026, 12, 1),
      now: utc(2026, 9, 1),
    });

    expect(occurrences).toEqual([]);
    expect(summary.count).toBe(0);
    expect(summary.definitionCount).toBe(0);
  });

  test("a non-array input is tolerated", () => {
    expect(
      projectUpcoming(undefined, { from: utc(2026, 9, 1), to: utc(2026, 10, 1) }).occurrences
    ).toEqual([]);
  });

  test("a definition with a missing or invalid nextDueDate is skipped, not thrown on", () => {
    const { occurrences } = projectUpcoming(
      [definition({ nextDueDate: undefined }), definition({ _id: "bad", nextDueDate: new Date("nope") })],
      { from: utc(2026, 9, 1), to: utc(2026, 12, 1), now: utc(2026, 9, 1) }
    );

    expect(occurrences).toEqual([]);
  });

  test("a nextDueDate decades in the past cannot hang the projection", () => {
    // A corrupt or hand-edited date must not spin one iteration per month
    // since 1970 without bound.
    const start = Date.now();
    const { occurrences } = projectUpcoming([definition({ nextDueDate: utc(1971, 1, 1) })], {
      from: utc(2026, 9, 1),
      to: utc(2026, 12, 1),
      now: utc(2026, 10, 15),
    });

    expect(Date.now() - start).toBeLessThan(2000);
    expect(occurrences.length).toBeGreaterThan(0);
  });

  test("occurrences are sorted by due date, with a stable tiebreak", () => {
    const { occurrences } = projectUpcoming(
      [
        definition({ _id: "zzz", nextDueDate: utc(2026, 11, 1) }),
        definition({ _id: "aaa", nextDueDate: utc(2026, 11, 1) }),
        definition({ _id: "mmm", nextDueDate: utc(2026, 10, 1) }),
      ],
      { from: utc(2026, 9, 15), to: utc(2026, 11, 15), now: utc(2026, 9, 15), timeZone: "UTC" }
    );

    // Same-instant occurrences order by id so the list does not reshuffle
    // between refreshes for no reason.
    const november = occurrences.filter((o) => o.dueDate === "2026-11-01T00:00:00.000Z");
    expect(november.map((o) => o.recurringId)).toEqual(["aaa", "mmm", "zzz"]);
  });

  test("emits null rather than a guess when a minor amount is absent", () => {
    const { occurrences } = projectUpcoming(
      [definition({ expenseAmountMinor: undefined })],
      { from: utc(2026, 9, 15), to: utc(2026, 10, 15), now: utc(2026, 9, 15), timeZone: "UTC" }
    );

    expect(occurrences[0].expenseAmountMinor).toBeNull();
  });
});
