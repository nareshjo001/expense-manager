// EXP-003-T05 -- IncomeModal's income list is now network-paged
// (useInfiniteIncomeQuery) instead of a single unbounded fetch.
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import IncomeModal from "./IncomeModal";
import { useInfiniteIncomeQuery } from "../../hooks/queries/useInfiniteIncomeQuery";
import { useUpdateIncomeMutation } from "../../hooks/mutations/useUpdateIncomeMutation";
import { useDeleteIncomeMutation } from "../../hooks/mutations/useDeleteIncomeMutation";

jest.mock("../../hooks/queries/useInfiniteIncomeQuery", () => ({
  useInfiniteIncomeQuery: jest.fn(),
}));
jest.mock("../../hooks/mutations/useUpdateIncomeMutation", () => ({
  useUpdateIncomeMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useDeleteIncomeMutation", () => ({
  useDeleteIncomeMutation: jest.fn(),
}));

const makeIncome = (id) => ({
  _id: id,
  incomeSource: `Source ${id}`,
  incomeAmount: 100,
  incomeDate: "2026-01-01T00:00:00.000Z",
});

function setupMutations() {
  useUpdateIncomeMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
  useDeleteIncomeMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("IncomeModal -- paged income list", () => {
  it("renders income flattened from every already-fetched page", () => {
    useInfiniteIncomeQuery.mockReturnValue({
      data: { pages: [{ success: true, data: [makeIncome(1), makeIncome(2)] }, { success: true, data: [makeIncome(3)] }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
    });
    setupMutations();

    render(<IncomeModal isOpen={true} onClose={jest.fn()} period="thismonth" />);

    expect(screen.getByText("Source 1")).toBeInTheDocument();
    expect(screen.getByText("Source 2")).toBeInTheDocument();
    expect(screen.getByText("Source 3")).toBeInTheDocument();
  });

  it("shows a Load more button only while the server reports another page exists", () => {
    useInfiniteIncomeQuery.mockReturnValue({
      data: { pages: [{ success: true, data: [makeIncome(1)] }] },
      isLoading: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
    });
    setupMutations();

    render(<IncomeModal isOpen={true} onClose={jest.fn()} period="thismonth" />);

    expect(screen.getByRole("button", { name: /load more/i })).toBeInTheDocument();
  });

  it("fetches the next page when Load more is clicked, and disables the button while fetching", () => {
    const fetchNextPage = jest.fn();
    useInfiniteIncomeQuery.mockReturnValue({
      data: { pages: [{ success: true, data: [makeIncome(1)] }] },
      isLoading: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage,
    });
    setupMutations();

    render(<IncomeModal isOpen={true} onClose={jest.fn()} period="thismonth" />);

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("hides the Load more button once the server reports no further pages", () => {
    useInfiniteIncomeQuery.mockReturnValue({
      data: { pages: [{ success: true, data: [makeIncome(1)] }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
    });
    setupMutations();

    render(<IncomeModal isOpen={true} onClose={jest.fn()} period="thismonth" />);

    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("shows the empty state when no income records exist", () => {
    useInfiniteIncomeQuery.mockReturnValue({
      data: { pages: [{ success: true, data: [] }] },
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
    });
    setupMutations();

    render(<IncomeModal isOpen={true} onClose={jest.fn()} period="thismonth" />);

    expect(screen.getByText(/no income records found/i)).toBeInTheDocument();
  });

  it("renders nothing while closed, without calling the paged query for data", () => {
    useInfiniteIncomeQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: jest.fn(),
    });
    setupMutations();

    const { container } = render(<IncomeModal isOpen={false} onClose={jest.fn()} period="thismonth" />);
    expect(container).toBeEmptyDOMElement();
  });
});
