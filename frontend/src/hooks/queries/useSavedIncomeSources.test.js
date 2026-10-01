import { renderHook } from "@testing-library/react";
import { useSavedIncomeSources, deriveSavedIncomeSources, MAX_SOURCE_PAGES } from "./useSavedIncomeSources";
import { useInfiniteIncomeQuery } from "./useInfiniteIncomeQuery";

// The Add Income "Source of Income" suggestions: derived only from the
// signed-in user's saved income (GET /income/get via the existing paged
// income query), never from a built-in list.
jest.mock("./useInfiniteIncomeQuery", () => ({
  useInfiniteIncomeQuery: jest.fn(),
}));

const page = (sources) => ({
  success: true,
  data: sources.map((incomeSource, i) => ({ _id: `income-${i}`, incomeSource, incomeAmount: 1000 })),
});

function mockIncomeList(overrides = {}) {
  const fetchNextPage = jest.fn();
  useInfiniteIncomeQuery.mockReturnValue({
    data: undefined,
    hasNextPage: false,
    isFetchingNextPage: false,
    isError: false,
    fetchNextPage,
    ...overrides,
  });
  return fetchNextPage;
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("useSavedIncomeSources", () => {
  it("reads the existing all-time income list query (no period, always enabled)", () => {
    mockIncomeList();
    renderHook(() => useSavedIncomeSources());

    expect(useInfiniteIncomeQuery).toHaveBeenCalledWith(undefined, true);
  });

  it("returns each saved source in the list's newest-first order", () => {
    mockIncomeList({ data: { pages: [page(["Salary", "Workday", "Scholarship", "Freelance"])] } });
    const { result } = renderHook(() => useSavedIncomeSources());

    expect(result.current.sources).toEqual(["Salary", "Workday", "Scholarship", "Freelance"]);
  });

  it("lists a source used on many income records only once, across pages", () => {
    mockIncomeList({ data: { pages: [page(["Salary", "Salary", "Salary"]), page(["Scholarship", "Salary"])] } });
    const { result } = renderHook(() => useSavedIncomeSources());

    expect(result.current.sources).toEqual(["Salary", "Scholarship"]);
  });

  it("treats sources that differ only in letter case or spacing as one, keeping the most recent spelling", () => {
    expect(deriveSavedIncomeSources([page(["Salary", " salary ", "Freelance  work", "freelance work"])]))
      .toEqual(["Salary", "Freelance work"]);
  });

  it("returns no suggestions -- no defaults -- while loading or when the user has no saved income", () => {
    mockIncomeList();
    expect(renderHook(() => useSavedIncomeSources()).result.current.sources).toEqual([]);

    mockIncomeList({ data: { pages: [page([])] } });
    expect(renderHook(() => useSavedIncomeSources()).result.current.sources).toEqual([]);
  });

  it("ignores failed pages and records without a usable source", () => {
    expect(deriveSavedIncomeSources([
      { success: false, message: "Internal Server Error" },
      { success: true, data: [{ incomeSource: "   " }, { incomeSource: null }, {}, { incomeSource: "Bonus" }] },
    ])).toEqual(["Bonus"]);
  });

  it("loads the next page of the list in the background while more pages remain", () => {
    const fetchNextPage = mockIncomeList({ data: { pages: [page(["Salary"])] }, hasNextPage: true });
    renderHook(() => useSavedIncomeSources());

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("does not request another page while one is loading, after an error, or once MAX_SOURCE_PAGES pages are loaded", () => {
    const whileLoading = mockIncomeList({ data: { pages: [page(["Salary"])] }, hasNextPage: true, isFetchingNextPage: true });
    renderHook(() => useSavedIncomeSources());
    expect(whileLoading).not.toHaveBeenCalled();

    const afterError = mockIncomeList({ data: { pages: [page(["Salary"])] }, hasNextPage: true, isError: true });
    renderHook(() => useSavedIncomeSources());
    expect(afterError).not.toHaveBeenCalled();

    const pages = Array.from({ length: MAX_SOURCE_PAGES }, () => page(["Salary"]));
    const atCap = mockIncomeList({ data: { pages }, hasNextPage: true });
    renderHook(() => useSavedIncomeSources());
    expect(atCap).not.toHaveBeenCalled();
  });
});
