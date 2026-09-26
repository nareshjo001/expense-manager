import React, { useState, useEffect, useCallback, useRef } from 'react';
// DAT-001-T06 -- all money renders through the shared formatter.
import { formatMoney } from "../../utils/money";
import { motion } from 'framer-motion';
import '../common/QueryState.css';

import { ExpenseItem, SetBudget, formatDateRange } from '../imports/expensesImport';

import { useExpensesQuery } from '../../hooks/queries/useExpensesQuery';
import { useInfiniteExpensesQuery } from '../../hooks/queries/useInfiniteExpensesQuery';
import { useIsMobile } from '../hooks/useIsMobile';
import { useModalA11y } from '../hooks/useModalA11y';

import { useExpenseInsights } from '../contexts/ai-contexts/ExpenseInsightsContext';
import InlineExpenseInsight from '../insights/InlineExpenseInsight'
// EXP-002-T05 -- imported directly (not via ../imports/expensesImport)
// so existing tests that jest.mock that barrel module are unaffected;
// this is a plain, dependency-free presentational component.
import ExpenseFilterBar from './ExpenseFilterBar';
// BUD-001-T05 -- imported directly (not via ../imports/expensesImport) for
// the same reason as ExpenseFilterBar above: existing tests mock that barrel.
import CategoryBudgets from './budget/CategoryBudgets';
// EXP-002-T06 -- ExpensesPage is mounted at "/" inside LandingPage.js's
// <Routes> (itself inside App.js's <BrowserRouter>), so a router context
// is always present in production. Tests mock 'react-router-dom' wholesale
// (this codebase's established pattern -- see AddExpense.test.js/App.
// startup.test.js) rather than wrapping in a real MemoryRouter.
import { useSearchParams } from 'react-router-dom';

const INITIAL_VISIBLE_EXPENSES = 30;
const EXPENSE_RENDER_BATCH_SIZE = 25;

// EXP-002-T05 -- the optional search-filter fields, always held as strings
// (controlled-input shape); ExpensesPage types/trims them into the real
// request params right before the API call. Empty string == "not set" for
// every field, including isRecurring's third "Any" state.
const emptySearchFilters = {
  nameContains: '',
  category: '',
  minAmount: '',
  maxAmount: '',
  isRecurring: '',
};

// EXP-002-T06 -- only these exact values are ever written by this page, so
// only these are trusted back out of a URL (own or shared/bookmarked);
// anything else in the query string is silently ignored rather than
// passed through to a query hook or the recurring-status select.
const KNOWN_FILTER_MODES = ['bycategory', 'custom'];
const KNOWN_PERIODS = ['thismonth', 'thisyear'];
const KNOWN_RECURRING_VALUES = ['true', 'false'];

