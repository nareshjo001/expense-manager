import Header from "./Header";
import BudgetIntelligence from "./BudgetIntelligence";
import SpendingInsights from "./SpendingInsights";
import SpendingForecast from "./SpendingForecast";
import AnomalyInsights from "./AnomalyInsights";
import OverallInsight from "./OverallInsight";
import { Spinner } from "../imports/Imports";
import { useReport } from "../../hooks/useReport";
import './Layout.css';

// Assembles the budget insights dashboard from the shared report query.
export default function MonthlyInsightPage () {
  const { data: report, isLoading, error } = useReport();

  if (isLoading) return <Spinner />;

  if (error || !report) return <p>Failed to load report.</p>;

  return (
    <div className="monthly-page-container">
      <Header summary={report.summary ?? {}} />
      <BudgetIntelligence data={report.budgets ?? {}} />
      <SpendingInsights report={report} />
      {/* Prediction Layer V1: reads report.forecast from the SAME report
          query every section above already uses -- no extra fetch. */}
      <SpendingForecast report={report} />
      {/* Anomaly Detection Layer V1: reads report.anomalies from the SAME
          report query every section above already uses -- no extra fetch,
          no second useReport() call. */}
      <AnomalyInsights report={report} />
      <OverallInsight report={report} />
    </div>
  )
}