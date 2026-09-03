# FE-001-T01: query-consuming screen inventory

Every frontend screen/component that owns a TanStack Query call (`useQuery`
or `useInfiniteQuery`, directly or via a derived hook), and its current
loading/error/empty state coverage as of 2026-09-03. This is the formal
deliverable for FE-001-T01 — the four other completed FE-001 tasks (T02
shared `QueryState` component, T03 explicit error+retry, T04 empty-state
guidance, T05 stale-data preservation, T06 accessibility roles) were applied
against this same set of screens, identified informally during that work
rather than from a written inventory. This document is that inventory,
written after the fact, plus an honest gap list for anything not yet
covered.

Coverage levels used below:

- **Full** — uses the shared `QueryState` component (or an equivalent
  hand-rolled pattern) with genuinely distinct loading / error+retry / empty
  / content states, `role="status"`/`role="alert"` on the transient ones,
  and has a dedicated test file proving the state matrix.
- **Partial** — some states are handled, but at least one of: no distinct
  loading indicator (falls back to looking "empty" while loading), no
  persistent error UI (toast-only, no retry), no ARIA role, or no test
  coverage for the states.
- **None** — the query's loading/error state is not surfaced to the user at
  all.

## Chart & insight screens

| Screen | Query hook(s) | Coverage | Notes |
|---|---|---|---|
| `charts/barchart/BarChartPage.js` | `useBarChartQuery` | Full | `QueryState` + FE-001-T05 stale-data indicator. Tests: `BarChartPage.test.js`. |
| `charts/piechart/PieChartPage.js` | `usePieChartQuery` | Full | `QueryState` + T05. Tests: `PieChartPage.test.js`, `PieChartPage.staleData.test.js`. |
| `charts/linechart/TrendChartPage.js` | `useTrendChartQuery`, `useLoggedYearsQuery` | Full | `QueryState` + T05 on the trend query. `useLoggedYearsQuery` (feeds the year-compare picker) has no separate state UI of its own — acceptable, it's a secondary control list, not primary content. Tests: `TrendChartPage.test.js`, `TrendChartPage.staleData.test.js`. |
| `monthlyInsights/MonthlyInsightPage.js` | `useReport` | Full | Distinct `isLoading`/`isError` states drive what's rendered; feeds `BudgetIntelligence`, `SpendingForecast`, `AnomalyInsights` as presentational children (props only, no query of their own — see below). Tests: `MonthlyInsightPage.test.js`. |
| `monthlyInsights/BudgetIntelligence.js` | *(none — receives `data` prop)* | N/A | Not a query owner. Its own "no insights yet" copy is a display default, not a loading/error state; gated correctly by the parent's `QueryState`. |
| `monthlyInsights/SpendingForecast.js` | *(none — receives `data` prop)* | N/A | Same as above. |
| `monthlyInsights/AnomalyInsights.js` | *(none — receives `data` prop)* | N/A | Same as above. |

## Expense & income screens

