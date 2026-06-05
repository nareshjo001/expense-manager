import React, { useState, useContext, useEffect } from 'react';
import Select from 'react-select';
import { motion, AnimatePresence } from 'framer-motion'
import '../ChartPage.css';
import {
  ThemeContext,
  TrendChartWrapper,
  MultiTrendChartWrapper,
  getSelectStyles
} from '../../imports/chartsImport';
import icons from '../../imports/iconsImport';

import { useChartInsights } from '../../contexts/ai-contexts/ChartInsightsContext';
import InlineChartInsight from '../../insights/InlineChartInsight';

const TrendChartPage = ({ expenses }) => {

  const { theme } = useContext(ThemeContext);

  // State for user-selected filters
  const [viewBy, setViewBy] = useState(''); // current view filter: week/month/year
  const [selectedMonthYear, setSelectedMonthYear] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [compareByYear, setCompareByYear] = useState(false); // if comparing multiple years
  const [selectedYears, setSelectedYears] = useState([]); // years selected for comparison
  const [fetchedData, setFetchedData] = useState([]);
  const [availableYears, setAvailableYears] = useState([]);

  const { notifyChartFilterApplied, clearChartInsights, isChartInsightReady, chartInsightText } =  useChartInsights();

  useEffect(() => {
    clearChartInsights();
  }, [clearChartInsights]);

  useEffect(() => {
    const getExpenses = async () => {
      try {
        const token = localStorage.getItem('token');
        const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
        let url = "";

        if (viewBy === 'week' && selectedMonthYear) {
          const [year, month] = selectedMonthYear.split('-');
          url = `${BASE_URL}/auth/linechartbyweek?selectedYear=${year}&selectedMonth=${month}`;
        } else if(viewBy === 'bymonth' && selectedYear.length === 4) {
          url = `${BASE_URL}/auth/linechartbymonth?selectedYear=${selectedYear}`;
        } else if(viewBy === 'byyear' && !compareByYear) {
          url = `${BASE_URL}/auth/linechartbyyear`;
        } else if (viewBy === 'byyear' && compareByYear && selectedYears.length > 0) {
          const yearsQuery = selectedYears.join(',');
          url = `${BASE_URL}/auth/linechartbetweenyears?years=${yearsQuery}`;
        }

        if (!url) return;

        const response = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });

        const backendData = await response.json();

        if (backendData.success && Array.isArray(backendData.data)) {
          setFetchedData(backendData.data);
          notifyChartFilterApplied(backendData.data, 'line', viewBy, compareByYear);
        } else {
          setFetchedData([]);
        }
      } catch (err) {
        console.error("Network error:", err);
      }
    };

    getExpenses();
  }, [viewBy, selectedMonthYear, selectedYear, selectedYears, compareByYear, notifyChartFilterApplied]);

  useEffect(() => {
    const getAvailableYears = async () => {
      try {
        const token = localStorage.getItem('token');
        const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
        let url = `${BASE_URL}/auth/getloggedyears`;

        const response = await fetch(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });

        const backendData = await response.json();

        if (backendData.success) {
          setAvailableYears(backendData.data);
        } else {
          setAvailableYears([]);
        }
      } catch(err) {
        console.error("Network error:", err);
      }
    }

    getAvailableYears();
  }, [compareByYear]);

  let data = fetchedData;

  const average = data.length > 0
    ? data.reduce((sum, d) => sum + (d.total || 0), 0) / data.length
    : 0;

  // Tooltip shown when hovering chart points
  const customTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div className="custom-tooltip">
          <p>
            <strong>
              {item.week
                ? item.week
                : item.month
                ? item.month
                : item.year}
            </strong>
          </p>
          <p>
            <strong>Total</strong>: ₹{item.total}
          </p>
        </div>
      );
    }
    return null;
  };

  const shouldRenderChart = data.length > 0;

  // Handle dropdown change (Week / Month / Year)
  const handleViewChange = (e) => {
    const newView = e.target.value;
    setViewBy(newView);
    setCompareByYear(false);
    setSelectedYears([]);
    setSelectedYear('');
    setSelectedMonthYear('');

    setFetchedData([]);
    clearChartInsights();
  };

  // Header icon and title based on current view
  const getHeaderDetails = (viewBy) => {
    switch (viewBy) {
      case 'week':
        return { title: 'Weekly Spending Trend', url: icons.weekIcon};
      case 'bymonth':
        return { title: 'Monthly Spending Overview',url: icons.monthIcon};
      case 'byyear':
        return { title: 'Yearly Expense Summary', url: icons.yearIcon};
      default:
        return { title: 'Visualize Your Expenses', url: icons.viewIcon};
    }
  };

  const { title, url } = getHeaderDetails(viewBy);

  return (
    <div className="chart-container">
      <div className="chart-header">

        {/* Animated chart heading */}
        <motion.div
          key={viewBy}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="text-center mb-6"
        >
          <div className="heading">
            <img src={url} className="chart-icon-button" alt="Icon"/>
            <h1 className="text-2xl font-bold text-[var(--text-color)]">{title}</h1>
          </div>
        </motion.div>

        {/* Filter controls */}
        <div className="chart-filters">
          {viewBy === 'week' && (
            <input
              type="month"
              className="select-button filter-button"
              value={selectedMonthYear}
              onChange={(e) => setSelectedMonthYear(e.target.value)}
            />
          )}

          {viewBy === 'bymonth' && (
            <input
              type="number"
              className="select-button filter-button"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              placeholder="Year ?"
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
            <option value="week">Week</option>
            <option value="bymonth">Month</option>
            <option value="byyear">Year</option>
          </select>
        </div>
      </div>

      {/* Toggle for year comparison */}
      {viewBy === 'byyear' && (
        <div className="compare-by-year">
          <input
            type="checkbox"
            name="compare-by-year"
            id="compare-checkbox"
            checked={compareByYear}
            onChange={(e) => {
              const checked = e.target.checked;
              setCompareByYear(checked);

              if (!checked) {
                setSelectedYears([]);
                setFetchedData([]);
              }
            }}
          />
          <label htmlFor="compare-checkbox">Compare Between Years</label>
        </div>
      )}

      {/* Default message before any view is selected */}
      {viewBy === '' && (
        <p style={{ textAlign: 'center', fontSize: '20px' }}>
          Select desirable filter to visualize!
        </p>
      )}

      {/* Dropdown for selecting years in comparison mode */}
      {viewBy === 'byyear' && compareByYear && (
        <div className="compare-year-select">
          <label>Select years to compare:</label>
          <Select
            styles={getSelectStyles(theme)}
            isMulti
            options={availableYears.map((year) => ({ value: year, label: year }))}
            onChange={(selectedOptions) =>
              setSelectedYears(selectedOptions.map((opt) => opt.value))
            }
          />
        </div>
      )}

      {/* Single trend chart (non-comparison mode) */}
      <AnimatePresence mode="wait">
        {shouldRenderChart && !compareByYear && (
          <motion.div
            key={viewBy}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <TrendChartWrapper
              theme={theme}
              data={data}
              average={average}
              xKey={
                viewBy === 'byyear'
                  ? 'year'
                  : viewBy === 'bymonth'
                  ? 'month'
                  : 'week'
              }
              yKey="total"
              tooltipComponent={customTooltip}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Multiple trend chart (comparison mode) */}
      <AnimatePresence>
        {shouldRenderChart && compareByYear && (
          <motion.div
            key="compare-chart"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.5 }}
            className="chart-content"
          >
            <MultiTrendChartWrapper
              theme={theme}
              data={data}
              linesData={selectedYears.map((year) => ({
                dataKey: year.toString(),
                name: year.toString(),
              }))}
            />
          </motion.div>
        )}
      </AnimatePresence>
      {isChartInsightReady && !compareByYear && <InlineChartInsight item={chartInsightText} />}
    </div>
  );
}

export default TrendChartPage;