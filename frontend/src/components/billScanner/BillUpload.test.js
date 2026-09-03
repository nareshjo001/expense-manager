import { fireEvent, render, screen } from "@testing-library/react";
import BillUpload from "./BillUpload";
import { useBillUploadMutation } from "../../hooks/mutations/useBillUploadMutation";

jest.mock("../../hooks/mutations/useBillUploadMutation", () => ({
  useBillUploadMutation: jest.fn(),
}));

describe("BillUpload", () => {
  const mutate = jest.fn();

  beforeEach(() => {
    mutate.mockReset();
    useBillUploadMutation.mockReturnValue({ mutate, isPending: false });
    URL.createObjectURL = jest.fn(() => "blob:receipt-preview");
    URL.revokeObjectURL = jest.fn();
  });

  it("rejects an unsupported or oversized file before upload", () => {
    render(<BillUpload setIsBillUpload={jest.fn()} setBillData={jest.fn()} />);
    const file = new File(["receipt"], "receipt.pdf", { type: "application/pdf" });

    fireEvent.change(screen.getByLabelText("Select Bill Image"), { target: { files: [file] } });

    expect(screen.getByRole("alert")).toHaveTextContent("Choose a JPEG or PNG image that is 5 MB or smaller.");
    fireEvent.click(screen.getByRole("button", { name: "Upload Bill" }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it("passes an abort signal with a valid JPEG upload and aborts it on unmount", () => {
    const { unmount } = render(<BillUpload setIsBillUpload={jest.fn()} setBillData={jest.fn()} />);
    const file = new File(["receipt"], "receipt.jpg", { type: "image/jpeg" });

    fireEvent.change(screen.getByLabelText("Select Bill Image"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload Bill" }));

    const [{ file: submittedFile, signal }] = mutate.mock.calls[0];
    expect(submittedFile).toBe(file);
    expect(signal.aborted).toBe(false);
    unmount();
    expect(signal.aborted).toBe(true);
  });
});
