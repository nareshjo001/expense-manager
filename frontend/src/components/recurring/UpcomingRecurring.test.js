// REC-003-T03/T04/T05 -- the upcoming view, its empty/error/stale states,
// and its pause/edit/end quick actions.
//
// The error test is the important one for T03/T04. A list component that
// renders a failed request as an empty list tells the user "nothing is
// coming" when the truth is "we don't know" -- and this is a screen people
// plan money around.
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import UpcomingRecurring, { groupByMonth, monthLabel } from "./UpcomingRecurring";
import {
  getUpcomingRecurring,
  getRecurringDefinition,
  pauseRecurringDefinition,
  endRecurringDefinition,
} from "../../api/recurringApi";

jest.mock("../../api/recurringApi", () => ({
  getUpcomingRecurring: jest.fn(),
  getRecurringDefinition: jest.fn(),
  pauseRecurringDefinition: jest.fn(),
  endRecurringDefinition: jest.fn(),
}));

function occurrence(overrides = {}) {
  return {
    recurringId: "rec1",
    expenseId: "exp1",
    expenseName: "Rent",
    expenseCategory: "Housing",
    expenseAmount: 12000,
    expenseAmountMinor: 1200000,
    dueDate: "2026-10-01T00:00:00.000Z",
    dueCalendarDate: "2026-10-01",
    expectedExpenseDate: "2026-10-01T00:00:00.000Z",
    overdue: false,
    ...overrides,
  };
}

function payload(occurrences, summaryOverrides = {}) {
  return {
    success: true,
    data: occurrences,
    summary: {
      count: occurrences.length,
      overdueCount: 0,
      definitionCount: occurrences.length ? 1 : 0,
      totalMinor: occurrences.reduce((s, o) => s + (o.expenseAmountMinor || 0), 0),
      timeZone: "Asia/Kolkata",
      ...summaryOverrides,
    },
    window: { from: "2026-09-30T00:00:00.000Z", to: "2026-12-31T00:00:00.000Z" },
    generatedAt: "2026-09-30T10:00:00.000Z",
  };
}

function renderUpcoming(props) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UpcomingRecurring {...props} />
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("ready state", () => {
  test("lists occurrences grouped by month, with amounts formatted", async () => {
    getUpcomingRecurring.mockResolvedValue(
      payload([
        occurrence(),
        occurrence({
          recurringId: "rec2",
          expenseName: "Internet",
          expenseCategory: "Utilities",
          expenseAmount: 799,
          expenseAmountMinor: 79900,
          dueDate: "2026-11-01T00:00:00.000Z",
          dueCalendarDate: "2026-11-01",
        }),
      ])
    );

    renderUpcoming();

    expect(await screen.findByText("Rent")).toBeInTheDocument();
    expect(screen.getByText("Internet")).toBeInTheDocument();
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    expect(screen.getByText("November 2026")).toBeInTheDocument();
    // Rendered through the shared formatter -- grouped, two decimals.
    expect(screen.getByText("₹12,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹799.00")).toBeInTheDocument();
  });

  test("shows the total from minor units, not a float sum", async () => {
    getUpcomingRecurring.mockResolvedValue(
      payload([
        occurrence({ expenseAmount: 40.3, expenseAmountMinor: 4030 }),
        occurrence({ recurringId: "rec2", expenseAmount: 0.7, expenseAmountMinor: 70 }),
      ])
    );

    renderUpcoming();

    // 4030 + 70 = 4100 paise = ₹41.00. A float sum would risk ₹41.000000000000004.
    expect(await screen.findByText("₹41.00")).toBeInTheDocument();
  });
});

