import React, { useState, useEffect } from 'react';
import '../ChartPage.css';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChartWrapper } from '../../imports/chartsImport';
import icons from '../../imports/iconsImport';

import { useChartInsights } from '../../contexts/ai-contexts/ChartInsightsContext';
import InlineChartInsight from '../../insights/InlineChartInsight';
import QueryState from '../../common/QueryState';
import { usePieChartQuery } from '../../../hooks/queries/usePieChartQuery';
import { useReport } from '../../../hooks/useReport';

// ANL-001-T04 -- of the pie chart's three `show` modes (distribution/count/
// comparison) crossed with its `viewBy` sub-filter (thismonth/thisyear),
// exactly ONE combination is actually described by what the backend
// persists in report.insights.chartFindings.pie: it's built from
// monthlyCategoryReport (backend/analytics/analyzers/chartFindingsAnalyzer.js's
// buildPieFindings), i.e. the CURRENT calendar month's category breakdown
// only. That matches the chart precisely when show === 'distribution' &&
// viewBy === 'thismonth' (viewBy already defaults to 'thismonth', so no date
// math is needed -- just compare the two strings). 'count' shows transaction
// counts (a different metric entirely), 'comparison' shows budget-vs-spent
// (not a category breakdown at all), and distribution+'thisyear' shows a
// full-year breakdown the backend snapshot doesn't cover -- all three keep
// using the frontend pieChartFinding rules engine via notifyChartFilterApplied,
// unchanged.
//
// concentrationRatio in report.insights.chartFindings.pie is an HHI-style
// index (sum of squared category spend-share percentages, normalized to
// 0-1) computed server-side by chartFindingsAnalyzer.js. It is NOT the same
// formula as the bar chart's concentrationRatio (a simple top-3-share sum),
// and NOT the same formula as this file's old frontend rule
// (insights-engine/rules/chartPatterns.js's pieChartFinding, which used a
// gini-coefficient/dominance-ratio calculation with 0.45/0.35 cutoffs). The
// 0.35/0.20 thresholds below are chosen fresh for this metric's own scale,
// not reverse-engineered from the old gini thresholds.
const buildBackendPieInsight = (report, show, viewBy) => {
    if (!report) return null;
    if (show !== 'distribution' || viewBy !== 'thismonth') return null;

    const pieFindings = report.insights?.chartFindings?.pie;
    if (!pieFindings || pieFindings.hasData !== true) return null;

    // categoryDistribution[0] (report.categories.monthly.categoryDistribution)
    // is used instead of chartFindings.pie.topSlice, which only carries the
    // category name with no percentage -- categoryDistribution gives both
    // the name and the share in one place.
    const top = report.categories?.monthly?.categoryDistribution?.[0];
    if (!top) return null;

    const { concentrationRatio } = pieFindings;

    if (concentrationRatio >= 0.35) {
        return {
            severity: 'HIGH',
            text: `A large share of spending was concentrated in ${top.category}, accounting for ${top.percentage}% of total spending.`,
        };
    }

    if (concentrationRatio >= 0.20) {
        return {
            severity: 'MEDIUM',
            text: `${top.category} was the largest spending category during this period at ${top.percentage}% of total spending.`,
        };
    }

    return {
        severity: 'LOW',
        text: 'Spending was fairly balanced across categories during this period.',
    };
};

