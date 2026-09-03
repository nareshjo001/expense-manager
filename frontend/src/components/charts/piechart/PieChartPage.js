import React, { useState, useEffect } from 'react';
import '../ChartPage.css';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChartWrapper } from '../../imports/chartsImport';
import icons from '../../imports/iconsImport';

import { useChartInsights } from '../../contexts/ai-contexts/ChartInsightsContext';
import InlineChartInsight from '../../insights/InlineChartInsight';
import QueryState from '../../common/QueryState';
import { usePieChartQuery } from '../../../hooks/queries/usePieChartQuery';

// Pie chart view of expense distribution/count/budget comparison, with cancellable data fetching per filter change.
const PieChartPage = ({ expenses }) => {
    const [show, setShow] = useState('');
    const [viewBy, setViewBy] = useState('thismonth');

    const { notifyChartFilterApplied, clearChartInsights, isChartInsightReady, chartInsightText } =  useChartInsights();

    useEffect(() => {
        clearChartInsights();
    }, [clearChartInsights]);

    const pieChartQuery = usePieChartQuery(show, viewBy);

    // useQuery no longer supports an onSuccess callback, so the chart insight notification runs here instead, once per new successful fetch.
    useEffect(() => {
        if (pieChartQuery.data?.success && Array.isArray(pieChartQuery.data.data)) {
            notifyChartFilterApplied(pieChartQuery.data.data, 'pie', show);
        }
    }, [pieChartQuery.data, show, notifyChartFilterApplied]);

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
            {isChartInsightReady && <InlineChartInsight item={chartInsightText} />}
        </div>
    );
}

export default PieChartPage;