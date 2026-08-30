"use strict";

const mockFetchExpenseRaw = jest.fn().mockResolvedValue([]);

jest.mock("../Controllers/GetExpenseControllers/fetchExpenses", () => ({
  fetchExpenseRaw: mockFetchExpenseRaw,
}));

jest.mock("../Controllers/BudgetControllers/fetchBudgets", () => ({
  fetchBudgets: jest.fn().mockResolvedValue([]),
}));

const {
  getCurrentMonthExpenses,
  getPreviousMonthExpenses,
  getCurrentYearExpenses,
  getPreviousYearExpenses,
} = require("../analytics/dataProvider");

describe("analytics data-provider inclusive date ranges", () => {
  beforeEach(() => {
    mockFetchExpenseRaw.mockClear();
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 30, 12));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    ["current month", getCurrentMonthExpenses, new Date(2026, 7, 1), new Date(2026, 8, 1, 0, 0, 0, -1)],
    ["previous month", getPreviousMonthExpenses, new Date(2026, 6, 1), new Date(2026, 7, 1, 0, 0, 0, -1)],
    ["current year", getCurrentYearExpenses, new Date(2026, 0, 1), new Date(2027, 0, 1, 0, 0, 0, -1)],
    ["previous year", getPreviousYearExpenses, new Date(2025, 0, 1), new Date(2026, 0, 1, 0, 0, 0, -1)],
  ])("includes the full final calendar day for the %s range", async (_label, getter, expectedStart, expectedEnd) => {
    await getter("user-1");

    expect(mockFetchExpenseRaw).toHaveBeenCalledWith(expectedStart, expectedEnd, "user-1");
    expect(mockFetchExpenseRaw.mock.calls[0][1].getHours()).toBe(23);
    expect(mockFetchExpenseRaw.mock.calls[0][1].getMinutes()).toBe(59);
    expect(mockFetchExpenseRaw.mock.calls[0][1].getSeconds()).toBe(59);
    expect(mockFetchExpenseRaw.mock.calls[0][1].getMilliseconds()).toBe(999);
  });

  it("uses the supplied analysis date instead of the process clock", async () => {
    jest.setSystemTime(new Date(2030, 0, 1, 12));
    const analysisDate = new Date(2026, 7, 30, 12);

    await getCurrentMonthExpenses("user-1", analysisDate);

    expect(mockFetchExpenseRaw).toHaveBeenCalledWith(
      new Date(2026, 7, 1),
      new Date(2026, 8, 1, 0, 0, 0, -1),
      "user-1"
    );
  });
});