describe("empty states are distinguished", () => {
  test("no recurring definitions at all says how to create one", async () => {
    getUpcomingRecurring.mockResolvedValue(payload([], { definitionCount: 0 }));

    renderUpcoming();

    expect(await screen.findByText(/haven't marked any expenses as recurring/i)).toBeInTheDocument();
  });

  test("definitions exist but none fall in the window says something different", async () => {
    // Collapsing these two into one blank panel tells the user nothing: the
    // first is fixed by setting a recurrence up, the second by looking
    // further ahead.
    getUpcomingRecurring.mockResolvedValue(payload([], { definitionCount: 3 }));

    renderUpcoming();

    expect(await screen.findByText(/nothing due in the next few months/i)).toBeInTheDocument();
    expect(screen.queryByText(/haven't marked any expenses/i)).not.toBeInTheDocument();
  });
});

describe("error state", () => {
  test("a failed request does NOT render as an empty schedule", async () => {
    // The single most important assertion in this file.
    getUpcomingRecurring.mockRejectedValue({
      response: { data: { message: "Internal Server Error" } },
    });

    renderUpcoming();

    expect(await screen.findByText("Internal Server Error")).toBeInTheDocument();
    expect(screen.queryByText(/nothing due/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/haven't marked any expenses/i)).not.toBeInTheDocument();
  });

  test("falls back to a readable message when the server sends none", async () => {
    getUpcomingRecurring.mockRejectedValue(new Error("Network Error"));

    renderUpcoming();

    expect(await screen.findByText(/couldn't load your upcoming recurring expenses/i)).toBeInTheDocument();
  });

  test("offers a retry that refetches", async () => {
    getUpcomingRecurring
      .mockRejectedValueOnce(new Error("Network Error"))
      .mockResolvedValueOnce(payload([occurrence()]));

    renderUpcoming();

    const retry = await screen.findByRole("button", { name: /try again/i });

    // The click handler fires load() without awaiting it, so the refetch
    // resolves after userEvent's own act() scope has closed. Wrapping both
    // the click and the resolution keeps that second state update inside
    // act rather than emitting a warning that would then sit in the output
    // masking a real one later.
    await act(async () => {
      await userEvent.click(retry);
    });

    expect(await screen.findByText("Rent")).toBeInTheDocument();
  });

  test("an aborted request is not shown as an error", async () => {
    // Unmounting or a superseding refetch is not a failure the user should see.
    const abort = new Error("canceled");
    abort.name = "CanceledError";
    getUpcomingRecurring.mockRejectedValue(abort);

    renderUpcoming();

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    });
  });
});

describe("stale state -- the schedule is behind", () => {
  test("warns when occurrences are overdue, and says what the dates mean", async () => {
    // These are dates in the past being shown under "upcoming". Without this
    // notice the list looks like a rendering bug; with it, it's information.
    getUpcomingRecurring.mockResolvedValue(
      payload(
        [occurrence({ overdue: true, dueCalendarDate: "2026-08-01", dueDate: "2026-08-01T00:00:00.000Z" })],
        { overdueCount: 2 }
      )
    );

    renderUpcoming();

    expect(await screen.findByText(/2 occurrences overdue/i)).toBeInTheDocument();
    expect(screen.getByText(/catches up one per day/i)).toBeInTheDocument();
  });

  test("singular wording for a single overdue occurrence", async () => {
    getUpcomingRecurring.mockResolvedValue(
      payload([occurrence({ overdue: true })], { overdueCount: 1 })
    );

    renderUpcoming();

    expect(await screen.findByText(/1 occurrence overdue/i)).toBeInTheDocument();
  });

  test("no warning when nothing is overdue", async () => {
    getUpcomingRecurring.mockResolvedValue(payload([occurrence()], { overdueCount: 0 }));

    renderUpcoming();

    await screen.findByText("Rent");
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });
});

describe("actions", () => {
  test("edit is offered and calls back with the expense id", async () => {
    const onEditExpense = jest.fn();
    getUpcomingRecurring.mockResolvedValue(payload([occurrence()]));

    renderUpcoming({ onEditExpense });

    await userEvent.click(await screen.findByRole("button", { name: /edit/i }));
    expect(onEditExpense).toHaveBeenCalledWith("exp1");
  });

  // REC-002/REC-003-T05 update: pause/end now exist and are wired to this
  // view. The old "no pause control is rendered" assertion documented a real
  // gap at the time (no lifecycle API existed) -- it is superseded here now
  // that one does.
  test("pause and end controls are offered on every row", async () => {
    getUpcomingRecurring.mockResolvedValue(payload([occurrence()]));

    renderUpcoming({ onEditExpense: jest.fn() });

    await screen.findByText("Rent");
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /end/i })).toBeInTheDocument();
    // Resume never appears here -- see this component's header comment on
    // why a paused definition has no row to attach one to.
    expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
  });

  test("pausing re-fetches the current scheduleVersion, then pauses, then reloads the list", async () => {
    getUpcomingRecurring
      .mockResolvedValueOnce(payload([occurrence()]))
      .mockResolvedValueOnce(payload([], { definitionCount: 0 }));
    getRecurringDefinition.mockResolvedValue({ success: true, data: { id: "rec1", scheduleVersion: 3 } });
    pauseRecurringDefinition.mockResolvedValue({ success: true, data: { id: "rec1", status: "paused" } });

    renderUpcoming();

    await userEvent.click(await screen.findByRole("button", { name: /pause/i }));

    await waitFor(() => expect(pauseRecurringDefinition).toHaveBeenCalledWith("rec1", 3));
    // The paused definition drops out of the next fetch -- the empty state
    // proves this component actually reloaded rather than just trusting a
    // local optimistic patch.
    expect(await screen.findByText(/haven't marked any expenses as recurring/i)).toBeInTheDocument();
  });

  test("ending requires confirmation before calling the API", async () => {
    getUpcomingRecurring.mockResolvedValue(payload([occurrence()]));
    getRecurringDefinition.mockResolvedValue({ success: true, data: { id: "rec1", scheduleVersion: 5 } });
    endRecurringDefinition.mockResolvedValue({ success: true, data: { id: "rec1", status: "ended" } });

    renderUpcoming();

    await userEvent.click(await screen.findByRole("button", { name: /end/i }));
    // Not called yet -- a confirmation dialog must appear first for a
    // terminal, unrecoverable action.
    expect(endRecurringDefinition).not.toHaveBeenCalled();

    await userEvent.click(await screen.findByRole("button", { name: /yes, end/i }));
    await waitFor(() => expect(endRecurringDefinition).toHaveBeenCalledWith("rec1", 5));
  });

  test("canceling the end confirmation does not call the API", async () => {
    getUpcomingRecurring.mockResolvedValue(payload([occurrence()]));

    renderUpcoming();

    await userEvent.click(await screen.findByRole("button", { name: /end/i }));
    await userEvent.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(endRecurringDefinition).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("date handling", () => {
  test("renders the server's calendar date rather than reformatting the instant", async () => {
    // The server sends dueCalendarDate already resolved in the app's time
    // zone. Formatting the ISO instant in the browser would show a viewer
    // west of UTC the previous day -- 30 September for a 1 October charge.
    getUpcomingRecurring.mockResolvedValue(
      payload([
        occurrence({ dueDate: "2026-10-01T00:00:00.000Z", dueCalendarDate: "2026-10-01" }),
      ])
    );

    renderUpcoming();

    expect(await screen.findByText("1 Oct")).toBeInTheDocument();
  });

  test("groupByMonth keeps the server's ordering and groups by calendar month", () => {
    const groups = groupByMonth([
      occurrence({ dueCalendarDate: "2026-10-01" }),
      occurrence({ recurringId: "b", dueCalendarDate: "2026-10-15" }),
      occurrence({ recurringId: "c", dueCalendarDate: "2026-11-01" }),
    ]);

    expect(groups.map((g) => g.monthKey)).toEqual(["2026-10", "2026-11"]);
    expect(groups[0].occurrences).toHaveLength(2);
  });

  test("monthLabel formats without a timezone shift", () => {
    expect(monthLabel("2026-01")).toBe("January 2026");
    expect(monthLabel("2026-12")).toBe("December 2026");
  });
});
