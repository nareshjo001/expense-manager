import React, { useState, useEffect } from 'react';
import '../ChartPage.css';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChartWrapper } from '../../imports/chartsImport';
import icons from '../../imports/iconsImport';

import { useChartInsights } from '../../contexts/ai-contexts/ChartInsightsContext';
import InlineChartInsight from '../../insights/InlineChartInsight';

const PieChartPage = ({ expenses }) => {
    // UI state
    const [show, setShow] = useState('');              // Chart type (distribution, count, comparison)
    const [viewBy, setViewBy] = useState('thismonth'); // Timeframe filter
    const [chartData, setChartData] = useState([]);    // Data to be passed to chart

    const { notifyChartFilterApplied, clearChartInsights, isChartInsightReady, chartInsightText } =  useChartInsights();

    useEffect(() => {
        clearChartInsights();
    }, [clearChartInsights]);

    useEffect(() => {
        const getExpensesForPie = async () => {
            try {
                const token = localStorage.getItem('token');
                const BASE_URL = process.env.REACT_APP_BACKEND_URL?.replace(/\/$/, "");
                let url = "";

                if (show === 'distribution') {
                    if (viewBy === 'thismonth') {
                        url = `${BASE_URL}/chart/getPieCategoryData?type=total`;
                    } else if (viewBy === 'thisyear') {
                        url = `${BASE_URL}/chart/getPieCategoryData?year=${new Date().getFullYear()}&type=total`;
                    }
                } else if (show === 'count') {
                    if (viewBy === 'thismonth') {
                        url = `${BASE_URL}/chart/getPieCategoryData?type=count`;
                    } else if (viewBy === 'thisyear') {
                        url = `${BASE_URL}/chart/getPieCategoryData?year=${new Date().getFullYear()}&type=count`;
                    }
                } else if (show === 'comparison') {
                    url = `${BASE_URL}/chart/getcomparisonforpie`;
                }

                if (!url) return;

                const response = await fetch(url, {
                method: 'GET',
                headers: { Authorization: `Bearer ${token}` },
                });

                const backendData = await response.json();

                if (backendData.success && Array.isArray(backendData.data)) {
                setChartData(backendData.data);
                notifyChartFilterApplied(backendData.data, 'pie', show);
                } else {
                setChartData([]);
                }

            } catch (err) {
                console.error("Network error:", err);
            }
            };

            getExpensesForPie();
    }, [show, viewBy, notifyChartFilterApplied]);

    // Handle chart type selection
    const handleShowChange = (e) => {
        setShow(e.target.value);
        setViewBy('thismonth'); // Reset to default view on new selection
        setChartData([]);
        clearChartInsights();
    };

    // Handle timeframe selection
    const handleViewChange = (e) => {
        setViewBy(e.target.value);
        setChartData([]);
        clearChartInsights();
    };

    // Determine header text and icon based on selected chart
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
            {/* Header with title and icon */}
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

                {/* Filters for time period and chart type */}
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

            {/* Prompt to select a filter if nothing is selected */}
            {show === '' && (
                <p style={{ textAlign: 'center', fontSize: '20px' }}>
                    Select desirable filter to visualize!
                </p>
            )}

            {/* Animated chart content section */}
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
            {isChartInsightReady && <InlineChartInsight item={chartInsightText} />}
        </div>
    );
}

export default PieChartPage;