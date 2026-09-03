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
import QueryState from '../../common/QueryState';
import { useTrendChartQuery } from '../../../hooks/queries/useTrendChartQuery';
import { useLoggedYearsQuery } from '../../../hooks/queries/useLoggedYearsQuery';

// Trend line chart (week/month/year, with optional multi-year comparison) with cancellable data fetching per filter change.
const TrendChartPage = ({ expenses }) => {

  const { theme } = useContext(ThemeContext);

  const [viewBy, setViewBy] = useState('');
  const [selectedMonthYear, setSelectedMonthYear] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [compareByYear, setCompareByYear] = useState(false);
  const [selectedYears, setSelectedYears] = useState([]);

  const { notifyChartFilterApplied, clearChartInsights, isChartInsightReady, chartInsightText } =  useChartInsights();

  useEffect(() => {
    clearChartInsights();
  }, [clearChartInsights]);

  const trendChartQuery = useTrendChartQuery(viewBy, selectedMonthYear, selectedYear, compareByYear, selectedYears);

  // useQuery no longer supports an onSuccess callback, so the chart insight notification runs here instead, once per new successful fetch.
  useEffect(() => {
    if (trendChartQuery.data?.success && Array.isArray(trendChartQuery.data.data)) {
      notifyChartFilterApplied(trendChartQuery.data.data, 'line', viewBy, compareByYear);
    }
  }, [trendChartQuery.data, viewBy, compareByYear, notifyChartFilterApplied]);

  const loggedYearsQuery = useLoggedYearsQuery();
  const availableYears = loggedYearsQuery.data?.success ? loggedYearsQuery.data.data : [];

  const data =
    trendChartQuery.data?.success && Array.isArray(trendChartQuery.data.data)
      ? trendChartQuery.data.data
      : [];

  const average = data.length > 0
    ? data.reduce((sum, d) => sum + (d.total || 0), 0) / data.length
    : 0;

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

  const handleViewChange = (e) => {
    const newView = e.target.value;
    setViewBy(newView);
    setCompareByYear(false);
    setSelectedYears([]);
    setSelectedYear('');
    setSelectedMonthYear('');

    clearChartInsights();
  };

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

      {/* FE-001-T05 -- subtle affordance while the previous chart stays
          visible (placeholderData) and a filter change is refetching a
          new query key in the background. */}
      {trendChartQuery.isFetching && trendChartQuery.isPlaceholderData && (
        <p className="chart-refreshing-indicator" role="status" aria-live="polite">
          Updating chart&hellip;
        </p>
      )}

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
              }
            }}
          />
          <label htmlFor="compare-checkbox">Compare Between Years</label>
        </div>
      )}

      {viewBy === '' && (
        <p style={{ textAlign: 'center', fontSize: '20px' }}>
          Select desirable filter to visualize!
        </p>
      )}

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

      {/* FE-001 -- explicit loading/error(+retry)/empty states only while a
          filter is actually selected (trendChartQuery.enabled); "no filter
          chosen yet" keeps its own message above, unrelated to the query. */}
      {trendChartQuery.enabled && (
        <QueryState
          isLoading={trendChartQuery.isLoading}
          isError={trendChartQuery.isError}
          isEmpty={!trendChartQuery.isLoading && !trendChartQuery.isError && !shouldRenderChart}
          onRetry={trendChartQuery.refetch}
          loadingLabel="Loading your chart..."
          errorLabel="We couldn't load this chart. Please try again."
          emptyLabel="No expenses found for this filter."
        >
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
        </QueryState>
      )}
      {isChartInsightReady && !compareByYear && <InlineChartInsight item={chartInsightText} />}
    </div>
  );
}

export default TrendChartPage;