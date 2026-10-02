import { act, fireEvent, render, screen } from "@testing-library/react";
import NaturalLanguageQuickAdd from "./NaturalLanguageQuickAdd";
import { useParseExpenseMutation } from "../../hooks/mutations/useParseExpenseMutation";
import { expenseAddErrorToast } from "../alertsEffects/toastMessages";

jest.mock("../../hooks/mutations/useParseExpenseMutation", () => ({
  useParseExpenseMutation: jest.fn(),
}));

jest.mock("../alertsEffects/toastMessages", () => ({
  expenseAddErrorToast: jest.fn(),
}));

describe("NaturalLanguageQuickAdd", () => {
  const mutate = jest.fn();

  beforeEach(() => {
    mutate.mockReset();
    expenseAddErrorToast.mockReset();
    useParseExpenseMutation.mockReturnValue({ mutate, isPending: false });
  });

  it("submitting calls the mutation with the trimmed text", () => {
    render(<NaturalLanguageQuickAdd setIsQuickAdd={jest.fn()} setBillData={jest.fn()} />);

    fireEvent.change(screen.getByLabelText(/describe the expense/i), {
      target: { value: "  spent 250 on lunch yesterday at Cafe X  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse Expense" }));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toBe("spent 250 on lunch yesterday at Cafe X");
  });

  it("does not call the mutation when the input is empty, and the submit button is disabled", () => {
    render(<NaturalLanguageQuickAdd setIsQuickAdd={jest.fn()} setBillData={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Parse Expense" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Parse Expense" }));

    expect(mutate).not.toHaveBeenCalled();
  });

  it("a successful parse calls setBillData with the exact parsed object and closes the component", () => {
    const setBillData = jest.fn();
    const setIsQuickAdd = jest.fn();
    const parsed = {
      expenseName: "Lunch",
      expenseCategory: "Food",
      expenseAmount: 250,
      expenseDate: "2026-09-26",
      expenseDescription: "Cafe X",
      needsReview: false,
      fieldConfidence: { expenseName: 90, expenseCategory: 85, expenseAmount: 95, expenseDate: 92 },
    };

    render(<NaturalLanguageQuickAdd setIsQuickAdd={setIsQuickAdd} setBillData={setBillData} />);
    fireEvent.change(screen.getByLabelText(/describe the expense/i), {
      target: { value: "spent 250 on lunch yesterday at Cafe X" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Parse Expense" }));

    const onSuccess = mutate.mock.calls[0][1].onSuccess;
    onSuccess({ success: true, parsed, model: "gpt", latencyMs: 120 });

    expect(setBillData).toHaveBeenCalledWith(parsed);
    expect(setIsQuickAdd).toHaveBeenCalledWith(false);
  });

  it("a COULD_NOT_PARSE response renders the message inline and does not call setBillData or close", () => {
    const setBillData = jest.fn();
    const setIsQuickAdd = jest.fn();

    render(<NaturalLanguageQuickAdd setIsQuickAdd={setIsQuickAdd} setBillData={setBillData} />);
    fireEvent.change(screen.getByLabelText(/describe the expense/i), { target: { value: "gibberish" } });
    fireEvent.click(screen.getByRole("button", { name: "Parse Expense" }));

    const onSuccess = mutate.mock.calls[0][1].onSuccess;
    act(() => {
      onSuccess({ success: false, code: "COULD_NOT_PARSE", message: "Couldn't understand that." });
    });

    expect(screen.getByRole("status")).toHaveTextContent("Couldn't understand that.");
    expect(setBillData).not.toHaveBeenCalled();
    expect(setIsQuickAdd).not.toHaveBeenCalled();
  });

  it("clicking Back/Cancel calls setIsQuickAdd(false) without calling setBillData", () => {
    const setBillData = jest.fn();
    const setIsQuickAdd = jest.fn();

    render(<NaturalLanguageQuickAdd setIsQuickAdd={setIsQuickAdd} setBillData={setBillData} />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(setIsQuickAdd).toHaveBeenCalledWith(false);
    expect(setBillData).not.toHaveBeenCalled();
  });

  it("a genuine failure (500) shows an error toast, not a second toast for 401/429/409", () => {
    render(<NaturalLanguageQuickAdd setIsQuickAdd={jest.fn()} setBillData={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/describe the expense/i), { target: { value: "spent 10 on tea" } });
    fireEvent.click(screen.getByRole("button", { name: "Parse Expense" }));

    const onError = mutate.mock.calls[0][1].onError;
    onError({ response: { status: 500, data: { message: "Server error" } } });
    expect(expenseAddErrorToast).toHaveBeenCalledWith({ message: "Server error" });

    expenseAddErrorToast.mockClear();
    onError({ response: { status: 429 } });
    expect(expenseAddErrorToast).not.toHaveBeenCalled();
  });

  it("shows the Quick Add header and keeps the input's label, example placeholder and 200-character limit", () => {
    render(<NaturalLanguageQuickAdd setIsQuickAdd={jest.fn()} setBillData={jest.fn()} />);

    expect(screen.getByRole("heading", { name: "Quick Add" })).toBeInTheDocument();
    expect(screen.getByText("Add your expense in seconds")).toBeInTheDocument();
    const input = screen.getByLabelText("Describe the expense in one sentence");
    expect(input).toHaveAttribute("placeholder", 'e.g. "spent 250 on lunch yesterday at Cafe X"');
    expect(input).toHaveAttribute("maxLength", "200");
  });

  it("shows Parsing... on a disabled button while a parse is running", () => {
    useParseExpenseMutation.mockReturnValue({ mutate, isPending: true });
    render(<NaturalLanguageQuickAdd setIsQuickAdd={jest.fn()} setBillData={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/describe the expense/i), { target: { value: "spent 10 on tea" } });

    expect(screen.getByRole("button", { name: "Parsing..." })).toBeDisabled();
  });

  it("links the inline couldn't-parse message to the input", () => {
    render(<NaturalLanguageQuickAdd setIsQuickAdd={jest.fn()} setBillData={jest.fn()} />);
    fireEvent.change(screen.getByLabelText(/describe the expense/i), { target: { value: "gibberish" } });
    fireEvent.click(screen.getByRole("button", { name: "Parse Expense" }));

    act(() => {
      mutate.mock.calls[0][1].onSuccess({ success: false, code: "COULD_NOT_PARSE", message: "Couldn't understand that." });
    });

    expect(screen.getByLabelText(/describe the expense/i)).toHaveAttribute("aria-describedby", "nl-quick-add-message");
    expect(screen.getByRole("status")).toHaveAttribute("id", "nl-quick-add-message");
  });
});