// Displays the user's expenses with filter/date-range controls and cancellable, race-safe data fetching.
const ExpensesPage = ({ onDelete, setIsEdit }) => {
  // EXP-002-T06 -- initial state loads from the URL once, synchronously,
  // so a shared/bookmarked link reproduces the same view on first render
  // (no flash of the default view before a correction effect fires).
  // `searchParams` itself is never read again after this -- state stays
  // the single source of truth and a one-way effect below (state -> URL)
  // keeps the address bar in sync, which avoids any read/write feedback
  // loop with react-router.
  const [searchParams, setSearchParams] = useSearchParams();

  const [filter, setFilter] = useState(() => {
    const mode = searchParams.get('mode');
    return KNOWN_FILTER_MODES.includes(mode) ? mode : '';
  });
  const [period, setPeriod] = useState(() => {
    const value = searchParams.get('period');
    return KNOWN_PERIODS.includes(value) ? value : '';
  });
  const [startDate, setStartDate] = useState(() => searchParams.get('start') || '');
  const [endDate, setEndDate] = useState(() => searchParams.get('end') || '');
  // EXP-002-T05 -- only meaningful in custom mode (the only mode backed by
  // GET /expense/search); reset alongside startDate/endDate whenever the
  // filter mode changes, same as the date range itself.
  const [searchFilters, setSearchFilters] = useState(() => {
    const recurring = searchParams.get('recurring');
    return {
      nameContains: searchParams.get('name') || '',
      category: searchParams.get('category') || '',
      minAmount: searchParams.get('min') || '',
      maxAmount: searchParams.get('max') || '',
      isRecurring: KNOWN_RECURRING_VALUES.includes(recurring) ? recurring : '',
    };
  });
  const [openMobileMenuId, setOpenMobileMenuId] = useState(null);
  const isMobile = useIsMobile();

  const {
    notifyInitialLoad,
    notifyFilterApplied,
    clearExpenseInsights,
    insightText,
    isInsightReady,
  } = useExpenseInsights();

  const expensesQuery = useExpensesQuery(filter, period);

  // EXP-003-T05 -- the only expense mode with real cursor pagination
  // available server-side; it's driven by its own infinite query rather
  // than the plain one above, and fetches network pages on demand instead
  // of pulling the whole date range up front.
  const isCustomMode = filter === 'custom' && Boolean(startDate) && Boolean(endDate);

  // EXP-002-T05 -- types/trims the raw controlled-input strings into the
  // real request shape right here, once, rather than in the filter bar or
  // the API layer. `undefined` (not '') is what actually omits a param --
  // see api/expenseApi.js's searchExpenses.
  const trimmedNameContains = searchFilters.nameContains.trim();
  const trimmedCategory = searchFilters.category.trim();
  const parsedMinAmount = searchFilters.minAmount === '' ? undefined : Number(searchFilters.minAmount);
  const parsedMaxAmount = searchFilters.maxAmount === '' ? undefined : Number(searchFilters.maxAmount);
  const activeSearchFilters = {
    nameContains: trimmedNameContains || undefined,
    category: trimmedCategory || undefined,
    minAmount: Number.isFinite(parsedMinAmount) ? parsedMinAmount : undefined,
    maxAmount: Number.isFinite(parsedMaxAmount) ? parsedMaxAmount : undefined,
    isRecurring: searchFilters.isRecurring === '' ? undefined : searchFilters.isRecurring === 'true',
  };

  const infiniteExpensesQuery = useInfiniteExpensesQuery(startDate, endDate, isCustomMode, activeSearchFilters);

  // EXP-002-T06 -- one-way sync of the view-defining state into the URL
  // (state -> URL only; see the state-init comment above for why this
  // doesn't also read searchParams back). Deliberately excludes anything
  // that isn't part of "what data am I looking at" -- openMobileMenuId,
  // visibleExpenseCount and the raw infinite-query cursor state stay out.
  // Deliberately INCLUDES the four EXP-002-T01 search filters (not just
  // mode/period/dates): this is a personal, single-owner finance app (no
  // shared workspaces), the values are the user's own search terms over
  // their own authenticated data, and the whole point of T06 is making
  // this feature's stated goal -- "investigate spending or find a
  // specific transaction" -- bookmarkable/shareable, which a URL missing
  // the actual filters wouldn't achieve. Always a replace (never push) so
  // typing in the filter bar doesn't spam browser history.
  useEffect(() => {
    const nextParams = new URLSearchParams();

    if (filter) nextParams.set('mode', filter);
    if (filter === 'bycategory' && period) nextParams.set('period', period);

    if (filter === 'custom') {
      if (startDate) nextParams.set('start', startDate);
      if (endDate) nextParams.set('end', endDate);
      if (trimmedNameContains) nextParams.set('name', trimmedNameContains);
      if (trimmedCategory) nextParams.set('category', trimmedCategory);
      if (searchFilters.minAmount !== '') nextParams.set('min', searchFilters.minAmount);
      if (searchFilters.maxAmount !== '') nextParams.set('max', searchFilters.maxAmount);
      if (searchFilters.isRecurring !== '') nextParams.set('recurring', searchFilters.isRecurring);
    }

    setSearchParams(nextParams, { replace: true });
  }, [
    filter,
    period,
    startDate,
    endDate,
    trimmedNameContains,
    trimmedCategory,
    searchFilters.minAmount,
    searchFilters.maxAmount,
    searchFilters.isRecurring,
    setSearchParams,
  ]);

  const backendExpenses = isCustomMode
    ? (infiniteExpensesQuery.data?.pages ?? []).flatMap((page) => (page?.success ? page.data : []))
    : expensesQuery.data?.success ? expensesQuery.data.data : [];
  const loading = isCustomMode ? infiniteExpensesQuery.isLoading : expensesQuery.isLoading;
  // Improvements-#13/FE-001-T08 -- previously unread: a genuine fetch
  // failure left `loading` false and `groupedExpenses` empty, which
  // rendered identically to "you have no expenses" on the app's main
  // data screen. Surfaced as its own distinct, retryable state below.
  const isExpensesError = isCustomMode ? infiniteExpensesQuery.isError : expensesQuery.isError;
  const refetchActiveExpenses = isCustomMode ? infiniteExpensesQuery.refetch : expensesQuery.refetch;
  const loadMoreRef = useRef(null);

  // FE-a11y: the custom-date-range overlay had no dialog semantics -- no
  // role="dialog", no focus trap, no Escape handling. isCustomRangeOpen
  // mirrors the same condition the overlay itself renders under, below.
  const customRangeDialogRef = useRef(null);
  const isCustomRangeOpen = filter === 'custom' && (!startDate || !endDate);
  useModalA11y(customRangeDialogRef, () => setFilter(''), isCustomRangeOpen);
  const [visibleExpenseCount, setVisibleExpenseCount] = useState(INITIAL_VISIBLE_EXPENSES);

  // useQuery no longer supports an onSuccess callback, so insight notifications run here instead, once per new successful fetch.
  useEffect(() => {
    if (!expensesQuery.data?.success) return;

    if (filter === "") {
      notifyInitialLoad(expensesQuery.data.data, expensesQuery.data.previousData, expensesQuery.data.weeklyData);
    }

    if (filter === "bycategory" && period !== '') {
      notifyFilterApplied(expensesQuery.data.data, expensesQuery.data.pastThreeMonths, period);
    }
  }, [expensesQuery.data, filter, period, notifyInitialLoad, notifyFilterApplied]);

  // Derives grouped expenses and totals from backendExpenses — no separate state needed.
  let groupedExpenses = {};
  let total = 0;
  let categoryTotals = {};

  if (filter === '') {
    if (backendExpenses.length > 0) {
      groupedExpenses = { 'Last Week Expenses': backendExpenses };
      total = backendExpenses.reduce((sum, exp) => sum + exp.expenseAmount, 0);
    }
  } else if (filter === 'bycategory') {
    if (backendExpenses && Object.keys(backendExpenses).length > 0 && period) {
      groupedExpenses = backendExpenses;
      categoryTotals = Object.entries(groupedExpenses).reduce((totals, [cat, exps]) => {
        totals[cat] = Array.isArray(exps) ? exps.reduce((sum, exp) => sum + exp.expenseAmount, 0) : 0;
        return totals;
      }, {});
    }
  } else if (filter === 'custom') {
    if (backendExpenses.length > 0) {
      const label = formatDateRange(startDate, endDate);
      groupedExpenses = { [label]: backendExpenses };
      total = backendExpenses.reduce((sum, exp) => sum + exp.expenseAmount, 0);
    }
  }

  const totalExpenseCount = Object.values(groupedExpenses).reduce(
    (count, groupList) => count + (Array.isArray(groupList) ? groupList.length : 0),
    0
  );
  // EXP-003-T05 -- in custom mode, "more" means another network page exists
  // (server-driven); otherwise it means more of the already-fetched array
  // hasn't been revealed to the DOM yet (client-side windowing, unchanged).
  const hasMoreExpenses = isCustomMode
    ? Boolean(infiniteExpensesQuery.hasNextPage)
    : visibleExpenseCount < totalExpenseCount;

  // Preserve the existing filter/API behavior while keeping the DOM small.
  useEffect(() => {
    setVisibleExpenseCount(INITIAL_VISIBLE_EXPENSES);
  }, [filter, period, startDate, endDate, expensesQuery.dataUpdatedAt]);

  // On mobile, one page-level menu state prevents multiple cards from being open.
  // A pointer outside an action button or its menu closes the current one.
  useEffect(() => {
    if (!isMobile) {
      setOpenMobileMenuId(null);
      return undefined;
    }

    if (!openMobileMenuId) return undefined;

    const closeOnOutsidePointerDown = (event) => {
      const target = event.target;
      if (target?.closest?.('.mobile-menu, .mobile-menu-btn')) return;

      setOpenMobileMenuId(null);
    };

    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
  }, [isMobile, openMobileMenuId]);

  // The page's fade animation creates a stacking context below the global SIA
  // launcher. Hide that launcher only while a mobile expense menu is active.
  useEffect(() => {
    const mobileMenuIsOpen = isMobile && Boolean(openMobileMenuId);
    document.body.classList.toggle('mobile-expense-menu-open', mobileMenuIsOpen);

    return () => document.body.classList.remove('mobile-expense-menu-open');
  }, [isMobile, openMobileMenuId]);

  const revealMoreExpenses = useCallback(() => {
    if (isCustomMode) {
      if (!infiniteExpensesQuery.isFetchingNextPage) {
        infiniteExpensesQuery.fetchNextPage();
      }
      return;
    }
    setVisibleExpenseCount((current) => Math.min(current + EXPENSE_RENDER_BATCH_SIZE, totalExpenseCount));
  }, [isCustomMode, infiniteExpensesQuery, totalExpenseCount]);

  useEffect(() => {
    if (!hasMoreExpenses) return undefined;

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      // Degraded fallback (no IntersectionObserver support): reveal
      // everything already fetched for the client-windowed modes, or fetch
      // exactly one more network page for the infinite (custom) mode --
      // never loop-fetch the entire range up front.
      if (isCustomMode) {
        revealMoreExpenses();
      } else {
        setVisibleExpenseCount(totalExpenseCount);
      }
      return undefined;
    }

    const target = loadMoreRef.current;
    if (!target) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) revealMoreExpenses();
      },
      { rootMargin: '900px 0px' }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreExpenses, revealMoreExpenses, totalExpenseCount, isCustomMode]);

  // EXP-003-T05 -- custom mode's `backendExpenses` only ever holds pages
  // already fetched from the network (bounded by PAGE_SIZE per page), so it
  // needs no further client-side truncation; the other modes still window
  // their single, fully-fetched array to keep the DOM small.
  let remainingVisibleExpenses = visibleExpenseCount;
  const visibleGroups = isCustomMode
    ? Object.entries(groupedExpenses).filter(([, groupList]) => Array.isArray(groupList) && groupList.length > 0)
    : Object.entries(groupedExpenses)
        .map(([category, groupList]) => {
          const visibleItems = Array.isArray(groupList)
            ? groupList.slice(0, Math.max(remainingVisibleExpenses, 0))
            : [];
          remainingVisibleExpenses -= visibleItems.length;
          return [category, visibleItems];
        })
        .filter(([, groupList]) => groupList.length > 0);

  return (
    <div className="expenses-page-container">
      <SetBudget />
      <CategoryBudgets />

      <div className="header">
        {Object.keys(groupedExpenses).length !== 0 && <p className="big-screen" style={{ fontWeight: 450, fontSize: '20px' }}>Your Expenses</p>}
        <div className="select-group">
          {filter === 'bycategory' && (
            <select className="select-button filter-button" value={period} onChange={(e) => { setPeriod(e.target.value); clearExpenseInsights();}}>
              <option value="">View By</option>
              <option value="thismonth">This Month</option>
              <option value="thisyear">This Year</option>
            </select>
          )}
          <select
            className="select-button filter-button"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPeriod('');
              setStartDate('');
              setEndDate('');
              setSearchFilters(emptySearchFilters);
              clearExpenseInsights();
            }}
          >
            <option value="">Filter By</option>
            <option value="bycategory">Category</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        { Object.keys(groupedExpenses).length !== 0 && <p className="mobile-view">Your Expenses</p>}
      </div>

      {isInsightReady && <InlineExpenseInsight items={insightText} />}

      {isCustomMode && (
        <ExpenseFilterBar
          filters={searchFilters}
          onChange={setSearchFilters}
          onClear={() => setSearchFilters(emptySearchFilters)}
        />
      )}

      {loading ? (
        <div className="loading-dots">
          <span></span><span></span><span></span>
        </div>
      ) : isExpensesError ? (
        <div className="query-state query-state-error" role="alert" aria-live="assertive">
          <p className="query-state-message">We couldn't load your expenses. Please try again.</p>
          <button
            type="button"
            className="query-state-retry"
            onClick={() => refetchActiveExpenses?.()}
          >
            Retry
          </button>
        </div>
      ) : Object.keys(groupedExpenses).length === 0 ? (
        <motion.p
          key="no-expenses"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{ textAlign: 'center', fontWeight: 450, fontSize: '30px' }}
        >
          No Expenses
        </motion.p>
      ) : (
        <>
          {visibleGroups.map(([category, groupList]) => (
            <div key={category} className="expense-category">
              <h3>{category}</h3>
              <div>
                {Array.isArray(groupList) &&
                  groupList.map((exp) => {
                    const expenseId = String(exp._id || exp.id);
                    return (
                      <ExpenseItem
                        key={expenseId}
                        expense={exp}
                        onDelete={onDelete}
                        setIsEdit={setIsEdit}
                        isMobileMenuOpen={isMobile && openMobileMenuId === expenseId}
                        onToggleMobileMenu={() => {
                          setOpenMobileMenuId((current) => current === expenseId ? null : expenseId);
                        }}
                        onCloseMobileMenu={() => setOpenMobileMenuId(null)}
                      />
                    );
                  })}
              </div>

              {filter === 'bycategory' && categoryTotals[category] !== undefined && (
                <div className="total-section">Total {formatMoney(categoryTotals[category])}</div>
              )}
              {(filter === '' || filter === 'custom') && (
                <div className="total-section">Total {formatMoney(total)}</div>
              )}
            </div>
          ))}
          {hasMoreExpenses && (
            <div ref={loadMoreRef} className="expense-load-more" role="status" aria-live="polite">
              Loading more expenses…
            </div>
          )}
        </>
      )}

      {filter === 'custom' && (!startDate || !endDate) && (
        <div className="box-overlay" onClick={() => setFilter('')}>
          <div
            className="custom-range-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-range-heading"
            ref={customRangeDialogRef}
            tabIndex={-1}
          >
            <p id="custom-range-heading">Choose the custom date range...</p>

            <div className="custom-modal-inputs">
              <input
                type="date"
                aria-label="Start date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />

              <input
                type="date"
                aria-label="End date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default ExpensesPage;
