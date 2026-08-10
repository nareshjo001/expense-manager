import { renderHook } from "@testing-library/react";
import { useBudgetSummary } from "./useBudgetSummary";

// Phase C.2 -- GET /api/getbudgets additively returns `recoveryPending`
// (boolean) and `staleMonths` (month-key strings) whenever a prior
// mutation's budget recalculation is still catching up (see
// Controllers/BudgetControllers/getbudgets.js). These tests prove
// useBudgetSummary -- the single funnel every budget-spend display goes
// through -- correctly derives `recoveryPending`/`isCurrentMonthStale` from
// that response, and never throws on older/mocked shapes that omit the
// fields entirely.
jest.mock("./useBudgetsQuery", () => ({
  useBudgetsQuery: jest.fn(),
}));

const { useBudgetsQuery } = require("./useBudgetsQuery");

const CURRENT_MONTH =
  new Date().toLocaleString("default", { month: "short" }) + " " + new Date().getFullYear();

afterEach(() => {
  jest.clearAllMocks();
});

describe("useBudgetSummary -- Phase C.2 stale-state derivation", () => {
  it("defaults recoveryPending/isCurrentMonthStale to false when the response omits both fields", () => {
    useBudgetsQuery.mockReturnValue({
      data: { success: true, data: [{ month: CURRENT_MONTH, budget: 5000, spent: 1200 }] },
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useBudgetSummary());

    expect(result.current.recoveryPending).toBe(false);
    expect(result.current.isCurrentMonthStale).toBe(false);
  });

  it("does not flag the current month stale when recoveryPending is true but staleMonths names a different month", () => {
    useBudgetsQuery.mockReturnValue({
      data: {
        success: true,
        data: [{ month: CURRENT_MONTH, budget: 5000, spent: 1200 }],
        recoveryPending: true,
        staleMonths: ["Jan 2020"],
      },
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useBudgetSummary());

    expect(result.current.recoveryPending).toBe(true);
    expect(result.current.isCurrentMonthStale).toBe(false);
  });

  it("flags isCurrentMonthStale true when recoveryPending is true and the current month is in staleMonths", () => {
    useBudgetsQuery.mockReturnValue({
      data: {
        success: true,
        data: [{ month: CURRENT_MONTH, budget: 5000, spent: 1200 }],
        recoveryPending: true,
        staleMonths: [CURRENT_MONTH],
      },
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useBudgetSummary());

    expect(result.current.recoveryPending).toBe(true);
    expect(result.current.isCurrentMonthStale).toBe(true);
    // The existing stored value is still surfaced -- never hidden/blocked.
    expect(result.current.monthlyBudgets).toEqual([
      { month: CURRENT_MONTH, budget: 5000, spent: 1200 },
    ]);
  });

  it("does not flag the current month stale when recoveryPending is false, even if staleMonths is non-empty (stale marker only trusted alongside its own flag)", () => {
    useBudgetsQuery.mockReturnValue({
      data: {
        success: true,
        data: [{ month: CURRENT_MONTH, budget: 5000, spent: 1200 }],
        recoveryPending: false,
        staleMonths: [CURRENT_MONTH],
      },
      isLoading: false,
      isError: false,
    });

    const { result } = renderHook(() => useBudgetSummary());

    expect(result.current.isCurrentMonthStale).toBe(false);
  });
});
