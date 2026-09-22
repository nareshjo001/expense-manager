// OCR-004 -- Receipt Detail view. Same hook-mocking convention as
// DataExport.test.js/MerchantRules.test.js -- mock every query/mutation
// hook directly, and exercise the real (unmocked) DeleteAlert component for
// the delete-confirmation step, same as MerchantRules.test.js does.
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import ReceiptDetail from "./ReceiptDetail";
import { useReceiptDetailQuery } from "../../hooks/queries/useReceiptDetailQuery";
import { useReceiptDuplicatesQuery } from "../../hooks/queries/useReceiptDuplicatesQuery";
import { useLinkReceiptMutation } from "../../hooks/mutations/useLinkReceiptMutation";
import { useUnlinkReceiptMutation } from "../../hooks/mutations/useUnlinkReceiptMutation";
import { useMarkReceiptReviewedMutation } from "../../hooks/mutations/useMarkReceiptReviewedMutation";
import { useDeleteReceiptMutation } from "../../hooks/mutations/useDeleteReceiptMutation";
import { useRecordDuplicateDecisionMutation } from "../../hooks/mutations/useRecordDuplicateDecisionMutation";
import { getReceiptImageBlob } from "../../api/receiptsApi";
import {
  receiptLinkSuccessToast,
  receiptLinkErrorToast,
  receiptUnlinkSuccessToast,
  receiptReviewSuccessToast,
  receiptDeleteSuccessToast,
  receiptDuplicateDecisionSuccessToast,
  receiptDuplicateDecisionErrorToast,
} from "../alertsEffects/toastMessages";

jest.mock("../../hooks/queries/useReceiptDetailQuery", () => ({
  useReceiptDetailQuery: jest.fn(),
}));
jest.mock("../../hooks/queries/useReceiptDuplicatesQuery", () => ({
  useReceiptDuplicatesQuery: jest.fn(),
}));
jest.mock("../../hooks/mutations/useLinkReceiptMutation", () => ({
  useLinkReceiptMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useUnlinkReceiptMutation", () => ({
  useUnlinkReceiptMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useMarkReceiptReviewedMutation", () => ({
  useMarkReceiptReviewedMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useDeleteReceiptMutation", () => ({
  useDeleteReceiptMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useRecordDuplicateDecisionMutation", () => ({
  useRecordDuplicateDecisionMutation: jest.fn(),
}));
jest.mock("../../api/receiptsApi", () => ({
  getReceiptImageBlob: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  receiptLinkSuccessToast: jest.fn(),
  receiptLinkErrorToast: jest.fn(),
  receiptUnlinkSuccessToast: jest.fn(),
  receiptUnlinkErrorToast: jest.fn(),
  receiptReviewSuccessToast: jest.fn(),
  receiptReviewErrorToast: jest.fn(),
  receiptDeleteSuccessToast: jest.fn(),
  receiptDeleteErrorToast: jest.fn(),
  receiptDuplicateDecisionSuccessToast: jest.fn(),
  receiptDuplicateDecisionErrorToast: jest.fn(),
}));

function needsReviewReceipt(overrides = {}) {
  return {
    id: "r1",
    uploadedAt: "2026-09-01T10:00:00.000Z",
    reviewStatus: "needs_review",
    reviewedAt: null,
    linkedExpenseId: null,
    imageUrl: "/api/receipts/r1/image",
    // OCR-005 -- default to the common case (no duplicate ever flagged),
    // overridden per-test below for the duplicate-banner describe block.
    duplicateStatus: "unreviewed",
    duplicateOfReceiptId: null,
    extractedFields: {
      expenseName: "Coffee Shop",
      expenseAmount: 250,
      expenseDate: "2026-09-01",
      overallConfidence: 55,
      fieldConfidence: { expenseName: 90, expenseAmount: 40, expenseDate: 85 },
      needsReview: true,
      reviewReasons: ["Amount confidence below threshold"],
      amountCandidates: [{ value: 250, confidence: 40 }, { value: 25, confidence: 20 }],
    },
    ...overrides,
  };
}

function reviewedReceipt(overrides = {}) {
  return needsReviewReceipt({
    reviewStatus: "reviewed",
    reviewedAt: "2026-09-02T10:00:00.000Z",
    extractedFields: {
      expenseName: "Coffee Shop",
      expenseAmount: 250,
      expenseDate: "2026-09-01",
      overallConfidence: 92,
      fieldConfidence: { expenseName: 92, expenseAmount: 95, expenseDate: 90 },
      needsReview: false,
      reviewReasons: [],
      amountCandidates: [],
    },
    ...overrides,
  });
}

