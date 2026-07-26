import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

import { ExpenseItem, SetBudget, formatDateRange } from '../imports/expensesImport';

import { useExpenseInsights } from '../contexts/ai-contexts/ExpenseInsightsContext';
import InlineExpenseInsight from '../insights/InlineExpenseInsight' 

const ExpensesPage = ({ onDelete, refreshFlag, setIsEdit }) => {
  // Filter & range state
  const [filter, setFilter] = useState('');
  const [period, setPeriod] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  // Backend data + loading
  const [backendExpenses, setBackendExpenses] = useState([]);
  const [loading, setLoading] = useState(false);

  const location = useLocation();

  // AI Insights hook
  const { 
    notifyInitialLoad, 
    notifyFilterApplied,  
    clearExpenseInsights, 
    insightText, 
    isInsightReady, 
  } = useExpenseInsights(); 

  /**
   * Fetch expenses whenever:
   * - filters change
   * - route changes
   * - delete refresh flag toggles
  */
  useEffect(() => {
   const fetchExpenses = async () => {
     setLoading(true);
     setBackendExpenses([]);
     
     try {
       const token = localStorage.getItem('token');
       
       const BASE_URL = process.env.REACT_APP_BACKEND_URL.replace(/\/$/, "");
       if (!token || !BASE_URL) {
          setLoading(false);
          return;
       }

       let url = '';
       
       if (filter === '') {
         url = `${BASE_URL}/expense/last-week`;
        } else if (filter === 'bycategory' && period) {
          url = `${BASE_URL}/expense/by-category?period=${period}`;
        } else if (filter === 'custom' && startDate && endDate) {
          url = `${BASE_URL}/expense/search?startDate=${startDate}&endDate=${endDate}`;
        } else {
          // Nothing to fetch yet
          setLoading(false);
          return;
        }
        
        const response = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });

        const data = await response.json();
        
        if (response.ok && data.success) {
          setBackendExpenses(data.data);
          
          // AI Insight triggers
          if (filter === "") {
            notifyInitialLoad(data.data, data.previousData, data.weeklyData);
          }
          
          if (filter === "bycategory" && period !== '') {
            notifyFilterApplied(data.data, data.pastThreeMonths, period);
          }
          
        } else {
          setBackendExpenses([]);
        }
      } catch (err) {
        console.error('Network error:', err);
        setBackendExpenses([]);
      } finally {
        setLoading(false);
      }
    };
    
    fetchExpenses();
  }, [filter, period, startDate, endDate, refreshFlag, location.pathname, notifyInitialLoad, notifyFilterApplied]);
  
  /**
   * Expense grouping & totals
   * (derived data — no state needed)
  */
  let groupedExpenses = {};
  let total = 0;
  let categoryTotals = {};
  
  // Compute grouped expenses
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

  return (
    <div className="expenses-page-container">
      {/* Budget Section */}
      <SetBudget />

      {/* Header */}
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

      {/* Loader or Expenses */}
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
        <AnimatePresence>
          {Object.entries(groupedExpenses).map(([category, groupList]) => (
            <div key={category} className="expense-category">
              <h3>{category}</h3>
              <motion.div layout>
                {Array.isArray(groupList) &&
                  groupList.map((exp) => (
                    <motion.div
                      key={exp._id || exp.id}
                      layout
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                    >
                      <ExpenseItem key={exp._id} expense={exp} onDelete={onDelete} setIsEdit={setIsEdit} />
                    </motion.div>
                  ))}
              </motion.div>

              {/* Totals */}
              {filter === 'bycategory' && categoryTotals[category] !== undefined && (
                <div className="total-section">Total ₹{categoryTotals[category].toFixed(2)}</div>
              )}
              {(filter === '' || filter === 'custom') && (
                <div className="total-section">Total ₹{total.toFixed(2)}</div>
              )}
            </div>
          ))}
        </AnimatePresence>
      )}

      {/* Custom date modal */}
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