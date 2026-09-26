// BUD-001-T05 -- CategoryBudgets UI. The api module is mocked (not axios) and
// the real query/mutation hooks run inside a fresh QueryClientProvider, so
// cache keys, the upsert/delete flows and the summary write-back are all
// exercised end to end on the client.
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { format } from "date-fns";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CategoryBudgets from "./CategoryBudgets";
import {
  getCategoryBudgets,
  saveCategoryBudget,
  deleteCategoryBudget,
} from "../../../api/categoryBudgetApi";

jest.mock("../../../api/categoryBudgetApi", () => ({
  getCategoryBudgets: jest.fn(),
  saveCategoryBudget: jest.fn(),
  deleteCategoryBudget: jest.fn(),
}));

const CURRENT_MONTH = format(new Date(), "yyyy-MM");

const makeRow = (overrides = {}) => ({
  id: "cb-food",
  category: "Food",
  amountMinor: 500000,
  spentMinor: 200000,
  remainingMinor: 300000,
  utilization: 40,
  status: "Safe",
  projectedSpentMinor: 400000,
  projectedStatus: "Warning",
  atRisk: false,
  ...overrides,
});

const makeTotals = (overrides = {}) => ({
  totalBudgetMinor: 2000000,
  allocatedMinor: 500000,
  unallocatedMinor: 1500000,
  overAllocated: false,
  overAllocatedByMinor: 0,
  budgetedSpentMinor: 200000,
  unbudgetedSpentMinor: 0,
  totalSpentMinor: 200000,
  ...overrides,
});

const makeSummary = ({ totals, ...overrides } = {}) => ({
  month: CURRENT_MONTH,
  writable: true,
  rolloverPolicy: "none",
  asOfDate: "2026-09-26T00:00:00.000Z",
  totals: makeTotals(totals),
  categories: [makeRow()],
  unbudgetedCategories: [],
  ...overrides,
});

const envelope = (summary) => ({ success: true, contractVersion: 1, data: summary });

const apiError = (status, errorCode, message = "Rejected", field) => ({
  response: { status, data: { success: false, message, errorCode, field } },
});

function renderComponent() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CategoryBudgets />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("CategoryBudgets -- query states", () => {
  it("shows a loading state while the summary is fetching", () => {
    getCategoryBudgets.mockReturnValue(new Promise(() => {}));
    renderComponent();
    expect(screen.getByRole("status")).toHaveTextContent(/loading category budgets/i);
  });

  it("shows an error with a working Retry", async () => {
    getCategoryBudgets
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(envelope(makeSummary()));
    renderComponent();

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load category budgets/i);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    expect(await screen.findByText("Food")).toBeInTheDocument();
    expect(getCategoryBudgets).toHaveBeenCalledTimes(2);
  });

  it("explains the empty state and still offers the form", async () => {
    getCategoryBudgets.mockResolvedValue(
      envelope(makeSummary({ categories: [], totals: { allocatedMinor: 0, unallocatedMinor: 2000000 } }))
    );
    renderComponent();

    expect(await screen.findByText(/no category budgets for .* yet/i)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: /add category budget/i })).toBeInTheDocument();
    expect(screen.getByText(/unspent amounts don't carry over to next month/i)).toBeInTheDocument();
  });

  it("requests the current month by default", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary()));
    renderComponent();
    await screen.findByText("Food");
    expect(getCategoryBudgets).toHaveBeenCalledWith(CURRENT_MONTH, expect.anything());
    expect(screen.getByLabelText("Month")).toHaveValue(CURRENT_MONTH);
  });
});

