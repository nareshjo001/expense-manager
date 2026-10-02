import { fireEvent, render, screen } from "@testing-library/react";
import BillUpload from "./BillUpload";
import { useBillUploadMutation } from "../../hooks/mutations/useBillUploadMutation";
import { receiptNeedsReviewToast } from "../alertsEffects/toastMessages";

jest.mock("../../hooks/mutations/useBillUploadMutation", () => ({
  useBillUploadMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  expenseAddErrorToast: jest.fn(),
  receiptNeedsReviewToast: jest.fn(),
}));

describe("BillUpload", () => {
  const mutate = jest.fn();

  beforeEach(() => {
    mutate.mockReset();
    useBillUploadMutation.mockReturnValue({ mutate, isPending: false });
    URL.createObjectURL = jest.fn(() => "blob:receipt-preview");
    URL.revokeObjectURL = jest.fn();
  });

  const renderBillUpload = (props = {}) =>
    render(<BillUpload setIsBillUpload={jest.fn()} setBillData={jest.fn()} {...props} />);
  const fileInput = () => screen.getByLabelText("Select a receipt image");

  it("rejects an unsupported or oversized file before upload", () => {
    renderBillUpload();
    const file = new File(["receipt"], "receipt.pdf", { type: "application/pdf" });

    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPEG or PNG image that is 5 MB or smaller.");
    fireEvent.click(screen.getByRole("button", { name: "Upload Bill" }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("rejects a PNG over 5 MB and links the error to the file input", () => {
    renderBillUpload();
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });

    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPEG or PNG image that is 5 MB or smaller.");
    expect(fileInput().getAttribute("aria-describedby").split(" ")).toContain("bill-upload-error");
    expect(screen.queryByAltText("Preview")).toBeNull();
  });

  it("passes an abort signal with a valid JPEG upload and aborts it on unmount", () => {
    const { unmount } = renderBillUpload();
    const file = new File(["receipt"], "receipt.jpg", { type: "image/jpeg" });

    fireEvent.change(fileInput(), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload Bill" }));

    const [{ file: submittedFile, signal }] = mutate.mock.calls[0];
    expect(submittedFile).toBe(file);
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("shows the dropzone guidance with the real file rules on the native JPEG/PNG input", () => {
    renderBillUpload();

    expect(screen.getByText("Choose File")).toBeInTheDocument();
    expect(screen.getByText("or drag and drop")).toBeInTheDocument();
    expect(screen.getByText("Supports JPG, PNG • Max 5MB")).toBeInTheDocument();
    expect(fileInput()).toHaveAttribute("type", "file");
    expect(fileInput()).toHaveAttribute("accept", "image/jpeg,image/png");
    expect(fileInput()).toHaveAttribute("aria-describedby", "bill-upload-rules");
  });

  it("previews a valid PNG inside the dropzone with its file name", () => {
    renderBillUpload();
    const file = new File(["receipt"], "dinner-receipt.png", { type: "image/png" });

    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(screen.getByAltText("Preview")).toHaveAttribute("src", "blob:receipt-preview");
    expect(screen.getByText("dinner-receipt.png")).toBeInTheDocument();
    expect(screen.getByText("Choose a different file")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows Uploading... on a disabled button while the upload is pending", () => {
    useBillUploadMutation.mockReturnValue({ mutate, isPending: true });
    renderBillUpload();

    expect(screen.getByRole("button", { name: "Uploading..." })).toBeDisabled();
  });

  it("hands the parsed receipt to Add Expense and closes on success", () => {
    const setIsBillUpload = jest.fn();
    const setBillData = jest.fn();
    renderBillUpload({ setIsBillUpload, setBillData });
    fireEvent.change(fileInput(), { target: { files: [new File(["receipt"], "receipt.jpg", { type: "image/jpeg" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload Bill" }));

    const [, { onSuccess }] = mutate.mock.calls[0];
    onSuccess({ parsedReceipt: { expenseName: "Cafe", expenseDate: "05/09/2026", needsReview: true } });

    expect(receiptNeedsReviewToast).toHaveBeenCalled();
    expect(setBillData).toHaveBeenCalledWith(expect.objectContaining({ expenseName: "Cafe", expenseDate: "2026-09-05" }));
    expect(setIsBillUpload).toHaveBeenCalledWith(false);
  });

  it("goes back to Add Expense from the Back button", () => {
    const setIsBillUpload = jest.fn();
    renderBillUpload({ setIsBillUpload });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(setIsBillUpload).toHaveBeenCalledWith(false);
  });
});
