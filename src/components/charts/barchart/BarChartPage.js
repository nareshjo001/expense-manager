import React, { useState, useContext, useEffect } from 'react';
import '../ChartPage.css';
import { motion, AnimatePresence } from 'framer-motion';

// Chart-related utility functions and components
import {
  ThemeContext,
  BarChartWrapper
} from '../../imports/chartsImport';

import icons from '../../imports/iconsImport';

import { useChartInsights } from '../../contexts/ai-contexts/ChartInsightsContext';
import InlineChartInsight from '../../insights/InlineChartInsight';

const BarChartPage = ({ expenses }) => {
  const { theme } = useContext(ThemeContext); // Get current theme (light/dark)
  const { notifyChartFilterApplied, clearChartInsights, isChartInsightReady, chartInsightText } =  useChartInsights();

  // State variables for filters
  const [viewBy, setViewBy] = useState(''); // Filter type (bymonth/bycategory)
  const [selectedYear, setSelectedYear] = useState(''); // Year for monthly view
  const [month, setMonth] = useState(''); // Month for specific category view
  const [specificMonth, setSpecificMonth] = useState(false); // Toggle for specific month view
  const [fetchedDataForBar, setFetchedDataForBar] = useState([]);

  useEffect(() => {
    clearChartInsights();
  }, [clearChartInsights]);

  useEffect(() => {
    const getExpensesForBar = async () => {
      try {
        const token = localStorage.getItem('token');
        const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
        let url = "";

        if (viewBy === 'bycategory' && !specificMonth) {
          url = `${BASE_URL}/auth/barchartbycategory`;
        } else if (viewBy === 'bycategory' && specificMonth && month) {
          url = `${BASE_URL}/auth/barchartbycategory?month=${month}`;
        } else if (viewBy === 'bymonth' && selectedYear.length === 4) {
          url = `${BASE_URL}/auth/barchartbymonth?year=${selectedYear}`;
        }

        if (!url) return;

        const response = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });

        const backendData = await response.json();

        if (backendData.success && Array.isArray(backendData.data)) {
          setFetchedDataForBar(backendData.data);
          notifyChartFilterApplied(backendData.data, 'bar', viewBy);
        } else {
          setFetchedDataForBar([]);
        }

      } catch (err) {
        console.error("Network error:", err);
      }
    };

    getExpensesForBar();
  }, [viewBy, month, specificMonth, selectedYear, notifyChartFilterApplied]);

  useEffect(() => {
    if (specificMonth && !month) {
      setFetchedDataForBar([]);
    }
  }, [specificMonth, month]);

  let data = fetchedDataForBar;

  // Handler for changing the "View By" filter
  const handleViewChange = (e) => {
    const newView = e.target.value;
    setViewBy(newView);
    setSelectedYear('');
    setMonth('');
    setSpecificMonth(false);

    setFetchedDataForBar([]);
    clearChartInsights();
  };

  // Only show chart if data is available
  const shouldRenderChart = data.length > 0;

  // Determine header title and icon based on selected view
  const getHeaderDetails = (viewBy) => {
    switch (viewBy) {
      case 'bymonth':
        return { title: 'Monthly Budget vs Spending', url: icons.monthIcon };
      case 'bycategory':
        return { title: 'Category-wise Breakdown', url: icons.categoryIcon };
      default:
        return { title: 'Visualize Your Expenses', url: icons.viewIcon };
    }
  };

  const { title, url } = getHeaderDetails(viewBy);
 
  return (
    <div className="chart-container">
      {/* Header Section */}
      <div className="chart-header">
        {/* Animate header change based on view type */}
        <motion.div
          key={viewBy}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="text-center mb-6"
        >
          <div className="heading">
            <img src={url} className="chart-icon-button" alt="Icon" />
            <h1 className="text-2xl font-bold text-[var(--text-color)]">{title}</h1>
          </div>
        </motion.div>

        {/* Filter Controls */}
        <div className="chart-filters">
          {/* Show month selector if category + specific month is selected */}
          {viewBy === 'bycategory' && specificMonth && (
            <input
              type="month"
              className="select-button filter-button"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          )}

          {/* Show year selector for monthly view */}
          {viewBy === 'bymonth' && (
            <input
              type="number"
              className="select-button filter-button"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              placeholder="Year?"
              min="2025"
              max="2030"
            />
          )}

          {/* View By dropdown */}
          <select
            className="select-button filter-button"
            value={viewBy}
            onChange={handleViewChange}
          >
            <option value="">View By</option>
            <option value="bymonth">Month</option>
            <option value="bycategory">Category</option>
          </select>
        </div>
      </div>

      {/* Checkbox to toggle specific month filter */}
      {viewBy === 'bycategory' && (
        <div className="compare-by-year">
          <input
            type="checkbox"
            name="compare-by-year"
            id="compare-checkbox"
            onChange= {(e) => {
              const checked = e.target.checked;
              setSpecificMonth(checked);

              clearChartInsights();
            }}
          />
          <label htmlFor="compare-checkbox">View for specific month</label>
        </div>
      )}

      {/* Message for no filter selected */}
      {viewBy === '' && (
        <p style={{ textAlign: 'center', fontSize: '20px' }}>
          Select desirable filter to visualize!
        </p>
      )}

      {viewBy === 'bycategory' && !specificMonth && (
        <p style={{ textAlign: 'center', fontSize: '15px', marginBottom: '8px' }}>
          Current Year's Breakdown
        </p>
      )}

      {/* Chart Rendering */}
      <AnimatePresence mode="wait">
        {shouldRenderChart && (
          <motion.div
            key={`${viewBy}-${specificMonth}-${selectedYear}`}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.5 }}
            className="chart-content"
          >
            <BarChartWrapper
              data={data}
              xKey={viewBy === 'bymonth' ? 'month' : 'category'}
              barKey="total"
              secondBarKey={viewBy === 'bymonth' ? 'budget' : null}
              showDoubleBar={viewBy === 'bymonth'}
              theme={theme}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {isChartInsightReady && <InlineChartInsight item={chartInsightText} />}
    </div>
  );
};

export default BarChartPage;