function setupQuery(receipt, overrides = {}) {
  useReceiptDetailQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: receipt ? { success: true, data: receipt } : undefined,
    refetch: jest.fn(),
    ...overrides,
  });
}

// OCR-005 -- mirrors setupQuery above for the duplicates query. Defaults to
// "no duplicates found" (an empty array, still `success: true`) since
// that's the normal case for the vast majority of receipts -- individual
// tests in the duplicate-banner describe block override it with actual
// candidates.
function setupDuplicatesQuery(duplicates = [], overrides = {}) {
  useReceiptDuplicatesQuery.mockReturnValue({
    isLoading: false,
    isError: false,
    data: { success: true, data: duplicates },
    refetch: jest.fn(),
    ...overrides,
  });
}

// Renders ReceiptDetail and, when the receipt has an imageUrl, flushes the
// mocked (already-resolved) image-fetch .then inside act() before handing
// control back -- same pattern as ReceiptInbox.test.js's thumbnail flush,
// needed here because ReceiptImage's own effect resolves a promise and
// updates state after mount.
async function renderDetail(props = {}) {
  render(<ReceiptDetail receiptId="r1" onBack={jest.fn()} {...props} />);
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  getReceiptImageBlob.mockResolvedValue(new Blob());
  URL.createObjectURL = jest.fn(() => "blob:receipt-image");
  URL.revokeObjectURL = jest.fn();

  useLinkReceiptMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
  useUnlinkReceiptMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
  useMarkReceiptReviewedMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
  useDeleteReceiptMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
  useRecordDuplicateDecisionMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
  setupDuplicatesQuery([]);
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("ReceiptDetail -- extracted fields and confidence", () => {
  it("renders the extracted fields with per-field OCR confidence", async () => {
    setupQuery(needsReviewReceipt());

    await renderDetail();

    expect(screen.getByText("Coffee Shop")).toBeInTheDocument();
    // The same amount (₹250.00) also appears in the amount-candidates list
    // below, so scope this assertion to the field-value element itself.
    expect(screen.getByText(/₹250/, { selector: ".receipt-detail-field-value" })).toBeInTheDocument();
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
    // Low-confidence amount field (40%) surfaces its confidence badge.
    expect(screen.getByLabelText(/receipt ocr confidence for this field: 40%/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/receipt ocr confidence for this field: 90%/i)).toBeInTheDocument();
  });

  it("shows the review-reasons and amount-candidates for a needs_review receipt", async () => {
    setupQuery(needsReviewReceipt());

    await renderDetail();

    expect(screen.getByText("Amount confidence below threshold")).toBeInTheDocument();
    expect(screen.getByText(/other amounts found on this receipt/i)).toBeInTheDocument();
  });
});

describe("ReceiptDetail -- correction form visibility", () => {
  it("shows the correction form when reviewStatus is needs_review", async () => {
    setupQuery(needsReviewReceipt());

    await renderDetail();

    expect(screen.getByText(/correct this receipt/i)).toBeInTheDocument();
  });

  it("hides the correction form once reviewStatus is reviewed", async () => {
    setupQuery(reviewedReceipt());

    await renderDetail();

    expect(screen.queryByText(/correct this receipt/i)).not.toBeInTheDocument();
  });
});

describe("ReceiptDetail -- submitting a correction", () => {
  it("sends only the changed fields as corrections and marks the receipt reviewed", async () => {
    const mutate = jest.fn();
    useMarkReceiptReviewedMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(needsReviewReceipt());

    await renderDetail();

    fireEvent.change(screen.getByLabelText(/amount spent/i), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: /save corrections & mark reviewed/i }));

    expect(mutate).toHaveBeenCalledWith(
      { id: "r1", corrections: { expenseAmount: 300 } },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it("submits with no corrections when nothing was changed", async () => {
    const mutate = jest.fn();
    useMarkReceiptReviewedMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(needsReviewReceipt());

    await renderDetail();
    fireEvent.click(screen.getByRole("button", { name: /save corrections & mark reviewed/i }));

    expect(mutate).toHaveBeenCalledWith(
      { id: "r1", corrections: undefined },
      expect.any(Object)
    );
  });

  it("toasts success on a successful review submission", async () => {
    const mutate = jest.fn((_payload, { onSuccess }) => onSuccess());
    useMarkReceiptReviewedMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(needsReviewReceipt());

    await renderDetail();
    fireEvent.click(screen.getByRole("button", { name: /save corrections & mark reviewed/i }));

    expect(receiptReviewSuccessToast).toHaveBeenCalled();
  });
});

describe("ReceiptDetail -- link/unlink", () => {
  it("links the receipt to the entered expense id", async () => {
    const mutate = jest.fn();
    useLinkReceiptMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(reviewedReceipt({ linkedExpenseId: null }));

    await renderDetail();

    fireEvent.change(screen.getByLabelText(/link to expense/i), { target: { value: "exp-42" } });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));

    expect(mutate).toHaveBeenCalledWith(
      { id: "r1", expenseId: "exp-42" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it("toasts a friendly message for a link error mapped from errorCode", async () => {
    const mutate = jest.fn((_payload, { onError }) =>
      onError({ response: { data: { errorCode: "ALREADY_LINKED_TO_ANOTHER_EXPENSE" } } })
    );
    useLinkReceiptMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(reviewedReceipt({ linkedExpenseId: null }));

    await renderDetail();

    fireEvent.change(screen.getByLabelText(/link to expense/i), { target: { value: "exp-42" } });
    fireEvent.click(screen.getByRole("button", { name: /^link$/i }));

    expect(receiptLinkErrorToast).toHaveBeenCalledWith({ errorCode: "ALREADY_LINKED_TO_ANOTHER_EXPENSE" });
  });

  it("shows an Unlink button when linked, and calls the unlink mutation", async () => {
    const mutate = jest.fn();
    useUnlinkReceiptMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(reviewedReceipt({ linkedExpenseId: "exp-9" }));

    await renderDetail();

    expect(screen.queryByLabelText(/link to expense/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unlink/i }));

    expect(mutate).toHaveBeenCalledWith("r1", expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }));
    expect(receiptUnlinkSuccessToast).not.toHaveBeenCalled(); // only resolves once the mock's onSuccess is invoked
  });
});

describe("ReceiptDetail -- delete", () => {
  it("requires a confirmation step before deleting", async () => {
    const mutate = jest.fn();
    useDeleteReceiptMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(reviewedReceipt());

    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: /delete receipt/i }));
    expect(screen.getByText(/are you sure you want to delete this receipt/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByText(/are you sure you want to delete this receipt/i)).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("deletes the receipt and navigates back after confirming", async () => {
    const onBack = jest.fn();
    const mutate = jest.fn((_id, { onSuccess }) => onSuccess());
    useDeleteReceiptMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(reviewedReceipt());

    await renderDetail({ onBack });

    fireEvent.click(screen.getByRole("button", { name: /delete receipt/i }));
    fireEvent.click(screen.getByRole("button", { name: /yes, delete/i }));

    expect(mutate).toHaveBeenCalledWith("r1", expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }));
    expect(receiptDeleteSuccessToast).toHaveBeenCalled();
    expect(onBack).toHaveBeenCalled();
  });
});

