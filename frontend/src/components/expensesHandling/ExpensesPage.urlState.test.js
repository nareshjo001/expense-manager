// EXP-002-T06 -- ExpensesPage persists its view-defining state (filter
// mode, period, custom date range, and the EXP-002-T01/T05 search
// filters) to the URL and reads it back on mount, so a bookmarked or
// shared link reproduces the same view. Dedicated to that sync only --
// ExpensesPage.test.js/.customInfiniteScroll.test.js/.errorState.test.js/
// .searchFilters.test.js cover everything else and mock useSearchParams
// with a static, inert pair since they don't exercise this.
import React from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import ExpensesPage from "./ExpensesPage";
import { useExpensesQuery } from "../../hooks/queries/useExpensesQuery";
import { useInfiniteExpensesQuery } from "../../hooks/queries/useInfiniteExpensesQuery";
import { useExpenseInsights } from "../contexts/ai-contexts/ExpenseInsightsContext";
import { useSearchParams } from "react-router-dom";

jest.mock("framer-motion", () => ({
  motion: { p: ({ children }) => <p>{children}</p> },
}));

jest.mock("../imports/expensesImport", () => ({
  ExpenseItem: ({ expense }) => <div>{expense.expenseName}</div>,
  SetBudget: () => <div />,
  formatDateRange: (start, end) => `${start} to ${end}`,
}));

jest.mock("../../hooks/queries/useExpensesQuery", () => ({
  useExpensesQuery: jest.fn(),
}));

jest.mock("../../hooks/queries/useInfiniteExpensesQuery", () => ({
  useInfiniteExpensesQuery: jest.fn(),
}));

jest.mock("../contexts/ai-contexts/ExpenseInsightsContext", () => ({
  useExpenseInsights: jest.fn(),
}));

jest.mock("../insights/InlineExpenseInsight", () => () => null);

// BUD-001-T05 -- CategoryBudgets has its own suite (budget/CategoryBudgets.test.js)
// and needs a QueryClientProvider; not under test here.
jest.mock("./budget/CategoryBudgets", () => () => null);

// A controllable pair (unlike the other ExpensesPage test files' static
// inert mock): lets each test supply the URL ExpensesPage should read on
// mount, and inspect what it writes back.
jest.mock("react-router-dom", () => ({
  useSearchParams: jest.fn(),
}), { virtual: true });

const inertInfiniteQueryResult = {
  data: undefined,
  isLoading: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: jest.fn(),
  refetch: jest.fn(),
};

// Mirrors ExpensesPage's own one-way sync: setSearchParams is called with
// a real URLSearchParams instance, so read it back the same way a caller
// (or react-router) would.
function paramsFromLastCall(setSearchParamsMock) {
  const calls = setSearchParamsMock.mock.calls;
  const [params] = calls[calls.length - 1];
  return Object.fromEntries(params.entries());
}

function renderWithUrl(initialQuery = "") {
  const setSearchParams = jest.fn();
  useSearchParams.mockReturnValue([new URLSearchParams(initialQuery), setSearchParams]);
  const utils = render(<ExpensesPage onDelete={jest.fn()} setIsEdit={jest.fn()} />);
  return { ...utils, setSearchParams };
}

describe("ExpensesPage -- EXP-002-T06 URL persistence", () => {
  beforeEach(() => {
    useInfiniteExpensesQuery.mockReturnValue(inertInfiniteQueryResult);
    useExpenseInsights.mockReturnValue({
      notifyInitialLoad: jest.fn(),
      notifyFilterApplied: jest.fn(),
      clearExpenseInsights: jest.fn(),
      insightText: [],
      isInsightReady: false,
    });
    useExpensesQuery.mockReturnValue({ data: undefined, isLoading: false, isError: false, dataUpdatedAt: 0, refetch: jest.fn() });
  });

  afterEach(() => {
    cleanup();
    useInfiniteExpensesQuery.mockClear();
  });

  it("reproduces a shared custom-mode link on first render, with no click-through needed", () => {
    renderWithUrl("mode=custom&start=2026-01-01&end=2026-01-31&name=coffee&category=Groceries&min=10&max=100&recurring=true");

    // Custom mode with a full range is active immediately -- the
    // choose-a-range overlay never appears, and the filter bar is already
    // populated from the URL.
    expect(screen.queryByText("Choose the custom date range...")).not.toBeInTheDocument();
    expect(screen.getByRole("search", { name: "Filter expenses" })).toBeInTheDocument();
    expect(screen.getByLabelText("Search by expense name")).toHaveValue("coffee");
    expect(screen.getByLabelText("Filter by category")).toHaveValue("Groceries");
    expect(screen.getByLabelText("Minimum amount")).toHaveValue(10);
    expect(screen.getByLabelText("Maximum amount")).toHaveValue(100);
    expect(screen.getByLabelText("Filter by recurring status")).toHaveValue("true");

    const calls = useInfiniteExpensesQuery.mock.calls;
    const [calledStart, calledEnd, calledEnabled, calledFilters] = calls[calls.length - 1];
    expect(calledStart).toBe("2026-01-01");
    expect(calledEnd).toBe("2026-01-31");
    expect(calledEnabled).toBe(true);
    expect(calledFilters).toEqual({
      nameContains: "coffee",
      category: "Groceries",
      minAmount: 10,
      maxAmount: 100,
      isRecurring: true,
    });
  });

  it("reproduces a by-category link on first render", () => {
    renderWithUrl("mode=bycategory&period=thisyear");

    expect(screen.getByDisplayValue("This Year")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Category")).toBeInTheDocument();
  });

  it("ignores unrecognized mode/period/recurring values from a hand-edited or stale URL", () => {
    renderWithUrl("mode=bogus&period=lastdecade&recurring=maybe");

    // Falls back to the default view, exactly as if the URL were empty.
    expect(screen.getByDisplayValue("Filter By")).toBeInTheDocument();
    expect(screen.queryByRole("search", { name: "Filter expenses" })).not.toBeInTheDocument();
  });

  it("writes an empty URL for the default view", () => {
    const { setSearchParams } = renderWithUrl("");

    expect(paramsFromLastCall(setSearchParams)).toEqual({});
    expect(setSearchParams.mock.calls[setSearchParams.mock.calls.length - 1][1]).toEqual({ replace: true });
  });

  it("writes mode/start/end and the active search filters once a custom search is built up", () => {
    const { setSearchParams } = renderWithUrl("");

    fireEvent.change(screen.getByDisplayValue("Filter By"), { target: { value: "custom" } });
    const dateInputs = document.querySelectorAll('input[type="date"]');
    fireEvent.change(dateInputs[0], { target: { value: "2026-03-01" } });
    fireEvent.change(dateInputs[1], { target: { value: "2026-03-31" } });
    fireEvent.change(screen.getByLabelText("Search by expense name"), { target: { value: "  rent  " } });
    fireEvent.change(screen.getByLabelText("Minimum amount"), { target: { value: "500" } });

    expect(paramsFromLastCall(setSearchParams)).toEqual({
      mode: "custom",
      start: "2026-03-01",
      end: "2026-03-31",
      name: "rent",
      min: "500",
    });
  });

  it("omits start/end/search-filter params for the by-category mode", () => {
    const { setSearchParams } = renderWithUrl("");

    fireEvent.change(screen.getByDisplayValue("Filter By"), { target: { value: "bycategory" } });
    fireEvent.change(screen.getByDisplayValue("View By"), { target: { value: "thismonth" } });

    expect(paramsFromLastCall(setSearchParams)).toEqual({ mode: "bycategory", period: "thismonth" });
  });
});