describe("CategoryBudgets -- rows and totals", () => {
  it("renders each row with status text, figures and an accessible progress bar", async () => {
    getCategoryBudgets.mockResolvedValue(
      envelope(
        makeSummary({
          categories: [
            makeRow({
              id: "cb-travel",
              category: "Travel",
              amountMinor: 100000,
              spentMinor: 125000,
              remainingMinor: -25000,
              utilization: 125,
              status: "Overspent",
              atRisk: false,
            }),
            makeRow(),
          ],
        })
      )
    );
    renderComponent();

    const travelBar = await screen.findByRole("progressbar", { name: /travel budget used/i });
    expect(travelBar).toHaveAttribute("aria-valuenow", "100");
    expect(travelBar).toHaveAttribute("aria-valuemin", "0");
    expect(travelBar).toHaveAttribute("aria-valuemax", "100");
    expect(travelBar).toHaveAttribute("aria-valuetext", expect.stringMatching(/125% used, Overspent/));

    const foodBar = screen.getByRole("progressbar", { name: /food budget used/i });
    expect(foodBar).toHaveAttribute("aria-valuenow", "40");

    const rows = within(screen.getByRole("list", { name: "Category budgets" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Overspent")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Over by")).toBeInTheDocument();
    expect(within(rows[0]).getByText("₹250.00")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Safe")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Remaining")).toBeInTheDocument();
    expect(within(rows[1]).getByText("₹3,000.00")).toBeInTheDocument();

    expect(screen.getByText(/₹15,000.00 unallocated/)).toBeInTheDocument();
  });

  it("shows the at-risk hint with the projection", async () => {
    getCategoryBudgets.mockResolvedValue(
      envelope(
        makeSummary({
          categories: [
            makeRow({ status: "Warning", utilization: 80, atRisk: true, projectedSpentMinor: 650000, projectedStatus: "Overspent" }),
          ],
        })
      )
    );
    renderComponent();
    expect(await screen.findByText(/on pace to exceed this budget/i)).toHaveTextContent(
      /projected ₹6,500.00 by month end/
    );
  });

  it("warns clearly when over-allocated", async () => {
    getCategoryBudgets.mockResolvedValue(
      envelope(
        makeSummary({
          totals: {
            totalBudgetMinor: 400000,
            allocatedMinor: 500000,
            unallocatedMinor: 0,
            overAllocated: true,
            overAllocatedByMinor: 100000,
          },
        })
      )
    );
    renderComponent();
    expect(await screen.findByText(/over-allocated by ₹1,000.00/i)).toBeInTheDocument();
    expect(screen.queryByText(/unallocated\)/)).not.toBeInTheDocument();
  });

  it("says no monthly total is set when totalBudgetMinor is null", async () => {
    getCategoryBudgets.mockResolvedValue(
      envelope(
        makeSummary({
          totals: { totalBudgetMinor: null, unallocatedMinor: null, unbudgetedSpentMinor: 30000 },
          unbudgetedCategories: [{ category: "Shopping", spentMinor: 30000 }],
        })
      )
    );
    renderComponent();
    expect(await screen.findByText(/no monthly total budget is set/i)).toHaveTextContent(
      /category budgets still work/i
    );
    expect(screen.getByRole("heading", { name: /unbudgeted spending: ₹300.00/i })).toBeInTheDocument();
    expect(
      within(screen.getByRole("list", { name: /unbudgeted spending by category/i })).getByText(/Shopping: ₹300.00/)
    ).toBeInTheDocument();
  });

  it("hides every edit control for a read-only month", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary({ month: "2025-01", writable: false })));
    renderComponent();

    expect(await screen.findByText(/january 2025 is read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /food budget used/i })).toBeInTheDocument();
  });
});

