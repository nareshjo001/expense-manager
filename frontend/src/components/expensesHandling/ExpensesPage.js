import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import '../common/QueryState.css';

import { ExpenseItem, SetBudget, formatDateRange } from '../imports/expensesImport';

import { useExpensesQuery } from '../../hooks/queries/useExpensesQuery';
import { useInfiniteExpensesQuery } from '../../hooks/queries/useInfiniteExpensesQuery';
import { useIsMobile } from '../hooks/useIsMobile';

import { useExpenseInsights } from '../contexts/ai-contexts/ExpenseInsightsContext';
import InlineExpenseInsight from '../insights/InlineExpenseInsight'

const INITIAL_VISIBLE_EXPENSES = 30;
const EXPENSE_RENDER_BATCH_SIZE = 25;

// Displays the user's expenses with filter/date-range controls and cancellable, race-safe data fetching.
const ExpensesPage = ({ onDelete, setIsEdit }) => {
  const [filter, setFilter] = useState('');
  const [period, setPeriod] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
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
  const infiniteExpensesQuery = useInfiniteExpensesQuery(startDate, endDate, isCustomMode);

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
                <div className="total-section">Total ₹{categoryTotals[category].toFixed(2)}</div>
              )}
              {(filter === '' || filter === 'custom') && (
                <div className="total-section">Total ₹{total.toFixed(2)}</div>
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
          >
            <p>Choose the custom date range...</p>

            <div className="custom-modal-inputs">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />

              <input
                type="date"
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
