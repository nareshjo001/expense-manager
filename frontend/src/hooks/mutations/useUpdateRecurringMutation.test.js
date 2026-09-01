// Recurring-State Authority and Crash-Recovery Remediation -- frontend contract.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateRecurringStatus } from "../../api/expenseApi";
import { queryKeys } from "../../query/queryKeys";
import { useUpdateRecurringMutation } from "./useUpdateRecurringMutation";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));

jest.mock("../../api/expenseApi", () => ({
  updateRecurringStatus: jest.fn(),
}));

afterEach(() => {
  jest.clearAllMocks();
});

function captureOptions() {
  const cancelQueries = jest.fn().mockResolvedValue(undefined);
  const getQueriesData = jest.fn();
  const setQueriesData = jest.fn();
  const setQueryData = jest.fn();
  const invalidateQueries = jest.fn();

  useQueryClient.mockReturnValue({
    cancelQueries,
    getQueriesData,
    setQueriesData,
    setQueryData,
    invalidateQueries,
  });

  let capturedOptions;
  useMutation.mockImplementation((options) => {
    capturedOptions = options;
    return {};
  });

  useUpdateRecurringMutation();
  return { options: capturedOptions, cancelQueries, getQueriesData, setQueriesData, setQueryData, invalidateQueries };
}

describe("useUpdateRecurringMutation -- mutationFn wiring", () => {
  it("forwards {expenseId, isRecurring} to updateRecurringStatus(expenseId, isRecurring) unchanged", async () => {
    const { options } = captureOptions();
    updateRecurringStatus.mockResolvedValue({ success: true, isRecurring: true });

    await options.mutationFn({ expenseId: "exp-1", isRecurring: true });

    expect(updateRecurringStatus).toHaveBeenCalledWith("exp-1", true);
  });
});

describe("useUpdateRecurringMutation -- onMutate optimistic patch (unchanged)", () => {
  it("cancels in-flight expense queries and snapshots the previous cache before patching", async () => {
    const { options, cancelQueries, getQueriesData, setQueriesData } = captureOptions();
    const snapshot = [[["expenses"], { success: true, data: [{ _id: "exp-1", isRecurring: false }] }]];
    getQueriesData.mockReturnValue(snapshot);

    const context = await options.onMutate({ expenseId: "exp-1", isRecurring: true });

    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: queryKeys.expenses.all });
    expect(getQueriesData).toHaveBeenCalledWith({ queryKey: queryKeys.expenses.all });
    expect(setQueriesData).toHaveBeenCalledWith({ queryKey: queryKeys.expenses.all }, expect.any(Function));
    expect(context).toEqual({ previousQueries: snapshot });
  });

  it("the updater patches the matching expense to the new optimistic isRecurring value", async () => {
    const { options, setQueriesData } = captureOptions();
    await options.onMutate({ expenseId: "exp-1", isRecurring: true });

    const updater = setQueriesData.mock.calls[0][1];
    const patched = updater({ success: true, data: [{ _id: "exp-1", isRecurring: false }, { _id: "exp-2", isRecurring: false }] });

    expect(patched.data).toEqual([{ _id: "exp-1", isRecurring: true }, { _id: "exp-2", isRecurring: false }]);
  });
});

describe("useUpdateRecurringMutation -- onError rollback (unchanged)", () => {
  it("restores every snapshotted query on failure", () => {
    const { options, setQueryData } = captureOptions();
    const previousQueries = [[["expenses"], { success: true, data: [{ _id: "exp-1", isRecurring: false }] }]];

    options.onError(new Error("network"), { expenseId: "exp-1", isRecurring: true }, { previousQueries });

    expect(setQueryData).toHaveBeenCalledWith(["expenses"], { success: true, data: [{ _id: "exp-1", isRecurring: false }] });
  });

  it("does nothing when there is no rollback context (onMutate never ran/threw)", () => {
    const { options, setQueryData } = captureOptions();

    expect(() => options.onError(new Error("network"), { expenseId: "exp-1", isRecurring: true }, undefined)).not.toThrow();
    expect(setQueryData).not.toHaveBeenCalled();
  });
});

describe("useUpdateRecurringMutation -- onSuccess reconciles with the server's authoritative isRecurring", () => {
  it("re-patches every cached expense query using the server response's isRecurring, not the client's guess", () => {
    const { options, setQueriesData } = captureOptions();

    options.onSuccess({ success: true, isRecurring: false }, { expenseId: "exp-1", isRecurring: true });

    // Called once during onMutate is not part of this assertion; here we only
    // captured options, so this is the sole onSuccess-triggered call.
    expect(setQueriesData).toHaveBeenCalledWith({ queryKey: queryKeys.expenses.all }, expect.any(Function));
    const updater = setQueriesData.mock.calls[0][1];
    const patched = updater({ success: true, data: [{ _id: "exp-1", isRecurring: true }] });
    expect(patched.data).toEqual([{ _id: "exp-1", isRecurring: false }]);
  });

  it("does not touch the cache when the response is unsuccessful", () => {
    const { options, setQueriesData } = captureOptions();

    options.onSuccess({ success: false }, { expenseId: "exp-1", isRecurring: true });

    expect(setQueriesData).not.toHaveBeenCalled();
  });

  it("does not touch the cache when isRecurring is missing or not a boolean", () => {
    const { options, setQueriesData } = captureOptions();

    options.onSuccess({ success: true }, { expenseId: "exp-1", isRecurring: true });

    expect(setQueriesData).not.toHaveBeenCalled();
  });
});

describe("useUpdateRecurringMutation -- onSettled always refetches for convergence", () => {
  it("invalidates every cached expense query regardless of outcome", () => {
    const { options, invalidateQueries } = captureOptions();

    options.onSettled();

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.expenses.all });
  });
});
