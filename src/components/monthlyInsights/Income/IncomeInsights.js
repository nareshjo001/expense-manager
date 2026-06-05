import { useState } from 'react';
import Header from "./Header";
import OverallInsight from "./OverallInsight";
import '../Layout.css';

export default function IncomeInsights () {

  const [period, setPeriod] = useState("financial_year");

  return (
    <div className="monthly-page-container">
      <Header period={period} setPeriod={setPeriod} />
      <OverallInsight period={period} setPeriod={setPeriod} />
    </div>
  )
}