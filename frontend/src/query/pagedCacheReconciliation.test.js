// EXP-003-T06 -- surgical removal of a deleted record from every cached
// infinite (paged) query, without waiting on a network refetch.
import { removeRecordFromCachedPages, removeExpenseFromCachedPages, removeIncomeFromCachedPages } from "./pagedCacheReconciliation";
import { queryKeys } from "./queryKeys";

// A minimal stand-in for QueryClient.setQueriesData: captures the filter it
// was called with, and lets the test apply the updater to arbitrary cached
// data exactly as the real client would.
function makeFakeQueryClient() {
  return {
    setQueriesData: jest.fn(),
  };
}

describe("removeRecordFromCachedPages", () => {
  it("filters the matching record out of every page by id, preserving every other page untouched", () => {
    const queryClient = makeFakeQueryClient();

    removeRecordFromCachedPages(queryClient, queryKeys.expenses.all, "exp-2");

    expect(queryClient.setQueriesData).toHaveBeenCalledTimes(1);
    const [filter, updater] = queryClient.setQueriesData.mock.calls[0];
    expect(filter).toEqual({ queryKey: queryKeys.expenses.all });

    const cached = {
      pageParams: [undefined, "cursor-1"],
      pages: [
        { success: true, data: [{ _id: "exp-1" }, { _id: "exp-2" }], hasMore: true, nextCursor: "cursor-1" },
        { success: true, data: [{ _id: "exp-3" }], hasMore: false, nextCursor: null },
      ],
    };

    const result = updater(cached);

    expect(result.pages[0].data).toEqual([{ _id: "exp-1" }]);
    expect(result.pages[1].data).toEqual([{ _id: "exp-3" }]);
    // Non-data page fields (hasMore, nextCursor, pageParams) are left exactly as they were.
    expect(result.pages[0].hasMore).toBe(true);
    expect(result.pageParams).toBe(cached.pageParams);
  });

  it("matches records keyed by `id` as well as `_id`", () => {
    const queryClient = makeFakeQueryClient();
    removeRecordFromCachedPages(queryClient, queryKeys.income.all, "inc-1");
    const updater = queryClient.setQueriesData.mock.calls[0][1];

    const result = updater({ pages: [{ success: true, data: [{ id: "inc-1" }, { id: "inc-2" }] }] });

    expect(result.pages[0].data).toEqual([{ id: "inc-2" }]);
  });

  it("leaves a non-infinite (plain) cache entry completely untouched", () => {
    const queryClient = makeFakeQueryClient();
    removeRecordFromCachedPages(queryClient, queryKeys.expenses.all, "exp-1");
    const updater = queryClient.setQueriesData.mock.calls[0][1];

    const plainCached = { success: true, data: [{ _id: "exp-1" }] };
    expect(updater(plainCached)).toBe(plainCached);
  });

  it("passes through undefined cache data (query never fetched) without throwing", () => {
    const queryClient = makeFakeQueryClient();
    removeRecordFromCachedPages(queryClient, queryKeys.expenses.all, "exp-1");
    const updater = queryClient.setQueriesData.mock.calls[0][1];

    expect(updater(undefined)).toBeUndefined();
  });

  it("leaves a failed page's data untouched (never assumes `.data` exists on a non-success page)", () => {
    const queryClient = makeFakeQueryClient();
    removeRecordFromCachedPages(queryClient, queryKeys.expenses.all, "exp-1");
    const updater = queryClient.setQueriesData.mock.calls[0][1];

    const cached = { pages: [{ success: false, message: "boom" }] };
    expect(updater(cached).pages[0]).toEqual({ success: false, message: "boom" });
  });

  it("does nothing when the record id is undefined or null", () => {
    const queryClient = makeFakeQueryClient();

    removeRecordFromCachedPages(queryClient, queryKeys.expenses.all, undefined);
    removeRecordFromCachedPages(queryClient, queryKeys.expenses.all, null);

    expect(queryClient.setQueriesData).not.toHaveBeenCalled();
  });
});

describe("removeExpenseFromCachedPages / removeIncomeFromCachedPages", () => {
  it("target their own respective query key prefixes", () => {
    const expenseClient = makeFakeQueryClient();
    removeExpenseFromCachedPages(expenseClient, "exp-1");
    expect(expenseClient.setQueriesData).toHaveBeenCalledWith({ queryKey: queryKeys.expenses.all }, expect.any(Function));

    const incomeClient = makeFakeQueryClient();
    removeIncomeFromCachedPages(incomeClient, "inc-1");
    expect(incomeClient.setQueriesData).toHaveBeenCalledWith({ queryKey: queryKeys.income.all }, expect.any(Function));
  });
});
