import { useState } from 'react';
import MonthlyInsightPage from './MonthlyInsightPage';
import IncomeInsights from './Income/IncomeInsights';
import '../expensesHandling/AddExpense.css';

const Insights = () => {
  const [type, setType] = useState("budget");

  return (
    <div className="add-page">
      <div className="form-toggle" style={{ marginBottom: '12px', maxWidth: '95%' }}>
        <div
          className={`form-toggle-slider ${
            type === "income" ? "right" : ""
          }`}
        />

        <button
          className={type === "budget" ? "active" : ""}
          onClick={() => setType("budget")}
        >
          Budget Insights
        </button>

        <button
          className={type === "income" ? "active" : ""}
          onClick={() => setType("income")}
        >
          Income Insights
        </button>
      </div>

      {type === "budget" ? <MonthlyInsightPage /> : <IncomeInsights />}
    </div>
  );
};

export default Insights;