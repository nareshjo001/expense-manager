import React, { useState, useContext, useEffect } from 'react';
import '../ChartPage.css';
import { motion, AnimatePresence } from 'framer-motion';

import {
  ThemeContext,
  BarChartWrapper
} from '../../imports/chartsImport';

import icons from '../../imports/iconsImport';

import { useChartInsights } from '../../contexts/ai-contexts/ChartInsightsContext';
import InlineChartInsight from '../../insights/InlineChartInsight';
import { useBarChartQuery } from '../../../hooks/queries/useBarChartQuery';

// Bar chart view of expenses by month or category, with cancellable data fetching per filter change.
const BarChartPage = ({ expenses }) => {
  const { theme } = useContext(ThemeContext);
  const { notifyChartFilterApplied, clearChartInsights, isChartInsightReady, chartInsightText } =  useChartInsights();

  const [viewBy, setViewBy] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [month, setMonth] = useState('');
  const [specificMonth, setSpecificMonth] = useState(false);

  useEffect(() => {
    clearChartInsights();
  }, [clearChartInsights]);

  const barChartQuery = useBarChartQuery(viewBy, month, specificMonth, selectedYear);

  // useQuery no longer supports an onSuccess callback, so the chart insight notification runs here instead, once per new successful fetch.
  useEffect(() => {
    if (barChartQuery.data?.success && Array.isArray(barChartQuery.data.data)) {
      notifyChartFilterApplied(barChartQuery.data.data, 'bar', viewBy);
    }
  }, [barChartQuery.data, viewBy, notifyChartFilterApplied]);

  const data =
    barChartQuery.data?.success && Array.isArray(barChartQuery.data.data)
      ? barChartQuery.data.data
      : [];

  const handleViewChange = (e) => {
    const newView = e.target.value;
    setViewBy(newView);
    setSelectedYear('');
    setMonth('');
    setSpecificMonth(false);

    clearChartInsights();
  };

  const shouldRenderChart = data.length > 0;

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
      <div className="chart-header">
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

        <div className="chart-filters">
          {viewBy === 'bycategory' && specificMonth && (
            <input
              type="month"
              className="select-button filter-button"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          )}

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