import Header from "./Header";
import BudgetIntelligence from "./BudgetIntelligence";
import SpendingInsights from "./SpendingInsights";
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
      <OverallInsight report={report} />
    </div>
  )
}