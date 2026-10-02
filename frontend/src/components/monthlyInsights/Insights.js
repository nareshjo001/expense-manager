import { useState } from 'react';
import { FaChartPie } from 'react-icons/fa';
import MonthlyInsightPage from './MonthlyInsightPage';
import IncomeInsights from './Income/IncomeInsights';
import './Insights.css';

// SVG Icon for Income Insights: 3 vertical ascending rounded bars matching the reference image
const BarChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <rect x="1.5" y="9" width="3" height="6" rx="1.5" />
    <rect x="6.5" y="5" width="3" height="10" rx="1.5" />
    <rect x="11.5" y="1.5" width="3" height="13.5" rx="1.5" />
  </svg>
);

// Toggles between the Budget Insights and Income Insights pages.
const Insights = () => {
  const [type, setType] = useState("budget");

  return (
    <div className="insights-page-wrapper">
      <div className="analysis-toggle-container">
        <div className="analysis-toggle" role="tablist" aria-label="Analysis Mode">
          <div
            className={`analysis-toggle-slider ${type === "income" ? "right" : ""}`}
            aria-hidden="true"
          />

          <button
            type="button"
            role="tab"
            aria-selected={type === "budget"}
            className={`analysis-toggle-btn ${type === "budget" ? "active" : ""}`}
            onClick={() => setType("budget")}
          >
            <span className="analysis-toggle-icon" aria-hidden="true">
              <FaChartPie size={15} />
            </span>
            <span>Budget Insights</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={type === "income"}
            className={`analysis-toggle-btn ${type === "income" ? "active" : ""}`}
            onClick={() => setType("income")}
          >
            <span className="analysis-toggle-icon" aria-hidden="true">
              <BarChartIcon />
            </span>
            <span>Income Insights</span>
          </button>
        </div>
      </div>

      {type === "budget" ? <MonthlyInsightPage /> : <IncomeInsights />}
    </div>
  );
};

export default Insights;