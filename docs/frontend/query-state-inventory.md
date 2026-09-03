# FE-001-T01: query-consuming screen inventory

Every frontend screen/component that owns a TanStack Query call (`useQuery`
or `useInfiniteQuery`, directly or via a derived hook), and its current
loading/error/empty state coverage as of 2026-09-03 (updated for FE-001-T08,
see below). This is the formal deliverable for FE-001-T01 — the four other
completed FE-001 tasks (T02 shared `QueryState` component, T03 explicit
error+retry, T04 empty-state guidance, T05 stale-data preservation, T06
accessibility roles) were applied against this same set of screens,
identified informally during that work rather than from a written
inventory. This document is that inventory, written after the fact, plus an
honest gap list for anything not yet covered.

**FE-001-T08 update:** closed every remaining Partial/untested gap listed
below -- ExpensesPage's missing error state (Improvements-#13), then the 8
Partial screens and SiaSessionList's missing test file. All 14 query-owning
screens in this inventory are now Full coverage. See each row's Notes for
what changed and the state-matrix test file proving it.

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
| `expensesHandling/ExpensesPage.js` | `useExpensesQuery`, `useInfiniteExpensesQuery` | Full | Has a distinct loading state (dots) and a distinct empty state ("No Expenses"). Improvements-#13/FE-001-T08: added a distinct, retryable `role="alert"` error state (reusing `QueryState`'s CSS) for both the default/category query and the custom-range infinite query -- previously `isError` was never read, so a failed fetch looked identical to "you have no expenses." Tests: `ExpensesPage.test.js`, `ExpensesPage.customInfiniteScroll.test.js`, `ExpensesPage.errorState.test.js`. |
| `expensesHandling/budget/SetBudget.js` | `useBudgetSummary` (→ `useBudgetsQuery`) | Full | FE-001-T08: loading/error branches now carry `role="status"`/`role="alert"`, and the error branch offers a Retry wired to a new `refetchBudgets` returned from `useBudgetSummary`. Tests: `SetBudget.test.js`. |
| `IncomeHandling/IncomeModal.js` | `useInfiniteIncomeQuery` | Full | FE-001-T08: loading/empty text now carry `role="status"`; a failed fetch now also shows a persistent, retryable `role="alert"` block in the list area (the existing toast is unchanged, kept as supplementary immediate feedback). Tests: `IncomeModal.test.js`. |
| `monthlyInsights/Income/OverallInsight.js` | `useIncomeInsightsQuery` | Full | FE-001-T08: wrapped in the shared `QueryState` for loading/error, so the per-card "no data" fallback is now reached only on a genuinely successful, empty response. Error is now shown via `QueryState` with Retry (the `console.error` call is kept as supplementary dev logging). Tests: `OverallInsight.test.js` (new). |
| `monthlyInsights/Income/Header.js` | `useIncomeSummaryQuery` | Full | FE-001-T08: the total-income box and the 3-card grid each now show their own distinct `role="status"`/`role="alert"` (with Retry on the card grid) instead of falling through to `DEFAULT_CARD_DATA`'s zeroed copy while loading; the period selector and title stay usable throughout. The existing toast is unchanged. Tests: `Header.test.js` (new). |
| `monthlyInsights/Header.js` (budget header) | `useBudgetSummary` (→ `useBudgetsQuery`) | Full | FE-001-T08: now renders a distinct `role="status"`/`role="alert"` (with Retry) for its own `budgetStatus` instead of rendering `₹ {totalBudget}` (defaulting to 0) regardless of query state, and disables the Edit-budget button until the total is actually ready. Tests: `Header.test.js`. |

## Merchant rules

| Screen | Query hook(s) | Coverage | Notes |
|---|---|---|---|
| `merchantRules/MerchantRules.js` | `useMerchantRulesQuery` | Full | Uses `QueryState` directly. Tests: `MerchantRules.test.js`. |

## Sia (assistant) screens

| Screen | Query hook(s) | Coverage | Notes |
|---|---|---|---|
| `sia/SiaEntryPoint.js` | `useSiaStatusQuery` | Full | `isCheckingAvailability`/`isSiaAvailable` drive the fail-closed `blockedByAvailability` gate (unchanged: anything but a confirmed-available response disables the composer). FE-001-T08: now also passes `isAvailabilityError={statusQuery.isError}` down to `SiaPanel.js` so its `role="status"` notice can distinguish a genuine status-query failure from a clean `available: false` response, without changing the fail-closed behavior itself. Tests: `SiaEntryPoint.test.js`. |
| `sia/SiaPanel.js` | `useSiaSessionMessagesQuery` | Full | `isError` on history-message loading is handled (falls back to a fresh conversation + `role="alert"` message). FE-001-T08: added a `role="status"` "Opening conversation…" indicator for the window between selecting a history session and `messagesQuery` resolving (previously nothing indicated a session was opening, since `mode` stays `HISTORY` until hydrate succeeds); also renders the distinct availability-error copy described above. Tests: `SiaPanel.test.js`. |
| `sia/SiaSessionList.js` | `useSiaSessionsQuery` | Full | Genuinely distinct loading / error+retry / empty text with `role="status"`/`role="alert"`, hand-rolled rather than via `QueryState` but equivalent in substance. FE-001-T08: added the missing `SiaSessionList.test.js`, proving the state matrix plus the inline delete-confirm flow. |

## Summary

- **Full coverage, tested:** BarChartPage, PieChartPage, TrendChartPage, MonthlyInsightPage, MerchantRules, ExpensesPage, SetBudget, IncomeModal, Income/OverallInsight, Income/Header, monthlyInsights/Header (budget), SiaEntryPoint, SiaPanel, SiaSessionList. (14)
- **Partial coverage:** none remaining.
- **Implemented but untested:** none remaining.
- **Not a query owner (correctly excluded):** BudgetIntelligence, SpendingForecast, AnomalyInsights. (3)

This inventory was FE-001-T07's scope map (the 4 screens the original audit
evidence named -- MonthlyInsightPage, BarChartPage, TrendChartPage,
PieChartPage -- were already Full) and FE-001-T08's punch list (the
remaining 9: ExpensesPage's error-state gap, closed first as the single
correctness-level issue since it's the app's primary data screen and a real
fetch failure rendered identically to "no expenses"; then the 8
Partial/untested a11y/polish/loading-vs-empty screens above, in the priority
order implied by the original summary). Every query-owning screen in this
inventory is now Full coverage.
