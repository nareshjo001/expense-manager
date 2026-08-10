// Phase C -- Expense Mutation Reliability, Recovery, and Idempotency.
//
// Proves useAddExpenseMutation/useUpdateExpenseMutation/
// useDeleteExpenseMutation need NO changes for Phase C: their onSuccess
// callback invalidates expenses/budgets/reports/charts unconditionally --
// it never inspects the response body -- so it already fires identically
// whether the backend reports derivedData.status "synchronized" or
// "pending". Also proves none of the three hooks override the shared
// query/queryClient.js global `mutations: { retry: 0 }` default, so a
// "committed but pending sync" response can never trigger an automatic
// resubmission of the same request behind the UI's back.
//
// Mirrors src/hooks/mutations/useSiaAskMutation.test.js's convention:
// mocks @tanstack/react-query's useMutation/useQueryClient directly and
// asserts on the exact options object passed to it. No real QueryClient,
// cache, or network is ever involved.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addExpense, updateExpense, deleteExpense } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";
import { useAddExpenseMutation } from "./useAddExpenseMutation";
import { useUpdateExpenseMutation } from "./useUpdateExpenseMutation";
import { useDeleteExpenseMutation } from "./useDeleteExpenseMutation";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock("../../api/expenseApi", () => ({
  addExpense: jest.fn(),
  updateExpense: jest.fn(),
  deleteExpense: jest.fn(),
}));

afterEach(() => {
  jest.clearAllMocks();
});

function captureOptions(hook) {
  const invalidateQueries = jest.fn();
  useQueryClient.mockReturnValue({ invalidateQueries });

  let capturedOptions;
  useMutation.mockImplementation((options) => {
    capturedOptions = options;
    return {};
  });

  hook();
  return { options: capturedOptions, invalidateQueries };
}

describe.each([
  ["useAddExpenseMutation", useAddExpenseMutation],
  ["useUpdateExpenseMutation", useUpdateExpenseMutation],
  ["useDeleteExpenseMutation", useDeleteExpenseMutation],
])("%s -- Phase C compatibility", (name, hook) => {
  it("never overrides the shared global retry:0 default with a mutation-level retry option", () => {
    const { options } = captureOptions(hook);

    expect(options).not.toHaveProperty("retry");
  });

  it("invalidates expenses/budgets/reports/charts even when the response body is a Phase C 'pending' shape", () => {
    const { options, invalidateQueries } = captureOptions(hook);

    // onSuccess never inspects its argument -- proven by calling it with a
    // Phase C-shaped "committed but pending sync" response body and
    // asserting every invalidation still fires exactly as it would for a
    // fully synchronized response.
    options.onSuccess({
      success: true,
      message: "Expense saved",
      data: {},
      derivedData: { status: "pending", budget: "pending", report: "synchronized", recoveryPending: true },
      replayed: false,
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.expenses.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.budgets.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.reports.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.charts.all });
    expect(invalidateQueries).toHaveBeenCalledTimes(4);
  });

  it("invalidates identically for a fully synchronized response -- pending vs synchronized is not a different code path", () => {
    const { options, invalidateQueries } = captureOptions(hook);

    options.onSuccess({
      success: true,
      derivedData: { status: "synchronized", budget: "synchronized", report: "synchronized", recoveryPending: false },
      replayed: false,
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(4);
  });
});

describe("useAddExpenseMutation -- mutationFn identity", () => {
  it("passes the exact imported addExpense function as mutationFn", () => {
    const { options } = captureOptions(useAddExpenseMutation);
    expect(options.mutationFn).toBe(addExpense);
  });
});

describe("useUpdateExpenseMutation -- mutationFn wiring", () => {
  it("forwards {editID, payload} to updateExpense(editID, payload) unchanged", async () => {
    const { options } = captureOptions(useUpdateExpenseMutation);
    updateExpense.mockResolvedValue({ success: true });

    await options.mutationFn({ editID: "expense-1", payload: { expenseAmount: 20 } });

    expect(updateExpense).toHaveBeenCalledWith("expense-1", { expenseAmount: 20 });
  });
});

describe("useDeleteExpenseMutation -- mutationFn identity", () => {
  it("passes the exact imported deleteExpense function as mutationFn", () => {
    const { options } = captureOptions(useDeleteExpenseMutation);
    expect(options.mutationFn).toBe(deleteExpense);
  });
});