describe("ReceiptDetail -- loading/error/empty", () => {
  it("shows the loading state", () => {
    setupQuery(null, { isLoading: true });
    render(<ReceiptDetail receiptId="r1" onBack={jest.fn()} />);
    expect(screen.getByText(/loading this receipt/i)).toBeInTheDocument();
  });

  it("shows the error state with a working retry button", () => {
    const refetch = jest.fn();
    setupQuery(null, { isError: true, refetch });
    render(<ReceiptDetail receiptId="r1" onBack={jest.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it("shows the unavailable/empty state for a 404-style missing receipt", () => {
    setupQuery(null);
    render(<ReceiptDetail receiptId="r1" onBack={jest.fn()} />);
    expect(screen.getByText(/this receipt isn't available/i)).toBeInTheDocument();
  });
});

describe("ReceiptDetail -- possible duplicates", () => {
  function duplicateCandidate(overrides = {}) {
    return {
      receiptId: "r2",
      reasonCode: "EXACT_FILE_MATCH",
      uploadedAt: "2026-08-30T09:00:00.000Z",
      imageUrl: "/api/receipts/r2/image",
      extractedFields: {
        expenseName: "Coffee Shop",
        expenseAmount: 250,
        expenseDate: "2026-09-01",
      },
      ...overrides,
    };
  }

  it("renders the duplicate banner when candidates exist and duplicateStatus is unreviewed", async () => {
    setupQuery(reviewedReceipt({ duplicateStatus: "unreviewed" }));
    setupDuplicatesQuery([duplicateCandidate()]);

    await renderDetail();

    expect(screen.getByText(/this receipt looks like it might already be in your inbox/i)).toBeInTheDocument();
    expect(screen.getByText("Same file already uploaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /keep as new receipt/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /this is the same as this one/i })).toBeInTheDocument();
  });

  it("labels a probable merchant/date/amount match distinctly from an exact file match", async () => {
    setupQuery(reviewedReceipt({ duplicateStatus: "unreviewed" }));
    setupDuplicatesQuery([duplicateCandidate({ reasonCode: "PROBABLE_MERCHANT_DATE_AMOUNT" })]);

    await renderDetail();

    expect(screen.getByText("Looks like the same purchase")).toBeInTheDocument();
  });

  it("does not render the duplicate banner when there are no candidates", async () => {
    setupQuery(reviewedReceipt({ duplicateStatus: "unreviewed" }));
    setupDuplicatesQuery([]);

    await renderDetail();

    expect(screen.queryByText(/this receipt looks like it might already be in your inbox/i)).not.toBeInTheDocument();
  });

  it("shows a static confirmed-new note instead of the banner once duplicateStatus is confirmed_new", async () => {
    setupQuery(reviewedReceipt({ duplicateStatus: "confirmed_new" }));
    setupDuplicatesQuery([duplicateCandidate()]);

    await renderDetail();

    expect(screen.queryByText(/this receipt looks like it might already be in your inbox/i)).not.toBeInTheDocument();
    expect(screen.getByText(/you confirmed this is a new receipt/i)).toBeInTheDocument();
  });

  it("shows a static linked note instead of the banner once duplicateStatus is linked_existing", async () => {
    setupQuery(reviewedReceipt({ duplicateStatus: "linked_existing", duplicateOfReceiptId: "r2" }));
    setupDuplicatesQuery([duplicateCandidate()]);

    await renderDetail();

    expect(screen.queryByText(/this receipt looks like it might already be in your inbox/i)).not.toBeInTheDocument();
    expect(screen.getByText(/linked to another receipt/i)).toBeInTheDocument();
  });

  it("calls the decision mutation with confirmed_new when Keep as new receipt is clicked", async () => {
    const mutate = jest.fn();
    useRecordDuplicateDecisionMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(reviewedReceipt({ duplicateStatus: "unreviewed" }));
    setupDuplicatesQuery([duplicateCandidate()]);

    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: /keep as new receipt/i }));

    expect(mutate).toHaveBeenCalledWith(
      { id: "r1", decision: "confirmed_new" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it("calls the decision mutation with linked_existing and the candidate's receiptId when its button is clicked", async () => {
    const mutate = jest.fn();
    useRecordDuplicateDecisionMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(reviewedReceipt({ duplicateStatus: "unreviewed" }));
    setupDuplicatesQuery([duplicateCandidate({ receiptId: "r7" })]);

    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: /this is the same as this one/i }));

    expect(mutate).toHaveBeenCalledWith(
      { id: "r1", decision: "linked_existing", duplicateOfReceiptId: "r7" },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) })
    );
  });

  it("toasts success with the confirmed_new message when Keep as new receipt succeeds", async () => {
    const mutate = jest.fn((_payload, { onSuccess }) => onSuccess());
    useRecordDuplicateDecisionMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(reviewedReceipt({ duplicateStatus: "unreviewed" }));
    setupDuplicatesQuery([duplicateCandidate()]);

    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: /keep as new receipt/i }));

    expect(receiptDuplicateDecisionSuccessToast).toHaveBeenCalledWith("confirmed_new");
  });

  it("toasts an error using the server's message when the decision mutation fails", async () => {
    const mutate = jest.fn((_payload, { onError }) =>
      onError({ response: { data: { message: "Something went wrong." } } })
    );
    useRecordDuplicateDecisionMutation.mockReturnValue({ mutate, isPending: false });
    setupQuery(reviewedReceipt({ duplicateStatus: "unreviewed" }));
    setupDuplicatesQuery([duplicateCandidate()]);

    await renderDetail();

    fireEvent.click(screen.getByRole("button", { name: /keep as new receipt/i }));

    expect(receiptDuplicateDecisionErrorToast).toHaveBeenCalledWith({ message: "Something went wrong." });
  });
});
