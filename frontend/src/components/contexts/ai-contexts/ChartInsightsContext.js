import React, { createContext, useCallback, useContext, useState } from 'react';

import { lineChartFinding, barChartFinding, pieChartFinding} from '../../../insights-engine/rules/chartPatterns';
import { chartInsightTemplates } from '../../../insights-engine/templates/chartsTemplates';

const ChartInsightsContext = createContext();

export const ChartInsightsProvider = ({ children }) => {
    const [chartInsights, setChartInsights] = useState(null);
    const [isChartInsightReady, setIsChartInsightReady] = useState(false);

    const notifyChartFilterApplied = useCallback((data = [], chart= '', filter = '', compareByYear = false) => {
        setIsChartInsightReady(false);
        
        let insight;
        if(chart === 'line' && !compareByYear) {
            insight = lineChartFinding(data);
        }

        if(chart === 'bar') {
            insight = barChartFinding(data, filter);
        }

        if(chart === 'pie') {
            insight = pieChartFinding(data, filter);
        }

        if (!insight || !insight.payload) {
            setChartInsights(null);
            setIsChartInsightReady(true);
            return;
        }

        setChartInsights({
            ...insight,
            generatedAt: Date.now(),
        });
        setIsChartInsightReady(true);
    }, []);

    const clearChartInsights = useCallback(() => {
        setChartInsights(null);
        setIsChartInsightReady(false);
    }, []);

    let chartInsightText = null;

    try {
        if (chartInsights?.type && chartInsightTemplates[chartInsights.type]) {
            chartInsightText = chartInsightTemplates[chartInsights.type](
            chartInsights.payload
            );
        }
    } catch {
        chartInsightText = null;
    }

    return (
        <ChartInsightsContext.Provider
        value={{
            chartInsights,
            isChartInsightReady,
            chartInsightText,
            notifyChartFilterApplied,
            setIsChartInsightReady,
            clearChartInsights,
        }}
        >
        {children}
        </ChartInsightsContext.Provider>
    );
}

export const useChartInsights = () => {
    const ctx = useContext(ChartInsightsContext);
    if (!ctx) {
        throw new Error(
        "useChartInsights must be used within ChartInsightsProvider"
        );
    }
    return ctx;
};