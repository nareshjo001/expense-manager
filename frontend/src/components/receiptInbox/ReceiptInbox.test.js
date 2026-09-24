// OCR-004 -- Receipt Inbox list. Same hook-mocking convention as
// DataExport.test.js -- mock the query hook and any lower-level component
// directly rather than standing up a real QueryClientProvider, since this
// component's own logic (what it renders, how it filters, what it passes
// through on click-through) is the thing under test.
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ReceiptInbox from "./ReceiptInbox";
import { useReceiptsQuery } from "../../hooks/queries/useReceiptsQuery";
import { getReceiptImageBlob } from "../../api/receiptsApi";

jest.mock("../../hooks/queries/useReceiptsQuery", () => ({
  useReceiptsQuery: jest.fn(),
}));

jest.mock("../../api/receiptsApi", () => ({
  getReceiptImageBlob: jest.fn(),
}));

// Isolates this suite from ReceiptDetail's own real query hooks (which have
// no QueryClientProvider here) -- ReceiptDetail.test.js covers that
// component on its own. This mock just proves ReceiptInbox hands off the
// right receiptId on click-through.
jest.mock("./ReceiptDetail", () => (props) => (
  <div data-testid="receipt-detail" data-receipt-id={props.receiptId} />
));

function setupQuery(data, overrides = {}) {
  useReceiptsQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: data ? { success: true, data } : undefined,
    refetch: jest.fn(),
    ...overrides,
  });
}

function sampleReceipts() {
  return [
    {
      id: "r1",
      uploadedAt: "2026-09-01T10:00:00.000Z",
      extractedFields: {
        expenseName: "Coffee Shop",
        expenseAmount: 250,
        expenseDate: "2026-09-01",
      },
      reviewStatus: "needs_review",
      linkedExpenseId: null,
      imageUrl: "/api/receipts/r1/image",
    },
    {
      id: "r2",
      uploadedAt: "2026-09-02T10:00:00.000Z",
      extractedFields: {
        expenseName: "Grocery Mart",
        expenseAmount: 1200,
        expenseDate: "2026-09-02",
      },
      reviewStatus: "reviewed",
      linkedExpenseId: "exp-9",
      imageUrl: "/api/receipts/r2/image",
    },
  ];
}

beforeEach(() => {
  getReceiptImageBlob.mockResolvedValue(new Blob());
  URL.createObjectURL = jest.fn(() => "blob:receipt-thumbnail");
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("ReceiptInbox -- list", () => {
  it("shows the loading state while the query is in flight", () => {
    setupQuery(null, { isLoading: true });

    render(<ReceiptInbox />);

    expect(screen.getByText(/loading your receipts/i)).toBeInTheDocument();
  });

  it("shows the error state with a working retry button", () => {
    const refetch = jest.fn();
    setupQuery(null, { isError: true, refetch });

    render(<ReceiptInbox />);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the empty state when there are no receipts", () => {
    setupQuery([]);

    render(<ReceiptInbox />);

    expect(screen.getByText(/no receipts yet/i)).toBeInTheDocument();
  });

  it("renders each receipt with its review-status badge, and a linked badge only when linked", async () => {
    setupQuery(sampleReceipts());

    render(<ReceiptInbox />);
    // Lets the mocked (already-resolved) thumbnail fetch's .then settle
    // inside act() before asserting, rather than after this test's
    // synchronous body has already returned.
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Coffee Shop")).toBeInTheDocument();
    expect(screen.getByText("Grocery Mart")).toBeInTheDocument();

    // "Needs review"/"Reviewed" also appear as <option> labels in the
    // review-status filter, so the badge itself is targeted by selector
    // rather than by getByText's default (whole-document) text match.
    expect(screen.getByText("Needs review", { selector: ".receipt-badge--needs_review" })).toBeInTheDocument();
    expect(screen.getByText("Reviewed", { selector: ".receipt-badge--reviewed" })).toBeInTheDocument();

    // Only the linked receipt (r2) gets the "Linked" badge. "Linked" also
    // appears as the filter's <label> and <option>, so scope by selector.
    expect(screen.getAllByText("Linked", { selector: ".receipt-badge--linked" })).toHaveLength(1);
  });
});

describe("ReceiptInbox -- filters", () => {
  it("calls the query hook with the selected review-status filter", () => {
    setupQuery([]);

    render(<ReceiptInbox />);
    fireEvent.change(screen.getByLabelText(/review status/i), { target: { value: "needs_review" } });

    const lastCallArgs = useReceiptsQuery.mock.calls[useReceiptsQuery.mock.calls.length - 1][0];
    expect(lastCallArgs).toEqual(expect.objectContaining({ reviewStatus: "needs_review" }));
  });

  it("calls the query hook with linked=true/false for the linked filter", () => {
    setupQuery([]);

    render(<ReceiptInbox />);

    fireEvent.change(screen.getByLabelText(/^linked$/i), { target: { value: "linked" } });
    let lastCallArgs = useReceiptsQuery.mock.calls[useReceiptsQuery.mock.calls.length - 1][0];
    expect(lastCallArgs).toEqual(expect.objectContaining({ linked: true }));

    fireEvent.change(screen.getByLabelText(/^linked$/i), { target: { value: "unlinked" } });
    lastCallArgs = useReceiptsQuery.mock.calls[useReceiptsQuery.mock.calls.length - 1][0];
    expect(lastCallArgs).toEqual(expect.objectContaining({ linked: false }));

    fireEvent.change(screen.getByLabelText(/^linked$/i), { target: { value: "" } });
    lastCallArgs = useReceiptsQuery.mock.calls[useReceiptsQuery.mock.calls.length - 1][0];
    expect(lastCallArgs).toEqual(expect.objectContaining({ linked: undefined }));
  });
});

describe("ReceiptInbox -- click-through", () => {
  it("opens ReceiptDetail with the clicked receipt's id", async () => {
    setupQuery(sampleReceipts());

    render(<ReceiptInbox />);
    await act(async () => {
      await Promise.resolve();
    });
    fireEvent.click(screen.getByText("Coffee Shop"));

    const detail = screen.getByTestId("receipt-detail");
    expect(detail).toHaveAttribute("data-receipt-id", "r1");
  });
});
