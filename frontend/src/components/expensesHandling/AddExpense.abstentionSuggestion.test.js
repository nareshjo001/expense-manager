// ML-003-T04 -- an abstained ML prediction is shown as an explicit
// suggestion the user must accept, never silently auto-filled.
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AddExpense from "./AddExpense";
import { useAddExpenseMutation } from "../../hooks/mutations/useAddExpenseMutation";
import { useUpdateExpenseMutation } from "../../hooks/mutations/useUpdateExpenseMutation";
import { useSaveMerchantRuleMutation } from "../../hooks/mutations/useSaveMerchantRuleMutation";
import {
  expenseAddSuccessToast,
  expenseAddErrorToast,
  merchantRuleSaveSuccessToast,
  merchantRuleSaveErrorToast,
} from "../alertsEffects/toastMessages";
import { queryClient } from "../../query/queryClient";

jest.mock("../../hooks/mutations/useAddExpenseMutation", () => ({
  useAddExpenseMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useUpdateExpenseMutation", () => ({
  useUpdateExpenseMutation: jest.fn(),
}));
jest.mock("../../hooks/mutations/useSaveMerchantRuleMutation", () => ({
  useSaveMerchantRuleMutation: jest.fn(),
}));
jest.mock("../alertsEffects/toastMessages", () => ({
  expenseAddSuccessToast: jest.fn(),
  expenseAddErrorToast: jest.fn(),
  merchantRuleSaveSuccessToast: jest.fn(),
  merchantRuleSaveErrorToast: jest.fn(),
}));
jest.mock("../billScanner/BillUpload", () => () => null);
jest.mock("../../api/expenseApi", () => ({
  getExpenseEditData: jest.fn(),
}));
jest.mock("../../query/queryClient", () => ({
  queryClient: { fetchQuery: jest.fn() },
}));

const mockNavigate = jest.fn();
jest.mock(
  "react-router-dom",
  () => ({
    useNavigate: () => mockNavigate,
  }),
  { virtual: true }
);

function mockPrediction(body) {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    })
  );
}

beforeEach(() => {
  queryClient.fetchQuery.mockResolvedValue({ data: null });
  process.env.REACT_APP_BACKEND_URL = "http://localhost:8080";
  useAddExpenseMutation.mockReturnValue({ mutate: jest.fn() });
  useUpdateExpenseMutation.mockReturnValue({ mutate: jest.fn() });
  useSaveMerchantRuleMutation.mockReturnValue({ mutate: jest.fn(), isPending: false });
});

afterEach(() => {
  jest.clearAllMocks();
  delete global.fetch;
});

function renderAddExpense() {
  return render(<AddExpense isEdit={{ enableEdit: false, expense_id: "" }} setIsEdit={jest.fn()} />);
}

describe("AddExpense -- abstained ML predictions shown as a suggestion (ML-003-T04)", () => {
  it("does NOT auto-fill the category when the prediction is abstained, and shows a suggestion instead", async () => {
    mockPrediction({ predictedCategory: "Personal Care", confidence: 62, abstained: true, abstentionReason: "low_confidence" });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Some New Merchant" } });

    expect(await screen.findByText(/did you mean/i)).toBeInTheDocument();
    expect(screen.getByText("Personal Care")).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toHaveValue("");
    // The committed-confidence badge is for auto-filled predictions only -- must not appear alongside a suggestion.
    expect(screen.queryByLabelText(/ml confidence score/i)).not.toBeInTheDocument();
  });

  it("clicking \"Use this\" accepts the suggestion into the category field and dismisses the banner", async () => {
    mockPrediction({ predictedCategory: "Personal Care", confidence: 62, abstained: true, abstentionReason: "low_confidence" });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Some New Merchant" } });
    fireEvent.click(await screen.findByRole("button", { name: /use this/i }));

    expect(screen.getByLabelText(/category/i)).toHaveValue("Personal Care");
    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
  });

  it("typing a category manually while abstained dismisses the suggestion without adopting it", async () => {
    mockPrediction({ predictedCategory: "Personal Care", confidence: 62, abstained: true, abstentionReason: "low_confidence" });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Some New Merchant" } });
    await screen.findByText(/did you mean/i);

    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: "Travel" } });

    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toHaveValue("Travel");
  });

  it("still auto-fills and shows the confidence badge for a committed (non-abstained) prediction", async () => {
    mockPrediction({ predictedCategory: "Food", confidence: 92, abstained: false, abstentionReason: null });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Starbucks Coffee" } });

    await waitFor(() => expect(screen.getByLabelText(/category/i)).toHaveValue("Food"));
    expect(screen.getByLabelText(/ml confidence score/i)).toBeInTheDocument();
    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
  });

  it("treats a response with no abstained field (legacy/older ML service) as committed, same as before this task", async () => {
    mockPrediction({ predictedCategory: "Food", confidence: 92 });
    renderAddExpense();

    fireEvent.change(screen.getByLabelText(/name of the expense/i), { target: { value: "Starbucks Coffee" } });

    await waitFor(() => expect(screen.getByLabelText(/category/i)).toHaveValue("Food"));
    expect(screen.queryByText(/did you mean/i)).not.toBeInTheDocument();
  });
});
