import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';

import { ExpenseItem, SetBudget, formatDateRange } from '../imports/expensesImport';

import { useExpensesQuery } from '../../hooks/queries/useExpensesQuery';

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

  const {
    notifyInitialLoad,
    notifyFilterApplied,
    clearExpenseInsights,
    insightText,
    isInsightReady,
  } = useExpenseInsights();

  const expensesQuery = useExpensesQuery(filter, period, startDate, endDate);
  const backendExpenses = expensesQuery.data?.success ? expensesQuery.data.data : [];
  const loading = expensesQuery.isLoading;
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
  const hasMoreExpenses = visibleExpenseCount < totalExpenseCount;

  // Preserve the existing filter/API behavior while keeping the DOM small.
  // A new result or filter starts from the first batch rather than rendering
  // every matching card at once.
  useEffect(() => {
    setVisibleExpenseCount(INITIAL_VISIBLE_EXPENSES);
  }, [filter, period, startDate, endDate, expensesQuery.dataUpdatedAt]);

  const revealMoreExpenses = useCallback(() => {
    setVisibleExpenseCount((current) => Math.min(current + EXPENSE_RENDER_BATCH_SIZE, totalExpenseCount));
  }, [totalExpenseCount]);

  useEffect(() => {
    if (!hasMoreExpenses) return undefined;

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setVisibleExpenseCount(totalExpenseCount);
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
  }, [hasMoreExpenses, revealMoreExpenses, totalExpenseCount]);

  let remainingVisibleExpenses = visibleExpenseCount;
  const visibleGroups = Object.entries(groupedExpenses)
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
                  groupList.map((exp) => (
                    <ExpenseItem key={exp._id || exp.id} expense={exp} onDelete={onDelete} setIsEdit={setIsEdit} />
                  ))}
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