// Pie chart view of expense distribution/count/budget comparison, with cancellable data fetching per filter change.
const PieChartPage = ({ expenses }) => {
    const [show, setShow] = useState('');
    const [viewBy, setViewBy] = useState('thismonth');

    const { notifyChartFilterApplied, clearChartInsights, isChartInsightReady, chartInsightText } =  useChartInsights();
    const { data: report } = useReport();

    useEffect(() => {
        clearChartInsights();
    }, [clearChartInsights]);

    const pieChartQuery = usePieChartQuery(show, viewBy);

    const backendPieInsight = buildBackendPieInsight(report, show, viewBy);

    // useQuery no longer supports an onSuccess callback, so the chart insight notification runs here instead, once per new successful fetch.
    useEffect(() => {
        if (pieChartQuery.data?.success && Array.isArray(pieChartQuery.data.data)) {
            // ANL-001-T04 -- when the backend-driven insight above is
            // available for this exact show/viewBy combination, skip the
            // frontend rules engine entirely rather than computing (and
            // discarding) a redundant client-side finding.
            if (buildBackendPieInsight(report, show, viewBy)) {
                return;
            }
            notifyChartFilterApplied(pieChartQuery.data.data, 'pie', show);
        }
    }, [pieChartQuery.data, show, viewBy, report, notifyChartFilterApplied]);

    const chartData =
        pieChartQuery.data?.success && Array.isArray(pieChartQuery.data.data)
            ? pieChartQuery.data.data
            : [];

    const handleShowChange = (e) => {
        setShow(e.target.value);
        setViewBy('thismonth');
        clearChartInsights();
    };

    const handleViewChange = (e) => {
        setViewBy(e.target.value);
        clearChartInsights();
    };

    const getHeaderDetails = (show) => {
        switch (show) {
            case 'distribution':
                return { title: 'Category-wise Breakdown', url: icons.categoryIcon };
            case 'count':
                return { title: 'Category-wise Expense Counts', url: icons.countIcon };
            case 'comparison':
                return { title: 'Monthly Budget Usage', url: icons.compareIcon };
            default:
                return { title: 'Visualize Your Expenses', url: icons.viewIcon };
        }
    };

    const { title, url } = getHeaderDetails(show);

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
                    {(show === 'distribution' || show === 'count') && (
                        <select
                            className="select-button filter-button"
                            value={viewBy}
                            onChange={handleViewChange}
                        >
                            <option value="thismonth">This Month</option>
                            <option value="thisyear">This Year</option>
                        </select>
                    )}

                    <select
                        className="select-button filter-button"
                        value={show}
                        onChange={handleShowChange}
                    >
                        <option value="">Show</option>
                        <option value="distribution">Expense Distribution</option>
                        <option value="count">Number of Expenses</option>
                        <option value="comparison">Budget vs Spent</option>
                    </select>
                </div>

                {/* FE-001-T05 -- subtle affordance while the previous chart
                    stays visible (placeholderData) and a filter change is
                    refetching a new query key in the background. */}
                {pieChartQuery.isFetching && pieChartQuery.isPlaceholderData && (
                    <p className="chart-refreshing-indicator" role="status" aria-live="polite">
                        Updating chart&hellip;
                    </p>
                )}
            </div>

            {show === '' && (
                <p style={{ textAlign: 'center', fontSize: '20px' }}>
                    Select desirable filter to visualize!
                </p>
            )}

            {/* FE-001 -- explicit loading/error(+retry)/empty states only while
                a filter is actually selected (pieChartQuery.enabled); "no
                filter chosen yet" keeps its own message above. */}
            {pieChartQuery.enabled && (
                <QueryState
                    isLoading={pieChartQuery.isLoading}
                    isError={pieChartQuery.isError}
                    isEmpty={!pieChartQuery.isLoading && !pieChartQuery.isError && chartData.length === 0}
                    onRetry={pieChartQuery.refetch}
                    loadingLabel="Loading your chart..."
                    errorLabel="We couldn't load this chart. Please try again."
                    emptyLabel="No expenses found for this filter."
                >
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={show + '-' + viewBy}
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -30 }}
                            transition={{ duration: 0.5 }}
                            className="chart-content"
                        >
                            <PieChartWrapper
                                data={chartData}
                                show={show}
                            />
                        </motion.div>
                    </AnimatePresence>
                </QueryState>
            )}
            {backendPieInsight ? (
                <InlineChartInsight item={backendPieInsight} />
            ) : (
                isChartInsightReady && <InlineChartInsight item={chartInsightText} />
            )}
        </div>
    );
}

export default PieChartPage;
