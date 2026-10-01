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
  skipRecurringOccurrence,
} from "../../api/recurringApi";

jest.mock("../../api/recurringApi", () => ({
  getUpcomingRecurring: jest.fn(),
  getRecurringDefinition: jest.fn(),
  pauseRecurringDefinition: jest.fn(),
  endRecurringDefinition: jest.fn(),
  skipRecurringOccurrence: jest.fn(),
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

describe("forecast-only row presentation", () => {
  test("rows do not render Edit, Pause, Resume, or End action buttons (managed in Master section)", async () => {
    getUpcomingRecurring.mockResolvedValue(payload([occurrence()]));

    renderUpcoming();

    await screen.findByText("Rent");
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /end/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
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

describe("cache invalidation sync with master recurring management", () => {
  test("invalidating recurring queries automatically refetches upcoming list (e.g. on pause or resume)", async () => {
    getUpcomingRecurring
      .mockResolvedValueOnce(payload([occurrence({ expenseName: "Netflix" })]))
      .mockResolvedValueOnce(payload([]));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <UpcomingRecurring />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Netflix")).toBeInTheDocument();

    // Simulating mutation in Section 2 (which invalidates queryKeys.recurring.all)
    await act(async () => {
      queryClient.invalidateQueries({ queryKey: ["recurring"] });
    });

    // Upcoming list updates immediately to reflect the change
    await waitFor(() => {
      expect(screen.queryByText("Netflix")).not.toBeInTheDocument();
    });
  });
});

describe("skip action", () => {
  test("renders Skip button on each occurrence row", async () => {
    getUpcomingRecurring.mockResolvedValue(
      payload([
        occurrence({ expenseName: "Recharge", dueCalendarDate: "2026-10-01" }),
        occurrence({ expenseName: "Train Ticket", dueCalendarDate: "2026-11-01" }),
      ])
    );

    renderUpcoming();

    const skipButtons = await screen.findAllByRole("button", { name: /^Skip/i });
    expect(skipButtons).toHaveLength(2);
  });

  test("clicking Skip opens the confirmation modal with occurrence details", async () => {
    getUpcomingRecurring.mockResolvedValue(
      payload([
        occurrence({
          expenseName: "Recharge",
          expenseAmount: 300,
          expenseAmountMinor: 30000,
          dueCalendarDate: "2026-12-01",
        }),
      ])
    );

    renderUpcoming();

    const skipButton = await screen.findByRole("button", { name: /^Skip/i });
    await userEvent.click(skipButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Skip This Month?")).toBeInTheDocument();
    expect(screen.getByText(/Skip this month's expense only/i)).toBeInTheDocument();
  });

  test("clicking Cancel closes the modal without calling the API", async () => {
    getUpcomingRecurring.mockResolvedValue(
      payload([occurrence({ expenseName: "Recharge", dueCalendarDate: "2026-12-01" })])
    );

    renderUpcoming();

    const skipButton = await screen.findByRole("button", { name: /^Skip/i });
    await userEvent.click(skipButton);

    const cancelButton = screen.getByRole("button", { name: /Cancel/i });
    await userEvent.click(cancelButton);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(skipRecurringOccurrence).not.toHaveBeenCalled();
  });

  test("confirming skip calls skipRecurringOccurrence and invalidates query", async () => {
    getUpcomingRecurring
      .mockResolvedValueOnce(
        payload([
          occurrence({
            recurringId: "rec-recharge",
            expenseName: "Recharge",
            dueCalendarDate: "2026-12-01",
            scheduleVersion: 1,
          }),
        ])
      )
      .mockResolvedValueOnce(payload([]));

    skipRecurringOccurrence.mockResolvedValue({
      success: true,
      data: { id: "rec-recharge", skippedDates: ["2026-12-01"] },
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <UpcomingRecurring />
      </QueryClientProvider>
    );

    const skipButton = await screen.findByRole("button", { name: /^Skip/i });
    await userEvent.click(skipButton);

    const confirmButton = screen.getByRole("button", { name: /Skip this month/i });
    await userEvent.click(confirmButton);

    await waitFor(() => {
      expect(skipRecurringOccurrence).toHaveBeenCalledWith("rec-recharge", "2026-12-01", 1);
    });

    // The occurrence is refetched and removed
    await waitFor(() => {
      expect(screen.queryByText("Recharge")).not.toBeInTheDocument();
    });
  });
});

