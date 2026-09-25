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
import QueryState from '../../common/QueryState';
import { useBarChartQuery } from '../../../hooks/queries/useBarChartQuery';
import { useReport } from '../../../hooks/useReport';

// Bar chart view of expenses by month or category, with cancellable data fetching per filter change.
const BarChartPage = ({ expenses }) => {
  const { theme } = useContext(ThemeContext);
  const { notifyChartFilterApplied, clearChartInsights, isChartInsightReady, chartInsightText } =  useChartInsights();
  // ANL-001-T04 -- optional enhancement only: report has its own loading/error
  // state, but the bar chart itself is already fully covered by
  // barChartQuery's QueryState below, so an unready report just means "fall
  // back to the frontend rule", not a second spinner.
  const { data: report } = useReport();

  const [viewBy, setViewBy] = useState('');
  const [selectedYear, setSelectedYear] = useState('');
  const [month, setMonth] = useState('');
  const [specificMonth, setSpecificMonth] = useState(false);
  // ANL-001-T04 -- holds the backend-derived insight (see the effect below)
  // when the current filter matches the backend's computed scope. Null
  // means "use the frontend rules engine's chartInsightText" instead.
  const [backendInsight, setBackendInsight] = useState(null);

  useEffect(() => {
    clearChartInsights();
    setBackendInsight(null);
  }, [clearChartInsights]);

  const barChartQuery = useBarChartQuery(viewBy, month, specificMonth, selectedYear);

  // useQuery no longer supports an onSuccess callback, so the chart insight notification runs here instead, once per new successful fetch.
  useEffect(() => {
    if (!(barChartQuery.data?.success && Array.isArray(barChartQuery.data.data))) {
      return;
    }

    // ANL-001-T04 -- report.insights.chartFindings.bar (backend/analytics/
    // analyzers/chartFindingsAnalyzer.js's buildBarFindings) is fed by the
    // CURRENT calendar month's budget status and category breakdown only.
    // That backend snapshot is a faithful match for what this chart is
    // showing in exactly one state: "bycategory" with a specific month
    // selected, and that month being the current one. Every other
    // viewBy/filter combination (bymonth, bycategory-for-the-whole-year, or
    // a non-current specific month) has no backend equivalent, so it keeps
    // using the frontend rules engine (notifyChartFilterApplied) exactly as
    // before.
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const isCurrentMonthCategoryView =
      viewBy === 'bycategory' && specificMonth === true && month === currentYearMonth;

    if (isCurrentMonthCategoryView) {
      const barFindings = report?.insights?.chartFindings?.bar;

      // Gotcha (verified directly against chartFindingsAnalyzer.js, which is
      // out of scope for this migration): hasData is false whenever the user
      // has no budget configured at all (budgetReport.hasBudget !== true),
      // REGARDLESS of whether category data exists -- it's a budget-status
      // gate, not a category-data gate. concentrationRatio ends up
      // unavailable purely because of that unrelated gate, so this is
      // treated as "no backend data to use" and falls back to the frontend
      // rule below, not as an error.
      if (barFindings?.hasData === true) {
        const { concentrationRatio } = barFindings;
        const top = report?.categories?.monthly?.categoryDistribution?.[0];

        // top can be undefined even when concentrationRatio exists (edge
        // cases in the backend's category report); without a category name
        // there's no honest text to build, so fall back below instead.
        if (top) {
          // These thresholds are a fresh mapping for concentrationRatio (a
          // top-3-category-share ratio) -- a genuinely different metric from
          // the old frontend rule's gini/dominance-ratio math -- not an
          // attempt to reproduce the old rule's output under a new name.
          let insight;
          if (concentrationRatio >= 0.70) {
            insight = {
              severity: 'HIGH',
              text: `A large share of spending was concentrated in ${top.category}, accounting for ${top.percentage}% of the total.`,
            };
          } else if (concentrationRatio >= 0.50) {
            insight = {
              severity: 'MEDIUM',
              text: `${top.category} was the largest spending category during this period at ${top.percentage}% of total spending.`,
            };
          } else {
            insight = {
              severity: 'LOW',
              text: 'Spending was fairly balanced across categories during this period.',
            };
          }

          setBackendInsight(insight);
          return;
        }
      }
    }

    setBackendInsight(null);
    notifyChartFilterApplied(barChartQuery.data.data, 'bar', viewBy);
  }, [barChartQuery.data, viewBy, specificMonth, month, report, notifyChartFilterApplied]);

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
    setBackendInsight(null);
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
              aria-label="Select month"
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

      {/* FE-001-T05 -- subtle affordance while the previous chart stays
          visible (placeholderData) and a filter change is refetching a
          new query key in the background. */}
      {barChartQuery.isFetching && barChartQuery.isPlaceholderData && (
        <p className="chart-refreshing-indicator" role="status" aria-live="polite">
          Updating chart&hellip;
        </p>
      )}

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
              setBackendInsight(null);
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

      {/* FE-001 -- explicit loading/error(+retry)/empty states only while a
          filter is actually selected (barChartQuery.enabled); "no filter
          chosen yet" keeps its own message above, unrelated to the query. */}
      {barChartQuery.enabled && (
        <QueryState
          isLoading={barChartQuery.isLoading}
          isError={barChartQuery.isError}
          isEmpty={!barChartQuery.isLoading && !barChartQuery.isError && !shouldRenderChart}
          onRetry={barChartQuery.refetch}
          loadingLabel="Loading your chart..."
          errorLabel="We couldn't load this chart. Please try again."
          emptyLabel="No expenses found for this filter."
        >
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
        </QueryState>
      )}
      {backendInsight
        ? <InlineChartInsight item={backendInsight} />
        : (isChartInsightReady && <InlineChartInsight item={chartInsightText} />)}
    </div>
  );
};

export default BarChartPage;
