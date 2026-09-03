import Header from "./Header";
import BudgetIntelligence from "./BudgetIntelligence";
import SpendingInsights from "./SpendingInsights";
import SpendingForecast from "./SpendingForecast";
import AnomalyInsights from "./AnomalyInsights";
import OverallInsight from "./OverallInsight";
import QueryState from "../common/QueryState";
import { useReport } from "../../hooks/useReport";
import './Layout.css';

// Assembles the budget insights dashboard from the shared report query.
export default function MonthlyInsightPage () {
  const { data: report, isLoading, isError, refetch } = useReport();

  // FE-001 -- loading, request-failure (with retry) and a genuinely empty
  // report are three different situations; the previous code showed the
  // same "Failed to load report." text for an error AND for a brand-new
  // account with no data yet.
  const isEmpty = !isLoading && !isError && !report;

  return (
    <div className="monthly-page-container">
      <QueryState
        isLoading={isLoading}
        isError={isError}
        isEmpty={isEmpty}
        onRetry={refetch}
        loadingLabel="Loading your monthly insights..."
        errorLabel="We couldn't load your report. Please try again."
        emptyLabel="No report data yet."
        emptyHint="Add some expenses to see insights here."
      >
        <Header summary={report?.summary ?? {}} />
        <BudgetIntelligence data={report?.budgets ?? {}} />
        <SpendingInsights report={report} />
        {/* Prediction Layer V1: reads report.forecast from the SAME report
            query every section above already uses -- no extra fetch. */}
        <SpendingForecast report={report} />
        {/* Anomaly Detection Layer V1: reads report.anomalies from the SAME
            report query every section above already uses -- no extra fetch,
            no second useReport() call. */}
        <AnomalyInsights report={report} />
        <OverallInsight report={report} />
      </QueryState>
    </div>
  )
}