| Screen | Query hook(s) | Coverage | Notes |
|---|---|---|---|
| `expensesHandling/ExpensesPage.js` | `useExpensesQuery`, `useInfiniteExpensesQuery` | Partial | Has a distinct loading state (dots) and a distinct empty state ("No Expenses"), so loading isn't confused with empty — good. **Gap: no error state at all.** `isError` is never read; a failed fetch just settles into `loading=false` with an empty `groupedExpenses`, so a real network failure looks identical to "you have no expenses." Tests: `ExpensesPage.test.js`, `ExpensesPage.customInfiniteScroll.test.js` (cover pagination, not the missing error path). |
| `expensesHandling/budget/SetBudget.js` | `useBudgetSummary` (→ `useBudgetsQuery`) | Partial | Has plain-text loading ("Fetching budget...") and error ("Network Error") branches — genuinely distinct, but no ARIA role, no retry action, and no test coverage of these two branches specifically. Tests: `SetBudget.test.js` (doesn't appear to exercise the loading/error branches). |
| `IncomeHandling/IncomeModal.js` | `useInfiniteIncomeQuery` | Partial | Distinct "Loading..." and "No income records found." text. Error is toast-only (`expenseAddErrorToast`) — transient, no persistent in-modal error state or retry. No ARIA role on the loading/empty text. Tests: `IncomeModal.test.js`. |
| `monthlyInsights/Income/OverallInsight.js` | `useIncomeInsightsQuery` | Partial | Each card has its own "no data" fallback copy, but that fallback is what renders **while loading too** (no separate loading indicator) — a slow response looks identical to genuinely no data. Error is `console.error` only, nothing shown to the user. No test file. |
| `monthlyInsights/Income/Header.js` | `useIncomeSummaryQuery` | Partial | Same shape as `OverallInsight.js`: `DEFAULT_CARD_DATA` zeroes feed the same "insufficient data" copy used for genuine emptiness, so loading and empty are visually identical. Error is toast-only. No test file. |
| `monthlyInsights/Header.js` (budget header) | `useBudgetSummary` (→ `useBudgetsQuery`) | None | Calls the hook independently of `SetBudget.js` (its own separate subscription to the same underlying query) purely to read `totalBudget`, and does nothing with `isLoading`/`isError` — renders `₹ {totalBudget}` regardless of query state. Tests: `Header.test.js` (doesn't exercise this). |

## Merchant rules

| Screen | Query hook(s) | Coverage | Notes |
|---|---|---|---|
| `merchantRules/MerchantRules.js` | `useMerchantRulesQuery` | Full | Uses `QueryState` directly. Tests: `MerchantRules.test.js`. |

## Sia (assistant) screens

| Screen | Query hook(s) | Coverage | Notes |
|---|---|---|---|
| `sia/SiaEntryPoint.js` | `useSiaStatusQuery` | Partial | `isCheckingAvailability`/`isSiaAvailable` drive a fail-closed `blockedByAvailability` gate (reasonable: anything but a confirmed-available response disables the composer), and a `role="status"` availability notice exists in `SiaPanel.js`. No distinct handling for a genuine `isError` on the status query itself — it collapses into the same "unavailable" treatment as a real outage, which is defensible (fail closed) but not distinguished in the UI copy. Tests: `SiaEntryPoint.test.js`. |
| `sia/SiaPanel.js` | `useSiaSessionMessagesQuery` | Partial | `isError` on history-message loading is handled (falls back to a fresh conversation + `role="alert"` message). No dedicated loading indicator specifically for `messagesQuery` while switching into a history session. Tests: `SiaPanel.test.js`. |
| `sia/SiaSessionList.js` | `useSiaSessionsQuery` | Full-ish, untested | Genuinely distinct loading / error+retry / empty text with `role="status"`/`role="alert"`, hand-rolled rather than via `QueryState` but equivalent in substance. **No test file exists** (`SiaSessionList.test.js` is missing) — implementation looks complete, but the state matrix isn't proven by a test the way the chart/merchant-rules screens are. |

## Summary

- **Full coverage, tested:** BarChartPage, PieChartPage, TrendChartPage, MonthlyInsightPage, MerchantRules. (5)
- **Partial coverage:** ExpensesPage, SetBudget, IncomeModal, Income/OverallInsight, Income/Header, monthlyInsights/Header (budget), SiaEntryPoint, SiaPanel. (8)
- **Implemented but untested:** SiaSessionList. (1)
- **Not a query owner (correctly excluded):** BudgetIntelligence, SpendingForecast, AnomalyInsights. (3)

The single gap worth prioritizing over the rest: **ExpensesPage has no error state whatsoever** — it's the app's primary data screen, and a real fetch failure currently renders identically to "no expenses," which is actively misleading rather than merely incomplete. Everything else in the Partial bucket is a smaller a11y/polish/loading-vs-empty gap, not a correctness gap.

This inventory is FE-001-T07's scope map: the 4 screens the original audit evidence named (MonthlyInsightPage, BarChartPage, TrendChartPage, PieChartPage) are the "Full coverage, tested" row above and are done; the 8 Partial + 1 untested screens are what a future app-wide T07 pass would work through, in roughly the priority order implied by the summary above.
