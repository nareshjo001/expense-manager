import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteIncome } from "../../api/incomeApi";
import { queryKeys } from "../../query/queryKeys";
import { useDeleteIncomeMutation } from "./useDeleteIncomeMutation";
import { removeIncomeFromCachedPages } from "../../query/pagedCacheReconciliation";

jest.mock("@tanstack/react-query", () => ({
  useMutation: jest.fn(),
  useQueryClient: jest.fn(),
}));
jest.mock("../../api/incomeApi", () => ({
  deleteIncome: jest.fn(),
}));
jest.mock("../../query/pagedCacheReconciliation", () => ({
  removeIncomeFromCachedPages: jest.fn(),
}));

function captureOptions() {
  const invalidateQueries = jest.fn();
  const setQueriesData = jest.fn();
  useQueryClient.mockReturnValue({ invalidateQueries, setQueriesData });

  let capturedOptions;
  useMutation.mockImplementation((options) => {
    capturedOptions = options;
    return {};
  });

  useDeleteIncomeMutation();
  return { options: capturedOptions, invalidateQueries };
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("useDeleteIncomeMutation", () => {
  it("passes the exact imported deleteIncome function as mutationFn", () => {
    const { options } = captureOptions();
    expect(options.mutationFn).toBe(deleteIncome);
  });

  it("invalidates income and report data on success", () => {
    const { options, invalidateQueries } = captureOptions();

    options.onSuccess({ success: true }, "income-7");

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.income.all });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: queryKeys.reports.all });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });

  it("patches the paged income cache with the deleted income's id (EXP-003-T06)", () => {
    const { options } = captureOptions();

    options.onSuccess({ success: true }, "income-7");

    expect(removeIncomeFromCachedPages).toHaveBeenCalledWith(expect.anything(), "income-7");
  });
});
