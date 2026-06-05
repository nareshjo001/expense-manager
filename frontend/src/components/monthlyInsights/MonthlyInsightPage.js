import Header from "./Header";
import BudgetIntelligence from "./BudgetIntelligence";
import SpendingInsights from "./SpendingInsights";
import OverallInsight from "./OverallInsight";
import './Layout.css';

export default function MonthlyInsightPage () {
  return (
    <div className="monthly-page-container">
      <Header />
      <BudgetIntelligence />
      <SpendingInsights />
      <OverallInsight />
    </div>
  )
}