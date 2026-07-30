import React, {createContext, useState, useContext, useCallback} from 'react';

import { overallSpend } from '../../../insights-engine/rules/overallSpend';
import { categorySpend } from '../../../insights-engine/rules/categoryPatterns';
import { expenseInsightTemplates } from '../../../insights-engine/templates/expenseTemplates';

// Derives and provides AI-generated expense insight text on initial load and filter changes.
const ExpenseInsightsContext = createContext();

export const ExpenseInsightsProvider = ({ children }) => {
    const [expenseInsights, setExpenseInsights] = useState(null);
    const [isInsightReady, setIsInsightReady] = useState(null);

    const notifyInitialLoad = useCallback((expenses = [], previousExpenses = [], weeklyData = {}) => {
        setIsInsightReady(false);

        const insight = overallSpend({
            expenses,
            previousExpenses,
            weeklyData,
            scope: "LAST_7_DAYS",
        });

        if (!insight) {
            setExpenseInsights(null);
            setIsInsightReady(true);
            return;
        }

        setExpenseInsights({
            ...insight,
            generatedAt: Date.now(),
        });

        setIsInsightReady(true);
    }, []);

    const notifyFilterApplied = useCallback(( expenses = {}, pastThreeMonths = [], filterMeta = "" ) => {
        setIsInsightReady(false);

        const insight = categorySpend({
            expenses,
            pastThreeMonths,
            filterMeta,
            scope: filterMeta === 'thismonth' ? "THIS_MONTH_CATEGORY" : "THIS_YEAR_CATEGORY",
        });

        if (!insight) {
            setExpenseInsights(null);
            setIsInsightReady(true);
            return;
        }
        
        setExpenseInsights({
            ...insight,
            generatedAt: Date.now(),
        });

        setIsInsightReady(true);
    }, []);

    const clearExpenseInsights = () => {
        setExpenseInsights(null);
        setIsInsightReady(false);
    };

    const insightText =
        expenseInsights &&
        expenseInsightTemplates[expenseInsights.type]
            ? expenseInsightTemplates[expenseInsights.type](expenseInsights.payload)
            : null;

    return (
        <ExpenseInsightsContext.Provider
            value={{
                expenseInsights,
                insightText,
                isInsightReady,
                notifyInitialLoad,
                notifyFilterApplied,
                setIsInsightReady,
                clearExpenseInsights,
            }}
        >
            {children}
        </ExpenseInsightsContext.Provider>
    );
};

export const useExpenseInsights = () => {
    const ctx = useContext(ExpenseInsightsContext);
    if (!ctx) {
        throw new Error(
        "useExpenseInsights must be used within ExpenseInsightsProvider"
        );
    }
    return ctx;
};