describe("CategoryBudgets -- writes", () => {
  it("creates a budget via PUT with { month, category, amount }", async () => {
    getCategoryBudgets.mockResolvedValue(
      envelope(makeSummary({ unbudgetedCategories: [{ category: "Travel", spentMinor: 1000 }] }))
    );
    const updated = makeSummary({
      categories: [makeRow(), makeRow({ id: "cb-travel", category: "Travel", amountMinor: 150050 })],
    });
    saveCategoryBudget.mockResolvedValue({
      success: true,
      contractVersion: 1,
      data: { budget: { id: "cb-travel", category: "Travel", created: true }, summary: updated },
    });
    renderComponent();
    await screen.findByText("Food");

    const submit = screen.getByRole("button", { name: /add budget/i });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: " Travel " } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "1500.50" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() =>
      expect(saveCategoryBudget).toHaveBeenCalledWith({
        month: CURRENT_MONTH,
        category: "Travel",
        amount: "1500.50",
      })
    );
    expect(await screen.findByRole("status")).toHaveTextContent(/saved the travel budget/i);
    // The returned summary is written into the cache -- no refetch needed.
    expect(await screen.findByRole("progressbar", { name: /travel budget used/i })).toBeInTheDocument();
    expect(getCategoryBudgets).toHaveBeenCalledTimes(1);
  });

  it("edits an existing budget through the same PUT upsert", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary()));
    saveCategoryBudget.mockResolvedValue({
      success: true,
      contractVersion: 1,
      data: { budget: { id: "cb-food", category: "Food", created: false }, summary: makeSummary() },
    });
    renderComponent();

    fireEvent.click(await screen.findByRole("button", { name: /edit food budget/i }));
    expect(screen.getByRole("form", { name: /edit category budget/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toHaveValue("Food");
    expect(screen.getByLabelText(/amount/i)).toHaveValue(5000);

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "6000" } });
    fireEvent.click(screen.getByRole("button", { name: /update budget/i }));

    await waitFor(() =>
      expect(saveCategoryBudget).toHaveBeenCalledWith({
        month: CURRENT_MONTH,
        category: "Food",
        amount: "6000",
      })
    );
  });

  it("requires an inline confirmation before calling DELETE", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary()));
    deleteCategoryBudget.mockResolvedValue({
      success: true,
      contractVersion: 1,
      data: { deletedId: "cb-food", summary: makeSummary({ categories: [] }) },
    });
    renderComponent();

    fireEvent.click(await screen.findByRole("button", { name: /delete food budget/i }));
    expect(deleteCategoryBudget).not.toHaveBeenCalled();

    // Cancel backs out without deleting.
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(deleteCategoryBudget).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /delete food budget/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

    await waitFor(() => expect(deleteCategoryBudget).toHaveBeenCalledWith("cb-food"));
    expect(await screen.findByText(/no category budgets for .* yet/i)).toBeInTheDocument();
  });

  it("shows an inline message for a 409 CATEGORY_BUDGET_EXCEEDS_TOTAL", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary()));
    saveCategoryBudget.mockRejectedValue(apiError(409, "CATEGORY_BUDGET_EXCEEDS_TOTAL", "Exceeds", "amount"));
    renderComponent();
    await screen.findByText("Food");

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Travel" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "999999" } });
    fireEvent.click(screen.getByRole("button", { name: /add budget/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /would allocate more than your monthly total budget/i
    );
    expect(screen.getByLabelText(/amount/i)).toHaveAttribute("aria-invalid", "true");
    // The user's input is kept so they can adjust it.
    expect(screen.getByLabelText("Category")).toHaveValue("Travel");
  });

  it.each([
    ["TOO_MANY_CATEGORY_BUDGETS", 409, /maximum number of category budgets/i],
    ["RESERVED_CATEGORY", 400, /"uncategorized" can't have a budget/i],
    ["MONTH_NOT_WRITABLE", 400, /this month is read-only/i],
    ["AMOUNT_OUT_OF_RANGE", 400, /too large/i],
    ["INVALID_AMOUNT", 400, /at most 2 decimal places/i],
  ])("maps %s to a friendly inline message", async (code, status, expected) => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary()));
    saveCategoryBudget.mockRejectedValue(apiError(status, code));
    renderComponent();
    await screen.findByText("Food");

    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Travel" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /add budget/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(expected);
  });
});

describe("CategoryBudgets -- month selection", () => {
  it("refetches with the newly selected month", async () => {
    getCategoryBudgets.mockImplementation((month) =>
      Promise.resolve(
        envelope(
          month === "2025-03"
            ? makeSummary({ month, writable: false, categories: [makeRow({ id: "cb-rent", category: "Rent" })] })
            : makeSummary()
        )
      )
    );
    renderComponent();
    await screen.findByText("Food");

    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2025-03" } });

    expect(await screen.findByText("Rent")).toBeInTheDocument();
    expect(getCategoryBudgets).toHaveBeenLastCalledWith("2025-03", expect.anything());
    expect(screen.getByText(/march 2025 is read-only/i)).toBeInTheDocument();
  });
});
