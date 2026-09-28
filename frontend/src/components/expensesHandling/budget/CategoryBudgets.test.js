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
import userEvent from "@testing-library/user-event";
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

    // Rows are an accordion: only the first starts open.
    expect(screen.queryByRole("progressbar", { name: /food budget used/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^food/i }));
    const foodBar = screen.getByRole("progressbar", { name: /food budget used/i });
    expect(foodBar).toHaveAttribute("aria-valuenow", "40");
    expect(foodBar).toHaveAttribute("aria-valuetext", expect.stringMatching(/40% used, Safe/));

    const rows = within(screen.getByRole("list", { name: "Category budgets" })).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Overspent")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Over by")).toBeInTheDocument();
    expect(within(rows[0]).getByText("₹250.00")).toBeInTheDocument();
    // Safe is shown as "On track"; the backend value stays in the bar's value text.
    expect(within(rows[1]).getByText("On track")).toBeInTheDocument();
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

describe("CategoryBudgets -- category suggestions", () => {
  it("anchors the portaled menu above the input at desktop and mobile sizes", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary()));
    renderComponent();
    const input = await screen.findByRole("combobox", { name: "Category" });
    const originalHeight = window.innerHeight;
    let inputRect = { top: 700, bottom: 748, left: 120, width: 300 };
    input.getBoundingClientRect = jest.fn(() => inputRect);

    try {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 900 });
      fireEvent.focus(input);
      const menu = screen.getByRole("listbox", { name: "Category suggestions" });
      expect(menu.parentElement).toBe(document.body);
      expect(menu).toHaveStyle({ bottom: "206px", left: "120px", width: "300px", maxHeight: "174px" });
      expect(menu.style.top).toBe("");

      inputRect = { top: 500, bottom: 548, left: 18, width: 340 };
      Object.defineProperty(window, "innerHeight", { configurable: true, value: 640 });
      fireEvent.resize(window);
      expect(menu).toHaveStyle({ bottom: "146px", left: "18px", width: "340px", maxHeight: "174px" });
    } finally {
      Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight });
    }
  });

  it("keeps suggestions beyond the first four available for scrolling and keyboard selection", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary({
      unbudgetedCategories: ["Bills", "Entertainment", "Essentials", "Travel", "Shopping"]
        .map((category) => ({ category, spentMinor: 1000 })),
    })));
    renderComponent();
    const input = await screen.findByRole("combobox", { name: "Category" });
    fireEvent.focus(input);
    const menu = screen.getByRole("listbox", { name: "Category suggestions" });
    expect(within(menu).getAllByRole("option")).toHaveLength(6);

    for (let index = 0; index < 5; index += 1) {
      fireEvent.keyDown(input, { key: "ArrowDown" });
    }
    expect(within(menu).getAllByRole("option")[4]).toHaveAttribute("aria-selected", "true");
  });

  it("uses distinct selected-month categories, filters them, and allows a new name", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary({
      unbudgetedCategories: [
        { category: "Travel", spentMinor: 1000 },
        { category: "food", spentMinor: 500 },
        { category: "Uncategorized", spentMinor: 200 },
      ],
    })));
    renderComponent();
    const input = await screen.findByRole("combobox", { name: "Category" });
    fireEvent.focus(input);

    const menu = screen.getByRole("listbox", { name: "Category suggestions" });
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-controls", menu.id);
    expect(within(menu).getAllByRole("option")).toHaveLength(2);
    expect(within(menu).queryByRole("option", { name: /uncategorized/i })).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "tra" } });
    expect(within(menu).getAllByRole("option")).toHaveLength(1);
    expect(within(menu).getByRole("option", { name: "Travel" })).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "New custom category" } });
    expect(within(menu).queryByRole("option")).not.toBeInTheDocument();
    expect(within(menu).getByText(/you can use your typed category/i)).toBeInTheDocument();
    expect(input).toHaveValue("New custom category");
  });

  it("supports arrow keys, Enter, Escape, Tab, and outside clicks", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary({
      unbudgetedCategories: [{ category: "Travel", spentMinor: 1000 }],
    })));
    renderComponent();
    const input = await screen.findByRole("combobox", { name: "Category" });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", expect.stringContaining("option-0"));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: "Travel" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getByRole("option", { name: "Food" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("Food");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(saveCategoryBudget).not.toHaveBeenCalled();

    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.focus(input);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selects by click without submitting and keeps edit mode read-only", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary({
      unbudgetedCategories: [{ category: "Travel", spentMinor: 1000 }],
    })));
    renderComponent();
    const input = await screen.findByRole("combobox", { name: "Category" });
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("option", { name: "Travel" }));
    expect(input).toHaveValue("Travel");
    expect(saveCategoryBudget).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /edit food budget/i }));
    expect(input).toHaveValue("Food");
    expect(input).toHaveAttribute("readonly");
    fireEvent.focus(input);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("submits a typed category with no matching suggestion", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(makeSummary()));
    saveCategoryBudget.mockResolvedValue({
      success: true,
      data: { budget: { category: "New custom category" }, summary: makeSummary() },
    });
    renderComponent();
    const input = await screen.findByRole("combobox", { name: "Category" });
    fireEvent.change(input, { target: { value: "New custom category" } });
    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "25" } });
    expect(screen.getByText(/you can use your typed category/i)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.submit(screen.getByRole("form", { name: /add category budget/i }));
    await waitFor(() => expect(saveCategoryBudget).toHaveBeenCalledWith({
      month: CURRENT_MONTH,
      category: "New custom category",
      amount: "25",
    }));
  });

  it("updates suggestions when the selected month changes", async () => {
    getCategoryBudgets.mockImplementation((selectedMonth) => Promise.resolve(envelope(
      makeSummary({
        month: selectedMonth,
        categories: [makeRow({ category: selectedMonth === CURRENT_MONTH ? "Food" : "Travel" })],
      })
    )));
    renderComponent();
    const input = await screen.findByRole("combobox", { name: "Category" });
    fireEvent.focus(input);
    expect(screen.getByRole("option", { name: "Food" })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Foo" } });

    const nextMonth = format(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1), "yyyy-MM");
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: nextMonth } });
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Category" })).toHaveValue(""));
    fireEvent.focus(screen.getByRole("combobox", { name: "Category" }));
    expect(await screen.findByRole("option", { name: "Travel" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Food" })).not.toBeInTheDocument();
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

describe("CategoryBudgets -- populated list accordion", () => {
  const threeRows = () =>
    makeSummary({
      categories: [
        makeRow({ id: "cb-ess", category: "Essentials", status: "Warning", utilization: 82 }),
        makeRow({ id: "cb-food", category: "Food", status: "Critical", utilization: 95 }),
        makeRow({ id: "cb-bus", category: "Transport", status: "Safe", utilization: 24 }),
      ],
    });

  it("opens the first real row by default and wires aria-expanded/aria-controls", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(threeRows()));
    renderComponent();

    const first = await screen.findByRole("button", { name: /^essentials/i });
    const second = screen.getByRole("button", { name: /^food/i });
    const third = screen.getByRole("button", { name: /^transport/i });
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "false");
    expect(third).toHaveAttribute("aria-expanded", "false");

    const panel = document.getElementById(first.getAttribute("aria-controls"));
    expect(panel).not.toBeNull();
    expect(panel).not.toHaveAttribute("hidden");
    expect(document.getElementById(second.getAttribute("aria-controls"))).toHaveAttribute("hidden");
    expect(screen.getByRole("heading", { name: "Category Budgets", level: 3 })).toBeInTheDocument();
    expect(screen.getByText(/tap a category to view details and actions/i)).toBeInTheDocument();
  });

  it("expands one row at a time and collapses on a second activation", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(threeRows()));
    renderComponent();

    const first = await screen.findByRole("button", { name: /^essentials/i });
    const second = screen.getByRole("button", { name: /^food/i });

    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(first).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /edit food budget/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit essentials budget/i })).not.toBeInTheDocument();

    fireEvent.click(second);
    expect(second).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("toggles with Enter and Space from the keyboard", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(threeRows()));
    renderComponent();

    const third = await screen.findByRole("button", { name: /^transport/i });
    third.focus();
    userEvent.keyboard("{Enter}");
    expect(third).toHaveAttribute("aria-expanded", "true");
    userEvent.keyboard(" ");
    expect(third).toHaveAttribute("aria-expanded", "false");
  });

  it("shows distinct status labels and keeps Safe as the underlying value", async () => {
    getCategoryBudgets.mockResolvedValue(envelope(threeRows()));
    renderComponent();

    await screen.findByText("Essentials");
    expect(screen.getByText("Warning")).toHaveClass("category-budget-status--warning");
    expect(screen.getByText("Critical")).toHaveClass("category-budget-status--critical");
    expect(screen.getByText("On track")).toHaveClass("category-budget-status--safe");
    expect(screen.queryByText("Safe")).not.toBeInTheDocument();
  });

  it("falls back to the first row after the open row is deleted", async () => {
    const afterDelete = makeSummary({
      categories: [
        makeRow({ id: "cb-ess", category: "Essentials", status: "Warning" }),
        makeRow({ id: "cb-bus", category: "Transport" }),
      ],
    });
    getCategoryBudgets
      .mockResolvedValueOnce(envelope(threeRows()))
      .mockResolvedValue(envelope(afterDelete));
    deleteCategoryBudget.mockResolvedValue({
      success: true,
      contractVersion: 1,
      data: { deletedId: "cb-food", summary: afterDelete },
    });
    renderComponent();

    fireEvent.click(await screen.findByRole("button", { name: /^food/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete food budget/i }));
    fireEvent.click(screen.getByRole("button", { name: /confirm delete/i }));

    await waitFor(() => expect(screen.queryByText("Food")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: /^essentials/i })).toHaveAttribute("aria-expanded", "true");
  });

  it("resets to the first row when the month changes", async () => {
    getCategoryBudgets.mockImplementation((month) =>
      Promise.resolve(envelope(month === "2025-03"
        ? makeSummary({ month, writable: false, categories: [
            makeRow({ id: "cb-rent", category: "Rent" }),
            makeRow({ id: "cb-gym", category: "Gym" }),
          ] })
        : threeRows()))
    );
    renderComponent();

    fireEvent.click(await screen.findByRole("button", { name: /^transport/i }));
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2025-03" } });

    const rent = await screen.findByRole("button", { name: /^rent/i });
    expect(rent).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^gym/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/^tap a category to view details\.$/i)).toBeInTheDocument();
  });
});
